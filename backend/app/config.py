import os
from pathlib import Path
from typing import Optional


class Settings:
    IMAGE_STORAGE_DIR: str = os.getenv("IMAGE_STORAGE_DIR", "./data/images")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./data/pillcount.db")
    # Detections below this confidence are dropped before count/response.
    # Kept as a tunable constant since it will need adjusting as the model changes (Phase 2/3).
    CONFIDENCE_THRESHOLD: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.6"))

    # Path or name of the YOLOv8 weights file loaded by app.inference.model.
    # Fine-tuned on pill trays (backend/ml/train.py); pill_v2.pt empirically
    # outperforms pill_v1.pt and the old generic-COCO default on real tray
    # photos (yolov8n.pt was never trained on pills at all).
    MODEL_WEIGHTS_PATH: str = os.getenv("MODEL_WEIGHTS_PATH", "ml/weights/pill_v2.pt")

    # Named model versions selectable per-request (see routers/counts.py) for
    # A/B comparing a candidate fine-tune against the production default
    # without redeploying. Keys are what the frontend passes as `model_version`.
    MODEL_VERSIONS: dict[str, str] = {
        "v2": "ml/weights/pill_v2.pt",
        "v3": "ml/weights/pill_v3.pt",
    }

    # Inference tuning — separate from training imgsz so it can be raised without retraining.
    # Higher imgsz helps separate small/touching pills at inference time.
    INFERENCE_IMGSZ: int = int(os.getenv("INFERENCE_IMGSZ", "1280"))
    # Higher IoU threshold = NMS suppresses fewer overlapping boxes, so touching/adjacent
    # pills are less likely to get merged into one detection. True duplicate boxes (same
    # pill detected twice) are instead caught by the distance-based _dedup step below,
    # which is more precise than IoU for this since it's based on actual pill size.
    NMS_IOU_THRESHOLD: float = float(os.getenv("NMS_IOU_THRESHOLD", "0.6"))
    # Raised above ultralytics' default (300) since dense trays can exceed it.
    MAX_DETECTIONS: int = int(os.getenv("MAX_DETECTIONS", "1500"))
    # Test-time augmentation (flips/scales, averaged) — more accurate, slower. Fine for
    # this use case since counts aren't produced in real time.
    TTA_AUGMENT: bool = os.getenv("TTA_AUGMENT", "true").lower() == "true"

    # Tiled inference: slice large images into overlapping tiles, detect per tile, then
    # merge — dramatically improves recall/precision on dense trays of many tiny pills
    # where a single downsized full-image pass loses resolution per pill.
    TILE_INFERENCE: bool = os.getenv("TILE_INFERENCE", "true").lower() == "true"
    # Tiling only kicks in once the image exceeds this size in either dimension.
    TILE_MIN_IMAGE_SIZE: int = int(os.getenv("TILE_MIN_IMAGE_SIZE", "1000"))
    TILE_SIZE: int = int(os.getenv("TILE_SIZE", "800"))
    # More overlap than SAHI's common 0.2 default, so a pill sitting right on
    # a tile boundary is less likely to be clipped in every tile it appears
    # in (which would drop it below DEDUP's min-box-fraction cutoff).
    # Tested raising this further (0.28-0.35) expecting a straightforward
    # improvement — measured instead that it increases raw candidate density
    # enough to raise the odds of two distinct, closely-spaced real pills
    # getting merged by dedup, with no consistent net benefit across the
    # test set. Left at the original, empirically-better value.
    TILE_OVERLAP: float = float(os.getenv("TILE_OVERLAP", "0.25"))
    # Also run one full-image detection pass and union its results with the
    # tiled passes (via the normal dedup step) — purely additive, since a
    # pill sitting awkwardly across several tile seams that tile overlap
    # alone didn't fully protect can still be caught whole by the full pass.
    # Doubles inference cost on large images when enabled.
    FULL_PASS_UNION: bool = os.getenv("FULL_PASS_UNION", "true").lower() == "true"
    # Run detection at a second imgsz and union results with the primary
    # scale — different scales catch different failure modes (a lower imgsz
    # sees more context per tile, a higher one preserves more per-pill
    # pixel detail). Purely additive; roughly doubles inference cost.
    MULTI_SCALE_FUSION: bool = os.getenv("MULTI_SCALE_FUSION", "true").lower() == "true"
    INFERENCE_IMGSZ_SECONDARY: int = int(os.getenv("INFERENCE_IMGSZ_SECONDARY", "960"))
    # After the main detection pass, re-detect inside a tight crop around
    # the existing detections' bounding region (see
    # counter.py:_dense_recrop_detections) — the crop is physically smaller
    # than the full photo, so each pill gets more of the model's input
    # resolution, which can recover pills missed in the very densest part of
    # a photo. Purely additive: only ever proposes more dedup candidates.
    DENSE_RECROP_ENABLED: bool = os.getenv("DENSE_RECROP_ENABLED", "true").lower() == "true"
    DENSE_RECROP_MIN_DETECTIONS: int = int(os.getenv("DENSE_RECROP_MIN_DETECTIONS", "20"))
    # Adaptive histogram equalization (CLAHE) before detection — normalizes
    # glare/shadow variation across a tray photo. Applied only to the
    # model's input, not to the image used for color-outlier filtering.
    CONTRAST_ENHANCE: bool = os.getenv("CONTRAST_ENHANCE", "true").lower() == "true"
    # Detections whose centers are closer than this fraction of the median detected
    # pill diameter are treated as duplicates (e.g. from overlapping tile seams) and merged.
    DEDUP_DISTANCE_FRACTION: float = float(os.getenv("DEDUP_DISTANCE_FRACTION", "0.75"))

    # Inference device: "auto" picks MPS/CUDA if available, else CPU.
    INFERENCE_DEVICE: str = os.getenv("INFERENCE_DEVICE", "auto")

    # Hold conv weights in channels-last memory layout. Pure layout change —
    # same fp32 weights, same math, counts verified unchanged — but it lets
    # oneDNN pick better-vectorised kernels: measured 851.7ms -> 749.9ms per
    # forward pass on the deployed AMD EPYC (see /api/_bench).
    CHANNELS_LAST: bool = os.getenv("CHANNELS_LAST", "true").lower() == "true"

    # torch intra-op thread count; 0 leaves torch's default (one thread per
    # host core). Defaults to 1 because more threads measured strictly
    # slower on this workload even on unconstrained hardware, and much
    # worse inside a fractional-CPU container. See model._configure_threads.
    TORCH_NUM_THREADS: int = int(os.getenv("TORCH_NUM_THREADS", "1"))

    # get_model() lru_cache size — each cached entry is a full YOLO model
    # resident in memory. Free-tier hosting has a hard 512MB ceiling, and a
    # client flipping between v2/v3 (or ensemble touching both) can easily
    # hold 2+ models cached at once; left generous by default for local dev
    # where memory isn't a constraint. Render overrides this to 1 so
    # switching versions evicts the previous one instead of stacking.
    MODEL_CACHE_SIZE: int = int(os.getenv("MODEL_CACHE_SIZE", "4"))

    # Largest dimension (px) a decoded upload is allowed to keep before
    # inference — anything bigger is downscaled server-side regardless of
    # what the client sent. This is the actual memory ceiling: a 6000px
    # image plus its tiled/CLAHE/multi-scale working copies can run several
    # hundred MB per in-flight request on its own. The frontend already caps
    # uploads at 6000px, but this is the backstop that holds regardless of
    # client behavior. Render overrides this lower to fit the free tier.
    MAX_IMAGE_DIMENSION: int = int(os.getenv("MAX_IMAGE_DIMENSION", "6000"))

    # Concurrent inference workers (routers/counts.py). Each worker can hold
    # a large image plus tiled/multi-scale copies in memory at once, so this
    # doubles as a peak-memory cap on free-tier hosting; requests queue
    # behind INFERENCE_TIMEOUT_SECONDS instead of running in parallel.
    INFERENCE_MAX_WORKERS: int = int(os.getenv("INFERENCE_MAX_WORKERS", "2"))

    # Ensemble mode (see routers/counts.py) runs the *entire* tiled pipeline
    # twice — once per model version — which on Render's free shared CPU is
    # enough on its own to blow past both the client's upload timeout and
    # any patience a user has, even with every other cost-doubling knob
    # above already turned off. When disabled, a request asking for ensemble
    # silently falls back to the default single model instead of erroring,
    # so a client with "ensemble" persisted in localStorage from earlier
    # testing still gets a normal, timely count.
    ENSEMBLE_ENABLED: bool = os.getenv("ENSEMBLE_ENABLED", "true").lower() == "true"

    # Hard ceiling on a single count request's inference time. Without this,
    # an unusually dense/large photo can run long enough that the request
    # just hangs from the user's perspective until the client's own timeout
    # gives up — with no clear error, just an endless spinner. Set below the
    # client's upload timeout so the server fails fast with an actionable
    # message instead. None (default) means no cap, for local dev on faster
    # hardware where this was never observed.
    INFERENCE_TIMEOUT_SECONDS: Optional[float] = (
        float(os.getenv("INFERENCE_TIMEOUT_SECONDS")) if os.getenv("INFERENCE_TIMEOUT_SECONDS") else None
    )

    # Shared single-login credential (PRD §7.5/§12) — not per-user accounts.
    AUTH_USERNAME: str = os.getenv("AUTH_USERNAME", "pharmacy")
    AUTH_PASSWORD: str = os.getenv("AUTH_PASSWORD", "changeme")
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-change-in-production")


settings = Settings()

Path(settings.IMAGE_STORAGE_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.DATABASE_URL.replace("sqlite:///", "")).parent.mkdir(parents=True, exist_ok=True)
