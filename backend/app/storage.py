"""Local-disk image storage.

Public interface (save_image / get_image_path / image_exists) is the contract
other code should depend on. Swapping to S3-compatible storage later means
reimplementing this module only — callers never touch paths directly.
"""

import uuid
from pathlib import Path
from typing import Optional

from app.config import settings

_STORAGE_DIR = Path(settings.IMAGE_STORAGE_DIR)


def save_image(data: bytes, ext: str = ".jpg") -> str:
    image_id = uuid.uuid4().hex
    path = _STORAGE_DIR / f"{image_id}{ext}"
    path.write_bytes(data)
    return image_id


def get_image_path(image_id: str) -> Optional[Path]:
    matches = list(_STORAGE_DIR.glob(f"{image_id}.*"))
    return matches[0] if matches else None


def image_exists(image_id: str) -> bool:
    return get_image_path(image_id) is not None
