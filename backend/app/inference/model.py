"""YOLOv8 model loading, isolated so the weights file can be swapped
(Phase 2 pretrained/generic -> Phase 3 fine-tuned) without touching
counter.py or any calling code.
"""

from __future__ import annotations

from functools import lru_cache

import torch
from ultralytics import YOLO

from app.config import settings


def _configure_threads() -> None:
    """Pin torch's intra-op thread count.

    torch defaults to one thread per *host* core, but a container gets a
    fraction of a core (Render's free tier allots 0.1 CPU) — so it spawns
    tens of threads that then thrash against each other for a sliver of
    real CPU, and the contention costs far more than the parallelism wins.
    Measured directly on this workload even on unconstrained hardware:
    1 thread 50ms/tile, 2 threads 56ms, 4 threads 60ms — more threads is
    strictly slower here, because a tile is small enough that per-op
    threading overhead dominates. The effect is much larger inside a
    fractional-CPU cgroup, where this was a main contributor to production
    counts taking ~170s that take ~2s locally.
    """
    if settings.TORCH_NUM_THREADS > 0:
        torch.set_num_threads(settings.TORCH_NUM_THREADS)
        # Inter-op parallelism can only be set before any parallel work has
        # started; ignore if torch has already initialized it.
        try:
            torch.set_num_interop_threads(settings.TORCH_NUM_THREADS)
        except RuntimeError:
            pass


_configure_threads()


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
