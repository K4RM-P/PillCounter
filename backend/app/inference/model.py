"""YOLOv8 model loading, isolated so the weights file can be swapped
(Phase 2 pretrained/generic -> Phase 3 fine-tuned) without touching
counter.py or any calling code.
"""

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


@lru_cache(maxsize=1)
def get_model() -> YOLO:
    model = YOLO(settings.MODEL_WEIGHTS_PATH)
    # Warm up on the actual inference device so the first real request isn't
    # slowed by lazy weight transfer/kernel compilation.
    model.to(resolve_device())
    return model
