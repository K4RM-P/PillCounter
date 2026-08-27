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

# Reference max-dimension (pixels) that TILE_SIZE/TILE_OVERLAP were tuned
# against — see _tiled_detections.
TILE_SIZE_REFERENCE_DIM = 4032


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


def count_pills(image: np.ndarray, weights_path: str | None = None) -> list[dict]:
    model = get_model(weights_path)
    device = resolve_device()
    height, width = image.shape[:2]
    detection_input = _enhance_contrast(image) if settings.CONTRAST_ENHANCE else image

    if settings.TILE_INFERENCE and max(height, width) > settings.TILE_MIN_IMAGE_SIZE:
        raw_detections = _tiled_detections(model, detection_input, device)
    else:
        result = _predict(model, detection_input, device)
        raw_detections = _boxes_from_result(result)

    deduped = _dedup(raw_detections)
    tray_filtered = _filter_outside_tray(image, deduped)
    size_filtered = _filter_size_shape_outliers(tray_filtered)
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
    # Scale tile size proportionally to the actual photo's resolution — a
    # fixed pixel tile size makes pills occupy a smaller fraction of each
    # tile (and thus less model input resolution) on a lower-res photo than
    # on the ~4032px reference photos TILE_SIZE was tuned against, which
    # measurably hurts recall on dense/overlapping pills at common
    # non-reference resolutions (e.g. 3000-3200px). Scaling keeps that ratio
    # consistent regardless of the source photo's actual resolution.
    tile = max(400, round(settings.TILE_SIZE * max(height, width) / TILE_SIZE_REFERENCE_DIM))
    stride = max(1, int(tile * (1 - settings.TILE_OVERLAP)))

    detections = []
    for y in _tile_starts(height, tile, stride):
        for x in _tile_starts(width, tile, stride):
            y2, x2 = min(y + tile, height), min(x + tile, width)
            crop = image[y:y2, x:x2]
            if crop.size == 0:
                continue
            # Ragged edge tiles (image not an exact multiple of tile size) are
            # smaller than `tile x tile`, which changes their effective scale
            # once the model letterboxes them to imgsz — mirror-pad back up to
            # full tile size so every tile is detected at the same scale.
            pad_h, pad_w = tile - crop.shape[0], tile - crop.shape[1]
            if pad_h > 0 or pad_w > 0:
                crop = cv2.copyMakeBorder(crop, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)
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
        match = next(
            (k for k in kept if ((d["x"] - k["_anchor_x"]) ** 2 + (d["y"] - k["_anchor_y"]) ** 2) ** 0.5 < threshold),
            None,
        )
        if match is None:
            kept.append(dict(d, _n=1, _anchor_x=d["x"], _anchor_y=d["y"]))
            continue
        # Confidence-weighted running average of the merged boxes' centers/size
        # (a lightweight weighted-box-fusion) instead of just keeping the
        # highest-confidence box's raw center — the same pill seen from two
        # tiles rarely has its true center exactly on either single detection.
        # Matching itself always compares against the original highest-
        # confidence anchor position (not the drifting blended average) so
        # merges can't chain into unrelated nearby pills.
        n = match["_n"]
        total_w = match["confidence"] * n + d["confidence"]
        for key in ("x", "y", "_w", "_h"):
            match[key] = (match[key] * match["confidence"] * n + d[key] * d["confidence"]) / total_w
        match["confidence"] = max(match["confidence"], d["confidence"])
        match["_n"] = n + 1
    for k in kept:
        k.pop("_anchor_x", None)
        k.pop("_anchor_y", None)
    return kept


def _filter_outside_tray(image: np.ndarray, detections: list[dict]) -> list[dict]:
    """Drops detections that are spatial outliers from the main group —
    catches background clutter (table edges, nearby objects) that happens to
    look pill-sized/pill-colored/pill-shaped enough to pass the other
    filters, since none of those filters know anything about *where* the
    pills should be.

    Clusters detections by proximity to each other (not by tray/background
    pixel color — an earlier version tried that and silently deleted every
    detection on a transparent tray with light-colored pills, since nothing
    there contrasted against the border sample it used as "background").
    Keeps only the largest cluster, and only if it's a clear majority —
    otherwise there's no confident "this is the real group" signal, and
    it's safer to filter nothing than to risk mass-rejecting real pills.
    """
    if len(detections) < 3:
        return detections

    sizes = [max(d["_w"], d["_h"]) for d in detections if d.get("_w", 0) > 0 and d.get("_h", 0) > 0]
    median_size = sorted(sizes)[len(sizes) // 2] if sizes else 20.0
    # Generous multiple of pill size — real pills in one tray/pile are
    # typically within a few pill-widths of a neighbor; background clutter
    # tends to be much farther from the main group than that.
    threshold = median_size * 6.0

    n = len(detections)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            dx = detections[i]["x"] - detections[j]["x"]
            dy = detections[i]["y"] - detections[j]["y"]
            if (dx * dx + dy * dy) ** 0.5 < threshold:
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)

    largest = max(clusters.values(), key=len)
    if len(largest) < 0.6 * n:
        # No dominant cluster — detections are too spread out to confidently
        # call anything an "outlier". Don't filter.
        return detections

    largest_set = set(largest)
    return [d for idx, d in enumerate(detections) if idx in largest_set]


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
    # Median absolute deviation, not stddev: a couple of true outliers (tray
    # hardware, glare) inflate stddev enough to hide themselves as "within a
    # few sigma" of their own contamination. MAD (scaled by 1.4826 to match
    # stddev under a normal distribution) stays robust with a handful of
    # outliers in an otherwise tightly-clustered population of pill colors.
    mad = np.median(np.abs(colors_arr - median_color), axis=0) * 1.4826 + 1e-6

    kept = []
    for d in detections:
        color = d.get("_color")
        if color is None:
            kept.append(d)
            continue
        z_score = float(np.sqrt(np.sum(((color - median_color) / mad) ** 2)))
        # Threshold loosened from 3.0 now that _filter_outside_tray already
        # removes most background clutter before this runs — this filter's
        # remaining job is just tray hardware, so it can afford to be more
        # forgiving of legitimate pills darkened by shadow/overlap, which
        # otherwise got misclassified as color outliers themselves.
        if z_score > 5.0:
            continue
        kept.append(d)
    return kept
