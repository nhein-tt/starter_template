import sqlite3
import torch
from PIL import Image
import numpy as np
from urllib.request import urlopen

from modal import asgi_app
from io import BytesIO

from .common import DB_PATH, VOLUME_DIR, app, fastapi_app, volume
from .models import ImageGenerationRequest, ImageSimilarityRequest, TextToSpeechRequest
from fastapi import UploadFile, File, HTTPException
import base64
from openai import OpenAI
from sentence_transformers import SentenceTransformer, util
import os


@app.function(
    volumes={VOLUME_DIR: volume},
)
def init_db():
    """Initialize the SQLite database with a simple table."""
    volume.reload()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create a simple table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    )

    conn.commit()
    conn.close()
    volume.commit()


@app.function(
    volumes={VOLUME_DIR: volume},
)
@asgi_app()
def fastapi_entrypoint():
    # Initialize database on startup
    init_db.remote()
    return fastapi_app


@fastapi_app.post("/generate_image")
async def generate_image(request: ImageGenerationRequest):
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    try:
        response = client.images.generate(
            model="dall-e-3",
            prompt=request.prompt,
            size="1024x1024",
            quality="standard",
            n=1,
        )
        return {"image_url": response.data[0].url}
    except Exception as e:
        print(f"Image generation error: {str(e)}")
        return {"error": str(e)}, 500

@fastapi_app.post("/text_to_speech")
async def text_to_speech(request: TextToSpeechRequest):
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    try:
        response = client.audio.speech.create(
            model="tts-1",
            voice="alloy",
            input=request.text
        )
        # Convert the binary response to base64 for easy transfer
        audio_base64 = base64.b64encode(response.content).decode('utf-8')
        return {"audio": audio_base64}
    except Exception as e:
        print(f"TTS error: {str(e)}")
        return {"error": str(e)}, 500


@fastapi_app.post("/analyze_image_similarity")
async def analyze_image_similarity(request: ImageSimilarityRequest):
    try:
        # Load CLIP model
        # device = "cpu"  # or "cuda" if GPU available
        # model, preprocess = clip.load("ViT-B/32", device=device)
        model = SentenceTransformer('clip-ViT-B-32')
        image_response = urlopen(request.image_url)
        image = Image.open(BytesIO(image_response.read())).convert('RGB')

        img_emb = model.encode(image)
        text_emb = model.encode([request.prompt])
        similarity = util.cos_sim(img_emb, text_emb)
        print(f"the similarity directly: {similarity}")
        similarity_score = float(similarity[0][0]) * 100  # Convert to percentage
        print(f"the similarity as a percentage: {similarity_score}")

        # Use GPT-4 Vision to describe the image
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

        # image_data = base64.b64encode(image_response.read()).decode('utf-8')

        vision_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Please provide a detailed description of this image."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": request.image_url
                            }
                        }
                    ]
                }
            ],
            max_tokens=300
        )

        description = vision_response.choices[0].message.content

        return {
            "similarity_score": similarity_score,
            "image_description": description
        }

    except Exception as e:
        print(f"Analysis error: {str(e)}")
        return {"error": str(e)}, 500


@fastapi_app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    if not file.content_type.startswith('audio/'):
            raise HTTPException(
                status_code=400,
                detail="File must be an audio file. Received: " + file.content_type
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
            model="whisper-1",
            file=audio_file
        )
        return {"transcript": transcription.text}
    except Exception as e:
        print("there was an error")
        print(str(e))
        return {"error": str(e)}, 500


@fastapi_app.get("/")
def read_root():
    return {"message": "Hello World"}
