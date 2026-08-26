"""Regression check for pill-counting accuracy against a known-count photo.

Not a hermetic unit test — it exercises the real fine-tuned model against a
real tray photo kept outside the repo, so it's skipped where that photo
isn't available (e.g. CI). Its purpose is to catch future regressions in
counter.py/config.py against a known ground truth during local development.
"""

import os

import cv2
import pytest

from app.config import settings
from app.inference.counter import count_pills

SAMPLE_IMAGE_PATH = os.path.expanduser("~/Downloads/IMG_0177.jpg")
SAMPLE_IMAGE_TRUE_COUNT = 13


@pytest.mark.skipif(not os.path.exists(SAMPLE_IMAGE_PATH), reason="sample photo not present locally")
def test_known_pill_count_within_tolerance():
    image = cv2.imread(SAMPLE_IMAGE_PATH)
    assert image is not None

    detections = count_pills(image)
    detections = [d for d in detections if d["confidence"] >= settings.CONFIDENCE_THRESHOLD]

    assert abs(len(detections) - SAMPLE_IMAGE_TRUE_COUNT) <= 2
