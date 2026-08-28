"""Pill counting inference.

Fine-tuned YOLOv8 weights (see backend/ml/) detect individual pills. For
dense trays of many small/touching pills, a single full-image pass loses too
much per-pill resolution once downscaled to the model's input size — so
large images are sliced into overlapping tiles, detected individually, then
merged with distance-based deduplication to avoid double-counting pills that
fall in the overlap between tiles.

Every extra detection pass added here (multi-scale, the full-image union,
the dense-region recrop) is deliberately additive: it can only ever propose
*more* candidate boxes into the shared dedup/filter pipeline below, never
remove one directly. The only things allowed to remove a detection are the
filters, and each of those is scoped narrowly enough that a real pill can't
plausibly be mistaken for what it's looking for (see each filter's
docstring). This is a deliberate design rule, not an accident — the
project's history includes more than one filter that got too aggressive and
silently dropped real pills, which is a much worse failure mode than an
occasional false positive a human can just tap away.

Public interface — count_pills(image) -> [{x, y, confidence, size}] — is the
contract calling code depends on and stays stable regardless of these
internal accuracy improvements.
"""

from __future__ import annotations

import logging
import time

import cv2
import numpy as np
import torch

from app.config import settings
from app.inference.model import enforce_threads, get_model, resolve_device

# uvicorn only configures its own loggers, so a bare __name__ logger
# would be dropped in production; reuse uvicorn's so this reaches Render.
logger = logging.getLogger("uvicorn.error")

# Reference max-dimension (pixels) that TILE_SIZE/TILE_OVERLAP were tuned
# against — see _tiled_detections.
TILE_SIZE_REFERENCE_DIM = 4032

# Mirrors the frontend's own marker color bands (MarkerOverlay.jsx
# markerColor()) — >=CONFIDENT is shown purple/"Confident", <FLAGGED is
# shown red/"Flagged". Kept in sync so "flagged" means the same thing on
# both sides.
_CONFIDENT_THRESHOLD = 0.75
_FLAGGED_THRESHOLD = 0.5


class _StageTimer:
    """Per-stage wall-clock timing, logged once per count.

    Production counts were running ~100x slower than the same photo
    locally, and narrowing that down from the outside (total request time
    only) was guesswork — this reports where the time actually goes on the
    deployed hardware.
    """

    def __init__(self) -> None:
        self._start = time.perf_counter()
        self._last = self._start
        self._stages: list[str] = []

    def mark(self, name: str) -> None:
        now = time.perf_counter()
        self._stages.append(f"{name}={now - self._last:.1f}s")
        self._last = now

    def report(self, suffix: str = "") -> None:
        total = time.perf_counter() - self._start
        logger.info(
            "count_pills total=%.1fs %s threads=%d tiles=%d %s",
            total, " ".join(self._stages), torch.get_num_threads(), _TILE_COUNT[0], suffix,
        )


# Tiles inferred during the most recent detection pass — plain module state
# rather than threaded through every call signature, since it exists only
# for the timing log above and INFERENCE_MAX_WORKERS serializes counts.
_TILE_COUNT = [0]


