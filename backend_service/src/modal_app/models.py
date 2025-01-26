from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


class QualityRating(Enum):
    MEH = "MEH"
    FAIR = "FAIR"
    OKAY = "OKAY"
    GOOD = "GOOD"
    GREAT = "GREAT"
    EXCELLENT = "EXCELLENT"


class QualityRatingRequest(BaseModel):
    image_data: str
    prompt: str


class QualityRatingResponse(BaseModel):
    quality_rating: QualityRating
    explanation: str


class EvaluationRequest(BaseModel):
    """Request model for running an evaluation batch"""

    description: Optional[str] = None
    num_iterations: int = 5  # Number of iterations per prompt
    custom_prompts: Optional[List[str]] = None  # Optional custom prompts to evaluate


class EvaluationResult(BaseModel):
    """Individual evaluation result"""

    prompt: str
    image_data: str
    similarity_score: float
    quality_rating: str
    feedback: str


class BatchMetrics(BaseModel):
    """Aggregate metrics for a batch"""

    avg_similarity_score: float
    rating_distribution: dict[str, int]


class EvaluationResponse(BaseModel):
    """Complete response for an evaluation batch"""

    batch_id: str
    description: Optional[str]
    timestamp: str
    prompts: Optional[List[str]]
    metrics: BatchMetrics
    results: List[EvaluationResult]


class ImageGenerationRequest(BaseModel):
    prompt: str


class ImageDescriptionRequest(BaseModel):
    image_data: str


class ImageSimilarityRequest(BaseModel):
    prompt: str
    image_data: str


class TextToSpeechRequest(BaseModel):
    text: str
