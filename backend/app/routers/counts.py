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

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


@router.post("/count", response_model=CountResponse)
async def count_image(file: UploadFile, model_version: Optional[str] = Form(default=None)):
    data = await file.read()
    np_data = np.frombuffer(data, np.uint8)
    image = cv2.imdecode(np_data, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    weights_path = None
    ensemble = False
    if model_version == "ensemble":
        ensemble = True
    elif model_version is not None:
        weights_path = settings.MODEL_VERSIONS.get(model_version)
        if weights_path is None:
            raise HTTPException(status_code=400, detail=f"Unknown model_version '{model_version}'")

    height, width = image.shape[:2]
    detections = count_pills(image, weights_path=weights_path, ensemble=ensemble)
    detections = [d for d in detections if d["confidence"] >= settings.CONFIDENCE_THRESHOLD]
    warnings = assess_image_quality(image)

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
