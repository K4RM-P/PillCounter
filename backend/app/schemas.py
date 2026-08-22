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
