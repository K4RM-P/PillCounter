"""YOLOv8 model loading, isolated so the weights file can be swapped
(Phase 2 pretrained/generic -> Phase 3 fine-tuned) without touching
counter.py or any calling code.
"""

from __future__ import annotations

from functools import lru_cache

import torch
from ultralytics import YOLO

from app.config import settings


def resolve_device() -> str:
    if settings.INFERENCE_DEVICE != "auto":
        return settings.INFERENCE_DEVICE
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "0"
    return "cpu"


@lru_cache(maxsize=settings.MODEL_CACHE_SIZE)
def get_model(weights_path: str | None = None) -> YOLO:
    """Cached per weights path — lets multiple model versions (e.g. for A/B
    testing candidate weights against the production default) be loaded and
    reused within the same process instead of reloading from disk per request."""
    model = YOLO(weights_path or settings.MODEL_WEIGHTS_PATH)
    # Warm up on the actual inference device so the first real request isn't
    # slowed by lazy weight transfer/kernel compilation.
    model.to(resolve_device())
    return model
