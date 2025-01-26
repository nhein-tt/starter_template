import asyncio
import base64
import json
import os
import sqlite3
import uuid
from datetime import datetime
from io import BytesIO
from typing import List
from urllib.request import urlopen

import instructor
from fastapi import File, HTTPException, UploadFile
from modal import asgi_app
from openai import OpenAI, AsyncOpenAI
from PIL import Image
from sentence_transformers import SentenceTransformer, util

from .common import DB_PATH, VOLUME_DIR, app, fastapi_app, volume
from .models import (
    BatchMetrics,
    EvaluationRequest,
    EvaluationResponse,
    EvaluationResult,
    ImageDescriptionRequest,
    ImageGenerationRequest,
    ImageSimilarityRequest,
    QualityRating,
    QualityRatingRequest,
    QualityRatingResponse,
    TextToSpeechRequest,
)

DEFAULT_TEST_PROMPTS = [
    "A Steam Locomotive in the snow",
    "A Painting of a peacock perched in a golden archway",
    "An Underwater Scene of an Ancient Temple Complex",
    "A Solitary Lighthouse on a Rocky Cliff",
    "A Macro Photograph of a Mechanical Watch Movement",
]

# DEFAULT_TEST_PROMPTS_V2 = [
#     "Create a hyperrealistic photograph of a steam locomotive charging through a heavy snowstorm at night, with the headlight piercing through the darkness and steam billowing dramatically. The scene should have strong contrast between light and shadow, with ice formations visible on the front of the engine.",
#     "Design an elaborate Art Nouveau-style illustration of a peacock perched in a golden archway, surrounded by ornate floral patterns incorporating lilies and roses. The peacock's tail should be fully displayed with intricate detail in jewel tones, and metallic architectural elements should frame the composition.",
#     "Render a detailed underwater scene of an ancient temple complex discovered in a coral reef, with rays of sunlight filtering through crystal-clear water. Include schools of tropical fish, partially buried stone sculptures covered in coral, and sea plants growing between weathered stone columns.",
#     "Compose a cinematic widescreen shot of a solitary lighthouse on a rocky cliff during a fierce storm at sunset. The lighthouse beam should cut through dark storm clouds, waves should be crashing against the rocks below, and there should be visible weather effects like rain and lightning in the background.",
#     "Create a highly detailed macro photograph of a mechanical watch movement, focusing on the intricate gears, springs, and jewels. The image should have shallow depth of field, with some elements in sharp focus while others softly blur. Include subtle reflections on the polished metal surfaces.",
# ]


