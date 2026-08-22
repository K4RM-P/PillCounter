from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Count(Base):
    __tablename__ = "counts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    image_id: Mapped[str] = mapped_column(String, nullable=False)
    detections: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
