import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.config import settings
from app.db import get_db
from app.inference.counter import count_pills
from app.inference.quality import assess_image_quality
from app.models import Count
from app.schemas import CountCreate, CountDetail, CountOut, CountResponse
from app.storage import save_image

# uvicorn only configures its own loggers, so a bare __name__ logger
# would be dropped in production; reuse uvicorn's so this reaches Render.
logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])

# count_pills is synchronous CPU-bound work; running it in a dedicated
# executor (rather than FastAPI's default one) lets us attach a hard
# wall-clock timeout via asyncio.wait_for without touching the rest of the
# app's thread pool. Worker count also bounds peak memory: two concurrent
# inference calls each holding their own tiled/multi-scale image buffers is
# what pushed the free-tier instance over its 512MB ceiling, so Render caps
# this to 1 to force requests to queue instead of running in parallel.
_inference_executor = ThreadPoolExecutor(max_workers=settings.INFERENCE_MAX_WORKERS)


@router.post("/count", response_model=CountResponse)
async def count_image(file: UploadFile, model_version: Optional[str] = Form(default=None)):
    data = await file.read()
    np_data = np.frombuffer(data, np.uint8)
    image = cv2.imdecode(np_data, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    decoded_height, decoded_width = image.shape[:2]
    logger.info(
        "count request: %d bytes -> decoded %dx%d",
        len(data), decoded_width, decoded_height,
    )
    longest_side = max(decoded_height, decoded_width)
    if longest_side > settings.MAX_IMAGE_DIMENSION:
        scale = settings.MAX_IMAGE_DIMENSION / longest_side
        image = cv2.resize(
            image,
            (round(decoded_width * scale), round(decoded_height * scale)),
            interpolation=cv2.INTER_AREA,
        )

    weights_path = None
    ensemble = False
    warnings: list[str] = []
    if model_version == "ensemble":
        if settings.ENSEMBLE_ENABLED:
            ensemble = True
        else:
            # Ensemble genuinely doubles inference cost, which this
            # deployment's hardware can't reliably absorb — fall back to the
            # default single model instead of failing outright, so a client
            # with "ensemble" persisted from earlier testing still gets a
            # normal, timely count rather than an error.
            warnings.append("Ensemble comparison is unavailable on this server right now — used the default model instead.")
    elif model_version is not None:
        weights_path = settings.MODEL_VERSIONS.get(model_version)
        if weights_path is None:
            raise HTTPException(status_code=400, detail=f"Unknown model_version '{model_version}'")

    height, width = image.shape[:2]
    loop = asyncio.get_running_loop()
    try:
        detections = await asyncio.wait_for(
            loop.run_in_executor(_inference_executor, count_pills, image, weights_path, ensemble),
            timeout=settings.INFERENCE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail="Counting took too long for this photo on the current server. Try again — a warm server is usually much faster — or retake the photo with fewer/less densely packed pills.",
        )
    detections = [d for d in detections if d["confidence"] >= settings.CONFIDENCE_THRESHOLD]
    warnings += assess_image_quality(image)

    image_id = save_image(data)

    return CountResponse(
        image_id=image_id,
        count=len(detections),
        detections=detections,
        width=width,
        height=height,
        warnings=warnings,
    )


@router.post("/counts", response_model=CountOut)
def create_count(payload: CountCreate, db: Session = Depends(get_db)):
    record = Count(
        label=payload.label,
        count=len(payload.detections),
        image_id=payload.image_id,
        detections=[d.model_dump() for d in payload.detections],
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/counts", response_model=list[CountOut])
def list_counts(db: Session = Depends(get_db)):
    return db.query(Count).order_by(Count.created_at.desc()).all()


@router.get("/counts/{count_id}", response_model=CountDetail)
def get_count(count_id: int, db: Session = Depends(get_db)):
    record = db.get(Count, count_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Count not found")
    return record