@app.function(
    volumes={VOLUME_DIR: volume},
)
def init_db():
    """Initialize the SQLite database with a simple table."""
    volume.reload()
    conn = sqlite3.connect(DB_PATH)
    SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS evaluation_batches (
        batch_id TEXT PRIMARY KEY,
        timestamp DATETIME NOT NULL,
        description TEXT
    );

    CREATE TABLE IF NOT EXISTS test_prompts (
        prompt_id TEXT PRIMARY KEY,
        prompt_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generated_images (
        image_id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        prompt_id TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        image_data TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        similarity_score REAL,
        quality_rating TEXT CHECK(quality_rating IN ('MEH', 'FAIR', 'OKAY', 'GOOD', 'GREAT', 'EXCELLENT')),
        llm_feedback TEXT,
        FOREIGN KEY (batch_id) REFERENCES evaluation_batches(batch_id),
        FOREIGN KEY (prompt_id) REFERENCES test_prompts(prompt_id)
    );

    CREATE TABLE IF NOT EXISTS batch_metrics (
        batch_id TEXT NOT NULL,
        avg_similarity_score REAL,
        avg_llm_score REAL,
        timestamp DATETIME NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES evaluation_batches(batch_id)
    );
    """
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()
    volume.commit()


async def url_to_base64(url: str) -> str:
    """Convert an image URL to a base64 encoded string."""
    try:
        response = urlopen(url)
        image_data = response.read()
        return base64.b64encode(image_data).decode("utf-8")
    except Exception as e:
        print(f"Error converting image to base64: {str(e)}")
        raise


@app.function(volumes={VOLUME_DIR: volume}, timeout=50000)
@asgi_app()
def fastapi_entrypoint():
    # Initialize database on startup
    init_db.remote()
    return fastapi_app


def get_or_create_prompt_ids(conn, prompts):
    """
    Get existing prompt IDs or create new ones for the given prompts.
    Returns a dictionary mapping prompt text to prompt IDs.
    """
    prompt_map = {}

    for prompt in prompts:
        # First, try to find an existing prompt
        cursor = conn.execute(
            "SELECT prompt_id FROM test_prompts WHERE prompt_text = ?", (prompt,)
        )
        result = cursor.fetchone()

        if result:
            # If prompt exists, use its ID
            prompt_map[prompt] = result[0]
        else:
            # If prompt doesn't exist, create new ID and insert
            new_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO test_prompts (prompt_id, prompt_text) VALUES (?, ?)",
                (new_id, prompt),
            )
            conn.commit()
            prompt_map[prompt] = new_id

    conn.close()
    return prompt_map


@fastapi_app.post("/evaluate", response_model=EvaluationResponse)
async def run_evaluation(request: EvaluationRequest):
    """Run a complete evaluation batch and return results"""
    try:
        batch_id = str(uuid.uuid4())
        timestamp = datetime.now()

        # Create batch record
        volume.reload()
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO evaluation_batches (batch_id, timestamp, description) VALUES (?, ?, ?)",
                (batch_id, timestamp, request.description),
            )
            conn.commit()

        volume.commit()
        prompts = (
            request.custom_prompts if request.custom_prompts else DEFAULT_TEST_PROMPTS
        )
        prompt_map = get_or_create_prompt_ids(conn, prompts)

        tasks = []
        for prompt in prompts:
            prompt_id = prompt_map[prompt]
            for iteration in range(request.num_iterations):
                task = process_single_iteration(
                    prompt, prompt_id, batch_id, iteration, DB_PATH
                )
                tasks.append(task)

        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        valid_results = [r for r in raw_results if isinstance(r, EvaluationResult)]
        volume.reload()

        write_results_to_db(batch_id, valid_results)
        volume.commit()
        metrics = calculate_metrics(batch_id)

        return EvaluationResponse(
            batch_id=batch_id,
            description=request.description,
            timestamp=timestamp.isoformat(),
            prompts=prompts,
            metrics=metrics,
            results=valid_results,
        )

    except Exception as e:
        print(f"Evaluation failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Evaluation failed: {str(e)}"
        ) from e


@fastapi_app.get("/evaluation/{batch_id}", response_model=EvaluationResponse)
async def get_evaluation_results(batch_id: str):
    """Retrieve results for a specific evaluation batch"""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            # Get batch info
            batch = conn.execute(
                """
                SELECT description, timestamp
                FROM evaluation_batches
                WHERE batch_id = ?
            """,
                (batch_id,),
            ).fetchone()

            if not batch:
                raise HTTPException(status_code=404, detail="Batch not found")

            prompts = conn.execute(
                """
                            SELECT DISTINCT prompt_text
                            FROM generated_images
                            WHERE batch_id = ?
                            ORDER BY prompt_text
                        """,
                (batch_id,),
            ).fetchall()

            # Calculate metrics directly from generated_images
            metrics = conn.execute(
                """
                SELECT
                    AVG(similarity_score) as avg_similarity_score,
                    JSON_OBJECT(
                        'MEH', SUM(CASE WHEN quality_rating = 'MEH' THEN 1 ELSE 0 END),
                        'FAIR', SUM(CASE WHEN quality_rating = 'FAIR' THEN 1 ELSE 0 END),
                        'OKAY', SUM(CASE WHEN quality_rating = 'OKAY' THEN 1 ELSE 0 END),
                        'GOOD', SUM(CASE WHEN quality_rating = 'GOOD' THEN 1 ELSE 0 END),
                        'GREAT', SUM(CASE WHEN quality_rating = 'GREAT' THEN 1 ELSE 0 END),
                        'EXCELLENT', SUM(CASE WHEN quality_rating = 'EXCELLENT' THEN 1 ELSE 0 END)
                    ) as rating_distribution
                FROM generated_images
                WHERE batch_id = ?
            """,
                (batch_id,),
            ).fetchone()

            # Get all results
            results = conn.execute(
                """
                SELECT prompt_text, image_data, similarity_score, quality_rating, llm_feedback
                FROM generated_images
                WHERE batch_id = ?
                ORDER BY prompt_text, iteration
            """,
                (batch_id,),
            ).fetchall()

            evaluation_results = [
                EvaluationResult(
                    prompt=r[0],
                    image_data=r[1],
                    similarity_score=r[2],
                    quality_rating=r[3],
                    feedback=r[4],
                )
                for r in results
            ]

            # Handle case where metrics might be None
            avg_similarity = metrics[0] if metrics[0] is not None else 0.0
            rating_dist = (
                json.loads(metrics[1])
                if metrics[1]
                else {
                    "MEH": 0,
                    "FAIR": 0,
                    "OKAY": 0,
                    "GOOD": 0,
                    "GREAT": 0,
                    "EXCELLENT": 0,
                }
            )

            batch_metrics = BatchMetrics(
                avg_similarity_score=avg_similarity, rating_distribution=rating_dist
            )

            return EvaluationResponse(
                batch_id=batch_id,
                description=batch[0],
                timestamp=batch[1],
                prompts=[p[0] for p in prompts],  # Add prompts to response
                metrics=batch_metrics,
                results=evaluation_results,
            )

    except sqlite3.Error as e:
        print(f"Database error in get_evaluation_results: {str(e)}")  # Add logging
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        print(f"Unexpected error in get_evaluation_results: {str(e)}")  # Add logging
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@fastapi_app.get("/evaluation_batches")
async def get_evaluation_batches():
    try:
        with sqlite3.connect(DB_PATH) as conn:
            batches = conn.execute(
                """
                SELECT
                    eb.batch_id,
                    eb.description,
                    eb.timestamp,
                    COUNT(gi.image_id) as image_count
                FROM evaluation_batches eb
                LEFT JOIN generated_images gi ON eb.batch_id = gi.batch_id
                GROUP BY eb.batch_id
                ORDER BY eb.timestamp DESC
            """
            ).fetchall()

            return [
                {
                    "batch_id": batch[0],
                    "description": batch[1],
                    "timestamp": batch[2],
                    "image_count": batch[3],
                }
                for batch in batches
            ]
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@fastapi_app.post("/rate_quality")
async def rate_quality(request: QualityRatingRequest):
    """Rate the quality of an image based on prompt alignment and technical aspects"""
    # client = instructor.patch(OpenAI(api_key=os.environ["OPENAI_API_KEY"]))
    async_client = instructor.apatch(AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"]))
    try:
        response = await async_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"""Evaluate this image's quality and alignment with the prompt: "{request.prompt}"\n

                            Rate across these specific criteria:
                            1. Prompt Alignment (40% of score)
                               - Are ALL key elements from the prompt present?
                               - Is the interpretation accurate and faithful?
                               - Does it capture the mood/style specified?

                            2. Technical Quality (30% of score)
                               - Composition: Rule of thirds, framing, balance
                               - Lighting: Proper exposure, contrast, shadows
                               - Detail: Sharpness, texture quality, resolution
                               - Color: Palette coherence, saturation, tone

                            3. Artistic Merit (30% of score)
                               - Creativity in interpretation
                               - Visual impact and memorability
                               - Uniqueness of perspective
                               - Emotional resonance

                            Choose ONE rating based on these strict criteria:

                            EXCELLENT (95-100%):
                            - Perfect prompt alignment with every element present
                            - Masterful technical execution across ALL aspects
                            - Exceptional artistic vision that elevates the concept
                            - Zero noticeable flaws or artifacts
                            - Could be used professionally without modification

                            GREAT (85-94%):
                            - Nearly complete prompt alignment (90%+ elements)
                            - Strong technical execution with minor imperfections
                            - Creative interpretation that adds value
                            - Very minimal flaws that don't impact overall quality
                            - Suitable for most professional uses

                            GOOD (75-84%):
                            - Most prompt elements present (80%+)
                            - Solid technical quality with some inconsistencies
                            - Standard but effective interpretation
                            - Notable minor flaws but generally successful
                            - Acceptable for casual use

                            OKAY (65-74%):
                            - Basic prompt alignment (70%+ elements)
                            - Inconsistent technical quality
                            - Literal/basic interpretation
                            - Multiple minor flaws or a few major issues
                            - Limited usefulness

                            FAIR (50-64%):
                            - Missing significant prompt elements
                            - Poor technical execution in multiple areas
                            - Lacks creative interpretation
                            - Major flaws that severely impact quality
                            - Mostly unsuitable for intended use

                            MEH (0-49%):
                            - Minimal prompt alignment
                            - Failed technical execution
                            - No artistic merit
                            - Fundamental flaws throughout
                            - Completely unsuitable for any use

                            Score Calculation:
                            1. Rate each category (Prompt, Technical, Artistic) out of 100
                            2. Apply weights (40%, 30%, 30%)
                            3. Sum for final score
                            4. Map to rating scale above

                            Provide detailed explanation including:
                            1. Specific scores for each category
                            2. Key strengths and weaknesses
                            3. Missing prompt elements
                            4. Technical issues
                            5. Artistic assessment
                            6. Final weighted score
                            7. Resulting rating
                            """,
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{request.image_data}"
                            },
                        },
                    ],
                }
            ],
            response_model=QualityRatingResponse,
            max_tokens=500,
        )

        return {
            "quality_rating": response.quality_rating.value,
            "explanation": response.explanation,
        }

    except Exception as e:
        print(f"Quality rating error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.post("/generate_image")
async def generate_image(request: ImageGenerationRequest):
    # client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    async_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    try:
        response = await async_client.images.generate(
            model="dall-e-2",
            prompt=request.prompt,
            size="1024x1024",
            quality="standard",
            n=1,
        )
        image_base64 = await url_to_base64(response.data[0].url)
        return {"image_data": image_base64}
    except Exception as e:
        print(f"Image generation error: {str(e)}")
        return {"error": str(e)}, 500


@fastapi_app.post("/text_to_speech")
async def text_to_speech(request: TextToSpeechRequest):
    # client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    async_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    try:
        response = await async_client.audio.speech.create(
            model="tts-1", voice="alloy", input=request.text
        )
        # Convert the binary response to base64 for easy transfer
        audio_base64 = base64.b64encode(response.content).decode("utf-8")
        return {"audio": audio_base64}
    except Exception as e:
        print(f"TTS error: {str(e)}")
        return {"error": str(e)}, 500


@fastapi_app.post("/analyze_image_similarity")
async def analyze_image_similarity(request: ImageSimilarityRequest):
    try:
        # Load CLIP model
        model = SentenceTransformer("clip-ViT-B-32")

        # Convert base64 to PIL Image
        image_data = base64.b64decode(request.image_data)

        image = Image.open(BytesIO(image_data)).convert("RGB")

        img_emb = model.encode(image)
        text_emb = model.encode([request.prompt])
        similarity = util.cos_sim(img_emb, text_emb)
        print(f"the similarity directly: {similarity}")
        similarity_score = float(similarity[0][0]) * 100  # Convert to percentage
        print(f"the similarity as a percentage: {similarity_score}")

        return {
            "similarity_score": similarity_score,
        }

    except Exception as e:
        print(f"Analysis error: {str(e)}")
        return {"error": str(e)}, 500


@fastapi_app.post("/describe")
async def describe_image(request: ImageDescriptionRequest):
    async_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

    vision_response = await async_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Please provide a detailed description of this image.",
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{request.image_data}"
                        },
                    },
                ],
            }
        ],
        max_tokens=300,
    )

    description = vision_response.choices[0].message.content
    return {"image_description": description}


@fastapi_app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    if not file.content_type.startswith("audio/"):
        raise HTTPException(
            status_code=400,
            detail="File must be an audio file. Received: " + file.content_type,
        )
    try:
        audio_bytes = await file.read()
        audio_file = BytesIO(audio_bytes)
        audio_file.name = file.filename or "audio.webm"

        # Print some debug info
        print(f"Processing audio file: {file.filename}")
        print(f"Content type: {file.content_type}")
        print(f"File size: {len(audio_bytes)} bytes")

        transcription = client.audio.transcriptions.create(
            model="whisper-1", file=audio_file
        )
        return {"transcript": transcription.text}
    except Exception as e:
        print("there was an error")
        print(str(e))
        return {"error": str(e)}, 500


@fastapi_app.get("/")
def read_root():
    return {"message": "Hello World"}


async def process_single_iteration(
    prompt: str, prompt_id: str, batch_id: str, iteration: int, db_path
) -> EvaluationResult | None:
    """Process a single iteration of image generation and evaluation"""
    async with asyncio.Semaphore(25):
        try:
            # Generate image
            image_response = await generate_image(ImageGenerationRequest(prompt=prompt))
            image_data = image_response["image_data"]

            # Run all analysis tasks concurrently
            similarity_task = analyze_image_similarity(
                ImageSimilarityRequest(prompt=prompt, image_data=image_data)
            )
            quality_task = rate_quality(
                QualityRatingRequest(prompt=prompt, image_data=image_data)
            )
            description_task = describe_image(
                ImageDescriptionRequest(image_data=image_data)
            )

            # Wait for all tasks to complete
            similarity_response, quality_response, description_response = (
                await asyncio.gather(similarity_task, quality_task, description_task)
            )
            # print(similarity_response)
            # print(quality_response)
            # print(description_response)
            # print(
            #     EvaluationResult(
            #         prompt=prompt,
            #         image_data=image_data,
            #         similarity_score=similarity_response["similarity_score"],
            #         quality_rating=quality_response["quality_rating"],
            #         feedback=description_response["image_description"],
            #     )
            # )

            # Create result object
            return EvaluationResult(
                prompt=prompt,
                image_data=image_data,
                similarity_score=similarity_response["similarity_score"],
                quality_rating=quality_response["quality_rating"],
                feedback=description_response["image_description"],
            )

        except Exception as e:
            print(
                f"Error processing iteration {iteration} for prompt '{prompt}': {str(e)}"
            )
            return None


def write_results_to_db(batch_id: str, results: List[EvaluationResult]):
    """Write all results to the database sequentially."""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "PRAGMA journal_mode=WAL;"
            )  # Enable better concurrency handling
            for result in results:
                conn.execute(
                    """
                    INSERT INTO generated_images
                    (image_id, batch_id, prompt_id, prompt_text, image_data, iteration,
                     similarity_score, quality_rating, llm_feedback)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        batch_id,
                        str(uuid.uuid4()),  # Use a unique prompt_id for now
                        result.prompt,
                        result.image_data,
                        0,  # Replace with the iteration index if you have it
                        result.similarity_score,
                        result.quality_rating,
                        result.feedback,
                    ),
                )
                conn.commit()
    except Exception as e:
        print(f"Database write error: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to write results to database"
        )


def calculate_metrics(batch_id: str) -> BatchMetrics:
    """Calculate and return batch metrics from the database."""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row

            # Average similarity score
            cursor = conn.execute(
                """
                SELECT AVG(similarity_score) as avg_similarity
                FROM generated_images
                WHERE batch_id = ?
                """,
                (batch_id,),
            )
            avg_similarity = cursor.fetchone()["avg_similarity"] or 0.0

            # Quality rating distribution
            cursor = conn.execute(
                """
                SELECT quality_rating, COUNT(*) as count
                FROM generated_images
                WHERE batch_id = ?
                GROUP BY quality_rating
                """,
                (batch_id,),
            )
            rating_counts = cursor.fetchall()
            rating_distribution = {
                row["quality_rating"]: row["count"] for row in rating_counts
            }

        return BatchMetrics(
            avg_similarity_score=avg_similarity,
            rating_distribution=rating_distribution,
        )
    except Exception as e:
        print(f"Metric calculation error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to calculate metrics")
