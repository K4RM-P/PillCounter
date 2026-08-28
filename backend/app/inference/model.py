"""YOLOv8 model loading, isolated so the weights file can be swapped
(Phase 2 pretrained/generic -> Phase 3 fine-tuned) without touching
counter.py or any calling code.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
import torch
from ultralytics import YOLO
from ultralytics import utils as ultralytics_utils
from ultralytics.utils import torch_utils

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
    if settings.TORCH_NUM_THREADS <= 0:
        return

    # ultralytics derives its own NUM_THREADS from os.cpu_count() — the
    # *host's* core count, which ignores the container's CPU limit entirely
    # — and re-applies it via torch.set_num_threads() inside every
    # predict() call (ultralytics/utils/torch_utils.py). So setting torch's
    # thread count once at startup is silently undone on the first
    # inference; this overrides ultralytics' value at the source too.
    # Verified: without this, torch.get_num_threads() reads 1 after startup
    # but 8 again after a single predict().
    ultralytics_utils.NUM_THREADS = settings.TORCH_NUM_THREADS
    torch_utils.NUM_THREADS = settings.TORCH_NUM_THREADS

    torch.set_num_threads(settings.TORCH_NUM_THREADS)
    # Inter-op parallelism can only be set before any parallel work has
    # started; ignore if torch has already initialized it.
    try:
        torch.set_num_interop_threads(settings.TORCH_NUM_THREADS)
    except RuntimeError:
        pass


def enforce_threads() -> None:
    """Re-assert the thread cap immediately before inference.

    Belt-and-braces against the ultralytics override described above: even
    if a future version reintroduces it by another path, this keeps the cap
    effective. torch.set_num_threads is a cheap no-op when already correct.
    """
    if settings.TORCH_NUM_THREADS > 0 and torch.get_num_threads() != settings.TORCH_NUM_THREADS:
        torch.set_num_threads(settings.TORCH_NUM_THREADS)


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
    if settings.CHANNELS_LAST:
        # Layout-only change: convolution results are identical, but oneDNN
        # can select better-vectorised kernels for this layout on CPU.
        #
        # Order matters. ultralytics fuses conv+BN lazily on first predict,
        # and that fusion reshapes conv weights with .view(), which raises
        # on a channels-last tensor ("size is not compatible with input
        # tensor's stride"). So force the fuse first with a throwaway
        # inference, then convert the already-fused weights. This also
        # doubles as the warmup it replaces.
        try:
            model.predict(np.zeros((64, 64, 3), dtype=np.uint8), imgsz=64, verbose=False)
            model.model = model.model.to(memory_format=torch.channels_last)
        except Exception:
            # Never let an optimisation break inference; fall back to the
            # default layout, which is correct just slightly slower.
            pass
    return model
