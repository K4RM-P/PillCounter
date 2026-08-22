"""Phase 1 placeholder counter: classical OpenCV blob/contour detection.

Superseded by YOLOv8 inference (see model.py / counter.py) as of Phase 2.
Kept around as a zero-dependency reference implementation — useful for
quick local testing without a model file.
"""

import cv2
import numpy as np

MIN_AREA = 50
MAX_AREA = 20000
MIN_CIRCULARITY = 0.5


def count_pills(image: np.ndarray) -> list[dict]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    detections = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < MIN_AREA or area > MAX_AREA:
            continue

        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0:
            continue

        circularity = 4 * np.pi * area / (perimeter ** 2)
        if circularity < MIN_CIRCULARITY:
            continue

        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            continue

        cx = moments["m10"] / moments["m00"]
        cy = moments["m01"] / moments["m00"]
        confidence = min(1.0, circularity)

        detections.append({"x": cx, "y": cy, "confidence": confidence})

    return detections
