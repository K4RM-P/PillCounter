"""Pill counting inference.

Fine-tuned YOLOv8 weights (see backend/ml/) detect individual pills. For
dense trays of many small/touching pills, a single full-image pass loses too
much per-pill resolution once downscaled to the model's input size — so
large images are sliced into overlapping tiles, detected individually, then
merged with distance-based deduplication to avoid double-counting pills that
fall in the overlap between tiles.

Public interface — count_pills(image) -> [{x, y, confidence}] — is the
contract calling code depends on and stays stable regardless of these
internal accuracy improvements.
"""

from __future__ import annotations

import cv2
import numpy as np

from app.config import settings
from app.inference.model import get_model, resolve_device


def _enhance_contrast(image: np.ndarray) -> np.ndarray:
    """CLAHE (adaptive histogram equalization) on the lightness channel —
    normalizes glare/shadow/lighting variation across a tray photo before
    detection. Only used for the model's input; the original `image` is
    kept for color-based filtering downstream so that step still sees true
    pill colors, not contrast-boosted ones."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced_l = clahe.apply(l_channel)
    enhanced_lab = cv2.merge((enhanced_l, a_channel, b_channel))
    return cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)


def count_pills(image: np.ndarray) -> list[dict]:
    model = get_model()
    device = resolve_device()
    height, width = image.shape[:2]
    detection_input = _enhance_contrast(image) if settings.CONTRAST_ENHANCE else image

    if settings.TILE_INFERENCE and max(height, width) > settings.TILE_MIN_IMAGE_SIZE:
        raw_detections = _tiled_detections(model, detection_input, device)
    else:
        result = _predict(model, detection_input, device)
        raw_detections = _boxes_from_result(result)

    deduped = _dedup(raw_detections)
    size_filtered = _filter_size_shape_outliers(deduped)
    color_filtered = _filter_color_outliers(image, size_filtered)
    return [{"x": d["x"], "y": d["y"], "confidence": d["confidence"]} for d in color_filtered]


def _predict(model, image: np.ndarray, device: str, imgsz: int | None = None):
    return model.predict(
        image,
        imgsz=imgsz or settings.INFERENCE_IMGSZ,
        iou=settings.NMS_IOU_THRESHOLD,
        max_det=settings.MAX_DETECTIONS,
        augment=settings.TTA_AUGMENT,
        device=device,
        verbose=False,
    )[0]


def _boxes_from_result(result, offset_x: float = 0.0, offset_y: float = 0.0) -> list[dict]:
    detections = []
    for box in result.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        confidence = float(box.conf[0])
        detections.append(
            {
                "x": (x1 + x2) / 2 + offset_x,
                "y": (y1 + y2) / 2 + offset_y,
                "confidence": confidence,
                "_w": x2 - x1,
                "_h": y2 - y1,
            }
        )
    return detections


def _tile_starts(dim: int, tile: int, stride: int) -> list[int]:
    if dim <= tile:
        return [0]
    starts = list(range(0, dim - tile + 1, stride))
    if starts[-1] != dim - tile:
        starts.append(dim - tile)
    return starts


def _tiled_detections(model, image: np.ndarray, device: str) -> list[dict]:
    height, width = image.shape[:2]
    tile = settings.TILE_SIZE
    stride = max(1, int(tile * (1 - settings.TILE_OVERLAP)))

    detections = []
    for y in _tile_starts(height, tile, stride):
        for x in _tile_starts(width, tile, stride):
            crop = image[y : min(y + tile, height), x : min(x + tile, width)]
            if crop.size == 0:
                continue
            result = _predict(model, crop, device, imgsz=settings.INFERENCE_IMGSZ)
            detections.extend(_boxes_from_result(result, offset_x=x, offset_y=y))
    return detections


def _dedup(detections: list[dict]) -> list[dict]:
    """Merges detections whose centers are closer than a fraction of the
    median pill size — handles the same pill being detected in two
    overlapping tiles, or (rarely) twice within one tile."""
    if not detections:
        return detections

    sizes = [max(d["_w"], d["_h"]) for d in detections if d["_w"] > 0 and d["_h"] > 0]
    median_size = sorted(sizes)[len(sizes) // 2] if sizes else 20.0
    threshold = median_size * settings.DEDUP_DISTANCE_FRACTION

    ordered = sorted(detections, key=lambda d: d["confidence"], reverse=True)
    kept: list[dict] = []
    for d in ordered:
        if any(((d["x"] - k["x"]) ** 2 + (d["y"] - k["y"]) ** 2) ** 0.5 < threshold for k in kept):
            continue
        kept.append(d)
    return kept


def _filter_size_shape_outliers(detections: list[dict]) -> list[dict]:
    """Real pills in one tray photo are close to uniform in size and shape —
    but "uniform shape" doesn't mean circular, pills are round, oval, or
    capsule-shaped depending on the medication. So instead of assuming a
    fixed target shape, this compares each detection's size and aspect
    ratio against the *median of this photo's own population*. Tray
    hardware (hinges, screws, rivets) that slips past the confidence
    threshold tends to stand out from whatever the pills in this photo
    actually look like, so it's the outliers relative to the batch that get
    dropped — not detections that fail some absolute "must be round" rule.
    This only engages once there's enough of a sample to establish what
    "normal" looks like for this photo; on a handful of detections the
    stats aren't reliable enough to safely reject anything.
    """
    if len(detections) < 8:
        return detections

    sized = [d for d in detections if d["_w"] > 0 and d["_h"] > 0]
    if len(sized) < 8:
        return detections

    diagonals = sorted(max(d["_w"], d["_h"]) for d in sized)
    median_diag = diagonals[len(diagonals) // 2]

    aspects = sorted(max(d["_w"], d["_h"]) / max(1e-6, min(d["_w"], d["_h"])) for d in sized)
    median_aspect = aspects[len(aspects) // 2]

    kept = []
    for d in detections:
        if d["_w"] <= 0 or d["_h"] <= 0:
            kept.append(d)
            continue
        diag = max(d["_w"], d["_h"])
        aspect = max(d["_w"], d["_h"]) / max(1e-6, min(d["_w"], d["_h"]))
        # Reject boxes far smaller/larger than this photo's typical pill.
        if diag < median_diag * 0.4 or diag > median_diag * 2.5:
            continue
        # Reject boxes whose elongation is way off from this photo's typical
        # pill shape (e.g. a round screw among oval tablets, or vice versa),
        # rather than assuming pills must be round.
        if aspect > median_aspect * 2.5 + 0.5:
            continue
        kept.append(d)
    return kept


def _sample_patch_color(image: np.ndarray, d: dict) -> np.ndarray | None:
    height, width = image.shape[:2]
    half = max(2, int(max(d["_w"], d["_h"]) * 0.25))
    cx, cy = int(d["x"]), int(d["y"])
    x1, x2 = max(0, cx - half), min(width, cx + half)
    y1, y2 = max(0, cy - half), min(height, cy + half)
    patch = image[y1:y2, x1:x2]
    if patch.size == 0:
        return None
    return patch.reshape(-1, 3).mean(axis=0)


def _filter_color_outliers(image: np.ndarray, detections: list[dict]) -> list[dict]:
    """Tray hardware (screws, hinges) that survives the size/shape filter
    because it happens to be pill-sized and roughly round is usually still
    a different color from the pills themselves (e.g. metallic gray vs a
    white/colored tablet). Detections whose sampled pixel color is a
    statistical outlier relative to the rest of the population are dropped.
    Only engages with enough detections to establish a reliable baseline.
    """
    if len(detections) < 8:
        return detections

    colors = []
    for d in detections:
        d["_color"] = _sample_patch_color(image, d)
        if d["_color"] is not None:
            colors.append(d["_color"])
    if len(colors) < 8:
        return detections

    colors_arr = np.array(colors)
    median_color = np.median(colors_arr, axis=0)
    std = colors_arr.std(axis=0) + 1e-6

    kept = []
    for d in detections:
        color = d.get("_color")
        if color is None:
            kept.append(d)
            continue
        z_score = float(np.sqrt(np.sum(((color - median_color) / std) ** 2)))
        if z_score > 3.0:
            continue
        kept.append(d)
    return kept
