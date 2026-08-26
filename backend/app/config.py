import os
from pathlib import Path


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
    # Slightly more overlap than SAHI's common 0.2 default, so a pill sitting
    # right on a tile boundary is less likely to be clipped in every tile it
    # appears in (which would drop it below DEDUP's min-box-fraction cutoff).
    TILE_OVERLAP: float = float(os.getenv("TILE_OVERLAP", "0.25"))
    # Adaptive histogram equalization (CLAHE) before detection — normalizes
    # glare/shadow variation across a tray photo. Applied only to the
    # model's input, not to the image used for color-outlier filtering.
    CONTRAST_ENHANCE: bool = os.getenv("CONTRAST_ENHANCE", "true").lower() == "true"
    # Detections whose centers are closer than this fraction of the median detected
    # pill diameter are treated as duplicates (e.g. from overlapping tile seams) and merged.
    DEDUP_DISTANCE_FRACTION: float = float(os.getenv("DEDUP_DISTANCE_FRACTION", "0.75"))

    # Inference device: "auto" picks MPS/CUDA if available, else CPU.
    INFERENCE_DEVICE: str = os.getenv("INFERENCE_DEVICE", "auto")

    # Shared single-login credential (PRD §7.5/§12) — not per-user accounts.
    AUTH_USERNAME: str = os.getenv("AUTH_USERNAME", "pharmacy")
    AUTH_PASSWORD: str = os.getenv("AUTH_PASSWORD", "changeme")
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-change-in-production")


settings = Settings()

Path(settings.IMAGE_STORAGE_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.DATABASE_URL.replace("sqlite:///", "")).parent.mkdir(parents=True, exist_ok=True)