def _enhance_contrast(image: np.ndarray) -> np.ndarray:
    """CLAHE (adaptive histogram equalization) on the lightness channel —
    normalizes glare/shadow variation across a tray photo before detection.
    Only used for the model's input; the original `image` is kept for
    color-based filtering downstream so that step still sees true pill
    colors, not contrast-boosted ones."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced_l = clahe.apply(l_channel)
    enhanced_lab = cv2.merge((enhanced_l, a_channel, b_channel))
    return cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)


def count_pills(image: np.ndarray, weights_path: str | None = None, ensemble: bool = False) -> list[dict]:
    """ensemble=True runs every configured model version (see
    settings.MODEL_VERSIONS) and unions their detections instead of a single
    model's. This can only ever add detections one model missed — it never
    removes a detection either model found. Each returned detection reports
    `agreement`: True if more than one model independently found it, so the
    frontend can surface disagreement as a review signal without it ever
    affecting whether something gets counted.
    """
    stage = _StageTimer()
    device = resolve_device()
    height, width = image.shape[:2]
    detection_input = _enhance_contrast(image) if settings.CONTRAST_ENHANCE else image
    stage.mark("contrast")

    if ensemble:
        raw_detections: list[dict] = []
        for version, path in settings.MODEL_VERSIONS.items():
            model = get_model(path)
            for d in _detect_raw(model, detection_input, device, height, width):
                d["_sources"] = {version}
                raw_detections.append(d)
    else:
        model = get_model(weights_path)
        stage.mark("model_load")
        raw_detections = _detect_raw(model, detection_input, device, height, width)
        for d in raw_detections:
            d.setdefault("_sources", set())
    stage.mark("detect")

    if settings.DENSE_RECROP_ENABLED and len(raw_detections) >= settings.DENSE_RECROP_MIN_DETECTIONS:
        recrop_model = get_model(weights_path) if not ensemble else get_model(settings.MODEL_WEIGHTS_PATH)
        recropped = _dense_recrop_detections(recrop_model, detection_input, device, raw_detections, height, width)
        for d in recropped:
            d.setdefault("_sources", set())
        raw_detections = raw_detections + recropped

    deduped = _dedup(raw_detections)
    tray_filtered = _filter_outside_tray(image, deduped)
    size_filtered = _filter_size_shape_outliers(tray_filtered)
    color_filtered = _filter_color_outliers(image, size_filtered)
    flagged_filtered = _filter_flagged_outliers(image, color_filtered)
    stage.mark("filters")
    stage.report(f"{width}x{height} raw={len(raw_detections)} final={len(flagged_filtered)}")
    return [
        {
            "x": d["x"],
            "y": d["y"],
            "confidence": d["confidence"],
            # Larger of the box's two dimensions, normalized to image width
            # so the frontend can size marker circles proportionally to
            # actual pill size without needing to know rendered pixel
            # dimensions — dividing by a single consistent axis (width)
            # keeps circles round regardless of the displayed image's aspect
            # ratio, unlike normalizing width/height separately would.
            "size": max(d["_w"], d["_h"]) / width if d.get("_w", 0) > 0 else None,
            "agreement": len(d.get("_sources", ())) > 1 if ensemble else None,
        }
        for d in flagged_filtered
    ]


def _inference_scales() -> list[int]:
    """Which imgsz values to run detection at. Multiple scales catch
    different failure modes (a lower imgsz sees more context per tile pass,
    a higher one preserves more per-pill pixel detail) — fusing both only
    adds candidate boxes into the shared dedup step below."""
    scales = [settings.INFERENCE_IMGSZ]
    if settings.MULTI_SCALE_FUSION and settings.INFERENCE_IMGSZ_SECONDARY != settings.INFERENCE_IMGSZ:
        scales.append(settings.INFERENCE_IMGSZ_SECONDARY)
    return scales


def _detect_raw(model, detection_input: np.ndarray, device: str, height: int, width: int) -> list[dict]:
    """Runs every configured detection pass (tiled, optionally unioned with
    a full-image pass, at one or more scales) and returns the combined,
    not-yet-deduplicated candidate boxes — deduplication happens exactly
    once, in count_pills, on the full pool from every pass together.

    An earlier version deduplicated each pass here and then again in
    count_pills. That turned out to be a real bug, not just redundant:
    _dedup's merge-distance threshold is derived from the median pill size
    *of the detections passed in*, and its weighted-box-fusion averaging
    shifts merged boxes' sizes slightly. Feeding already-fused output back
    into another dedup pass shifts that threshold again, and empirically
    caused a second round of merges that wrongly fused two distinct,
    closely-spaced real pills that the first pass had correctly kept
    separate — measured directly: double-dedup dropped a 13-pill reference
    photo to 9-10 even with every new detection pass disabled, i.e. it broke
    the existing baseline, not just the new additions. Dedup is not
    idempotent here, so it must run exactly once.
    """
    scales = _inference_scales()
    # A statically-shaped export runs every scale at its one input size, so
    # multi-scale fusion would repeat identical passes — same model, same
    # input, same output — and pay full inference cost per duplicate. Their
    # results would merge back together in dedup anyway, so collapse to a
    # single pass instead of doing the work twice.
    if getattr(model, "pillcount_fixed_imgsz", None) is not None:
        scales = scales[:1]
    detections: list[dict] = []
    use_tiling = settings.TILE_INFERENCE and max(height, width) > settings.TILE_MIN_IMAGE_SIZE

    if use_tiling:
        for imgsz in scales:
            detections.extend(_tiled_detections(model, detection_input, device, imgsz))
        if settings.FULL_PASS_UNION:
            # A single full-image pass loses per-pill resolution on a dense
            # tray (the whole reason tiling exists), so it won't reliably
            # find tiny/touching pills on its own — but it sees pills whole
            # that happen to sit awkwardly across several tile seams, which
            # tile overlap alone doesn't fully guarantee. Purely additive:
            # anything it finds just becomes another dedup candidate.
            for imgsz in scales:
                result = _predict(model, detection_input, device, imgsz=imgsz)
                detections.extend(_boxes_from_result(result))
    else:
        for imgsz in scales:
            result = _predict(model, detection_input, device, imgsz=imgsz)
            detections.extend(_boxes_from_result(result))

    return detections


def _dense_recrop_detections(
    model, detection_input: np.ndarray, device: str, existing: list[dict], height: int, width: int
) -> list[dict]:
    """Re-detects inside a tight crop around the existing detections'
    bounding region, at the standard imgsz — since the crop is physically
    smaller than the full photo, each pill occupies more of the model's
    input resolution than it did during tiling, which can recover pills
    missed in the very densest part of a photo. Purely additive: its output
    is just more candidates for the shared dedup step, never a replacement
    for the existing detections.
    """
    sized = [d for d in existing if d.get("_w", 0) > 0 and d.get("_h", 0) > 0]
    if not sized:
        return []

    xs = [d["x"] for d in existing]
    ys = [d["y"] for d in existing]
    sizes = sorted(max(d["_w"], d["_h"]) for d in sized)
    median_size = sizes[len(sizes) // 2]
    pad = median_size * 1.5

    x1, x2 = max(0.0, min(xs) - pad), min(float(width), max(xs) + pad)
    y1, y2 = max(0.0, min(ys) - pad), min(float(height), max(ys) + pad)
    crop_w, crop_h = x2 - x1, y2 - y1
    if crop_w <= 0 or crop_h <= 0:
        return []
    # Only worth it when the dense region is meaningfully smaller than the
    # full frame — otherwise there's no real resolution to gain by cropping.
    if crop_w * crop_h > 0.6 * width * height:
        return []

    crop = detection_input[int(y1) : int(y2), int(x1) : int(x2)]
    if crop.size == 0:
        return []
    result = _predict(model, crop, device, imgsz=settings.INFERENCE_IMGSZ)
    return _boxes_from_result(result, offset_x=x1, offset_y=y1)


def _predict(model, image: np.ndarray, device: str, imgsz: int | None = None):
    enforce_threads()
    # An ONNX export is built for one static input size; onnxruntime rejects
    # anything else outright. Overriding here — the single point every
    # detection pass (tiled, full-image, recrop, multi-scale) funnels
    # through — means no caller has to know which engine is loaded.
    # Ultralytics letterboxes each tile up to this size, so a tile of any
    # dimension still works.
    fixed = getattr(model, "pillcount_fixed_imgsz", None)
    return model.predict(
        image,
        imgsz=fixed or imgsz or settings.INFERENCE_IMGSZ,
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


def _tile_imgsz(tile: int, requested: int | None = None) -> int:
    """Model input size for a `tile`-pixel crop, never larger than the crop.

    Feeding a 595px tile to the model at imgsz=960 upscales it 1.6x, which
    costs ~2x the compute (measured: 50ms/tile vs 25ms) while adding no
    information — upscaling can't recover detail the crop doesn't have.
    Because tile size already scales with the source photo's resolution
    (see _tiled_detections), a fixed INFERENCE_IMGSZ is upscaling by a
    different, arbitrary factor at every input resolution; deriving it from
    the tile keeps the model at native scale regardless. Rounded up to a
    multiple of 32 (the model's stride) and still capped by the configured
    imgsz, so this only ever *lowers* compute, never raises it.
    """
    ceiling = requested or settings.INFERENCE_IMGSZ
    native = ((tile + 31) // 32) * 32
    return max(32, min(ceiling, native))


def _tiled_detections(model, image: np.ndarray, device: str, imgsz: int | None = None) -> list[dict]:
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
    _TILE_COUNT[0] = 0
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
            _TILE_COUNT[0] += 1
            result = _predict(model, crop, device, imgsz=_tile_imgsz(tile, imgsz))
            detections.extend(_boxes_from_result(result, offset_x=x, offset_y=y))
    return detections


def _dedup(detections: list[dict]) -> list[dict]:
    """Merges detections whose centers are closer than a fraction of the
    median pill size — handles the same pill being detected in two
    overlapping tiles, at two different scales, in both the tiled and
    full-image pass, or (rarely) twice within one pass."""
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
            kept.append(
                dict(d, _sum_w=d["confidence"], _wx=d["x"] * d["confidence"], _wy=d["y"] * d["confidence"],
                     _ww=d["_w"] * d["confidence"], _wh=d["_h"] * d["confidence"],
                     _anchor_x=d["x"], _anchor_y=d["y"], _sources=set(d.get("_sources", ())))
            )
            continue
        # True weighted-box-fusion average: each contributing detection's
        # original confidence weights its contribution to the merged
        # position/size, tracked as running weighted sums rather than a
        # sequential running average re-weighted by the (possibly already
        # maxed) merged confidence — that subtly distorts the result toward
        # whichever detection merged in first. Reported confidence is still
        # the max of the group (that's a calibration/threshold decision, not
        # a spatial one). Matching always compares against the original
        # highest-confidence anchor position (not the drifting fused
        # average) so merges can't chain into unrelated nearby pills.
        match["_sum_w"] += d["confidence"]
        match["_wx"] += d["x"] * d["confidence"]
        match["_wy"] += d["y"] * d["confidence"]
        match["_ww"] += d["_w"] * d["confidence"]
        match["_wh"] += d["_h"] * d["confidence"]
        match["x"] = match["_wx"] / match["_sum_w"]
        match["y"] = match["_wy"] / match["_sum_w"]
        match["_w"] = match["_ww"] / match["_sum_w"]
        match["_h"] = match["_wh"] / match["_sum_w"]
        match["confidence"] = max(match["confidence"], d["confidence"])
        match["_sources"] |= set(d.get("_sources", ()))
    for k in kept:
        for key in ("_anchor_x", "_anchor_y", "_sum_w", "_wx", "_wy", "_ww", "_wh"):
            k.pop(key, None)
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


def _short_long_axes(d: dict) -> tuple[float, float]:
    return min(d["_w"], d["_h"]), max(d["_w"], d["_h"])


def _filter_size_shape_outliers(detections: list[dict]) -> list[dict]:
    """Real pills in one tray photo are close to uniform in size — but a
    pill lying at an angle or "sideways" (viewed end-on rather than
    face-on, common for oval/capsule shapes) can look much shorter along
    its long axis than one lying flat, even though it's the same pill.
    Comparing against the population's *short* axis (width) — which stays
    roughly constant regardless of in-plane rotation or how much the pill
    is tilted/turned — instead of comparing against the long axis (which
    doesn't) means a sideways pill isn't mistaken for an undersized
    outlier. The long axis still gets an upper bound (nothing legitimate
    should be dramatically longer than the population), just no lower
    bound tied to elongation, since "shorter because it's turned" is
    exactly the real case this is meant to tolerate.

    Tray hardware (hinges, screws, rivets) that slips past the confidence
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

    shorts = sorted(_short_long_axes(d)[0] for d in sized)
    median_short = shorts[len(shorts) // 2]
    longs = sorted(_short_long_axes(d)[1] for d in sized)
    median_long = longs[len(longs) // 2]

    kept = []
    for d in detections:
        if d["_w"] <= 0 or d["_h"] <= 0:
            kept.append(d)
            continue
        short, long_ = _short_long_axes(d)
        # Reject boxes whose short (rotation-invariant) axis is far
        # smaller/larger than this photo's typical pill.
        if short < median_short * 0.4 or short > median_short * 2.5:
            continue
        # Reject only implausibly long boxes — no lower bound here, so a
        # pill turned to look short/round (sideways) isn't rejected for
        # having a long axis close to its short axis.
        if long_ > median_long * 2.5:
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
    # Floored at 8 per channel: a large batch of near-identical pills (e.g.
    # 150 of the same tablet under consistent lighting) can have a MAD of
    # just 2-4, which would turn ordinary lighting/glare variation across
    # the tray (one pill nearer an edge, catching more glare) into a huge
    # z-score and reject a real pill — a bigger, more homogeneous batch
    # should make this filter more forgiving of natural variation, not more
    # trigger-happy. The floor only matters when the batch is already this
    # tight; it's a no-op whenever real per-channel spread exceeds it.
    mad = np.maximum(np.median(np.abs(colors_arr - median_color), axis=0) * 1.4826, 8.0) + 1e-6

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


def _filter_flagged_outliers(image: np.ndarray, detections: list[dict]) -> list[dict]:
    """A flagged (low-confidence) detection that's ALSO a stark size, shape,
    or color outlier compared to the tray's confident detections is very
    likely tray hardware or a fluke, not a real pill worth a human's second
    look — so it's dropped outright rather than left as a flagged marker.

    This is deliberately separate from _filter_size_shape_outliers /
    _filter_color_outliers above: those compare each detection against the
    *whole* population and only engage with >=8 detections total, so a
    small tray (a handful of pills) never gets outlier filtering at all.
    This one instead measures flagged detections against just the confident
    ones, which is reliable with as few as 3 confident reference pills —
    and it only ever removes detections already flagged as low-confidence,
    so a real, well-detected pill can never be silently deleted here.
    """
    confident = [d for d in detections if d["confidence"] >= _CONFIDENT_THRESHOLD]
    flagged = [d for d in detections if d["confidence"] < _FLAGGED_THRESHOLD]
    if len(confident) < 3 or not flagged:
        return detections

    sized = [d for d in confident if d.get("_w", 0) > 0 and d.get("_h", 0) > 0]
    shorts = sorted(_short_long_axes(d)[0] for d in sized) if sized else []
    median_short = shorts[len(shorts) // 2] if shorts else None
    longs = sorted(_short_long_axes(d)[1] for d in sized) if sized else []
    median_long = longs[len(longs) // 2] if longs else None

    colors = []
    for d in confident:
        d.setdefault("_color", _sample_patch_color(image, d))
        if d["_color"] is not None:
            colors.append(d["_color"])
    median_color = mad = None
    if len(colors) >= 3:
        colors_arr = np.array(colors)
        median_color = np.median(colors_arr, axis=0)
        mad = np.maximum(np.median(np.abs(colors_arr - median_color), axis=0) * 1.4826, 8.0) + 1e-6

    dropped_ids = set()
    for d in flagged:
        is_outlier = False
        if median_short is not None and d.get("_w", 0) > 0 and d.get("_h", 0) > 0:
            short, long_ = _short_long_axes(d)
            if short < median_short * 0.4 or short > median_short * 2.5:
                is_outlier = True
            if median_long is not None and long_ > median_long * 2.5:
                is_outlier = True
        if median_color is not None:
            color = d.get("_color")
            if color is None:
                color = _sample_patch_color(image, d)
            if color is not None:
                z_score = float(np.sqrt(np.sum(((color - median_color) / mad) ** 2)))
                if z_score > 5.0:
                    is_outlier = True
        if is_outlier:
            dropped_ids.add(id(d))

    return [d for d in detections if id(d) not in dropped_ids]
