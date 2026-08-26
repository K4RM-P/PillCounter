from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str


class Detection(BaseModel):
    x: float
    y: float
    confidence: float


class CountResponse(BaseModel):
    image_id: str
    count: int
    detections: list[Detection]
    # The exact pixel dimensions of the image the detections were computed
    # against — the authoritative source for normalizing detection
    # coordinates client-side, so the frontend never has to re-derive
    # dimensions from the uploaded blob itself (a second, potentially
    # inconsistent measurement of the same image).
    width: int
    height: int


class CountCreate(BaseModel):
    image_id: str
    label: Optional[str] = None
    detections: list[Detection]


class CountOut(BaseModel):
    id: int
    label: Optional[str]
    count: int
    image_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CountDetail(CountOut):
    detections: list[Detection]
