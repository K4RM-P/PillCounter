"""YOLOv8 model loading, isolated so the weights file can be swapped
(Phase 2 pretrained/generic -> Phase 3 fine-tuned) without touching
counter.py or any calling code.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

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


def _restrict_onnx_to_cpu() -> None:
    """Force ONNX Runtime to use its plain CPU execution provider.

    ultralytics hands onnxruntime *every* available provider and keeps
    whichever sorts first (nn/autobackend.py: it only ever filters out
    CUDA). The stock onnxruntime wheel advertises AzureExecutionProvider,
    which sorts ahead of CPU — so inference silently bound to it and a
    dense count that should take ~13s took 223s in production. Narrowing
    the advertised list is the least invasive way to pin the choice, since
    the provider list is read inside ultralytics rather than passed in.
    """
    import onnxruntime

    if getattr(onnxruntime, "_pillcount_cpu_only", False):
        return
    available = onnxruntime.get_available_providers
    onnxruntime.get_available_providers = lambda: [
        p for p in available() if p == "CPUExecutionProvider"
    ] or ["CPUExecutionProvider"]
    onnxruntime._pillcount_cpu_only = True


def _resolve_weights(path: str) -> str:
    """Swap a .pt path for its ONNX export when one exists.

    Keeps the ONNX build an infrastructure detail: callers (and the
    frontend's model-version picker) keep naming pill_v2.pt / pill_v3.pt,
    and this transparently runs the faster engine when that export has been
    checked in. Falls back silently to the .pt if the export is missing, so
    a missing/failed export degrades to the old speed rather than an error.
    """
    if not settings.ONNX_RUNTIME_ENABLED or not path.endswith(".pt"):
        return path
    onnx_path = path[: -len(".pt")] + ".onnx"
    return onnx_path if Path(onnx_path).exists() else path


def _onnx_input_size(path: str) -> int | None:
    """The static square input size an ONNX export was built for.

    Read from the file rather than configured, so the pipeline's inference
    size can never silently drift out of sync with what the model actually
    accepts — a mismatch is a hard onnxruntime error, not a quiet accuracy
    regression. Returns None for a dynamic-axis export, which needs no
    pinning.
    """
    import onnxruntime

    session = onnxruntime.InferenceSession(path, providers=["CPUExecutionProvider"])
    try:
        shape = session.get_inputs()[0].shape  # [batch, 3, H, W]
        height, width = shape[2], shape[3]
    finally:
        del session
    if isinstance(height, int) and isinstance(width, int) and height == width:
        return height
    return None


@lru_cache(maxsize=settings.MODEL_CACHE_SIZE)
def get_model(weights_path: str | None = None) -> YOLO:
    """Cached per weights path — lets multiple model versions (e.g. for A/B
    testing candidate weights against the production default) be loaded and
    reused within the same process instead of reloading from disk per request."""
    path = _resolve_weights(weights_path or settings.MODEL_WEIGHTS_PATH)
    is_onnx = not str(path).endswith(".pt")
    # Must precede YOLO(), which reads the provider list when it builds its
    # backend — patching afterwards would be too late for the session.
    if is_onnx:
        _restrict_onnx_to_cpu()
    model = YOLO(path)
    # Exported runtimes (ONNX) own their own execution provider and reject
    # .to() — device placement only applies to the PyTorch format. They are
    # also exported at one static input size, so record it: every predict
    # call must use exactly that size or onnxruntime rejects the input.
    if is_onnx:
        model.pillcount_fixed_imgsz = _onnx_input_size(path)
        return model
    # Warm up on the actual inference device so the first real request isn't
    # slowed by lazy weight transfer/kernel compilation.
    model.to(resolve_device())
    return model
