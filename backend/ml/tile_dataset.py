"""Slicing-Aided Fine-Tuning: augments a YOLO dataset with tiled crops of its
own training images.

Tiling at inference time (see app/inference/counter.py) helps separate dense/
overlapping pills, but the detector was only ever trained on full, downscaled
images — so it never learned what pills look like at the larger relative
size a tile gives them. This script closes that gap by generating overlapping
crops of each training image (matching the inference-time tile size), with
bounding boxes clipped/translated into the crop's coordinate space, and
writing them alongside the originals as extra training examples. Tiles with
no pills in them are dropped, and boxes that would be clipped to a sliver
(barely-visible partial pill) are dropped rather than kept as noisy labels.

Usage:
    python backend/ml/tile_dataset.py --data backend/ml/data --tile-size 800 --overlap 0.2

Run once after labeling a new batch and before training — the extra tiled
images get written into the same images/train and labels/train dirs, so a
normal training run picks them up automatically.
"""

import argparse
from pathlib import Path

import cv2


def tile_starts(dim: int, tile: int, stride: int) -> list[int]:
    if dim <= tile:
        return [0]
    starts = list(range(0, dim - tile + 1, stride))
    if starts[-1] != dim - tile:
        starts.append(dim - tile)
    return starts


def load_yolo_labels(label_path: Path) -> list[tuple[int, float, float, float, float]]:
    if not label_path.exists():
        return []
    boxes = []
    for line in label_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 5:
            continue
        cls, xc, yc, w, h = parts
        boxes.append((int(cls), float(xc), float(yc), float(w), float(h)))
    return boxes


def main():
    parser = argparse.ArgumentParser(description="Generate tiled training crops (Slicing-Aided Fine-Tuning)")
    parser.add_argument("--data", required=True, help="Dataset root (contains images/train, labels/train)")
    parser.add_argument("--tile-size", type=int, default=800, help="Should match app.config.settings.TILE_SIZE")
    parser.add_argument("--overlap", type=float, default=0.2, help="Should match app.config.settings.TILE_OVERLAP")
    parser.add_argument("--min-source-size", type=int, default=1200, help="Skip source images smaller than this — tiling a small image just duplicates it")
    parser.add_argument("--min-box-fraction", type=float, default=0.5, help="Drop boxes clipped to less than this fraction of their original area")
    args = parser.parse_args()

    data_root = Path(args.data)
    images_dir = data_root / "images" / "train"
    labels_dir = data_root / "labels" / "train"

    tile = args.tile_size
    stride = max(1, int(tile * (1 - args.overlap)))

    source_images = [
        p for p in sorted(images_dir.glob("*"))
        if not p.stem.endswith("_tile") and "_tile" not in p.stem
    ]

    generated = 0
    for img_path in source_images:
        image = cv2.imread(str(img_path))
        if image is None:
            continue
        height, width = image.shape[:2]
        if max(height, width) < args.min_source_size:
            continue

        label_path = labels_dir / (img_path.stem + ".txt")
        boxes = load_yolo_labels(label_path)
        if not boxes:
            continue

        # Convert normalized boxes to absolute pixel xyxy once.
        abs_boxes = []
        for cls, xc, yc, w, h in boxes:
            bw, bh = w * width, h * height
            cx, cy = xc * width, yc * height
            abs_boxes.append((cls, cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2, bw * bh))

        tile_index = 0
        for y in tile_starts(height, tile, stride):
            for x in tile_starts(width, tile, stride):
                x2, y2 = min(x + tile, width), min(y + tile, height)
                crop_w, crop_h = x2 - x, y2 - y

                tile_boxes = []
                for cls, bx1, by1, bx2, by2, orig_area in abs_boxes:
                    ix1, iy1 = max(bx1, x), max(by1, y)
                    ix2, iy2 = min(bx2, x2), min(by2, y2)
                    if ix2 <= ix1 or iy2 <= iy1:
                        continue
                    inter_area = (ix2 - ix1) * (iy2 - iy1)
                    if inter_area / max(1e-6, orig_area) < args.min_box_fraction:
                        continue
                    # Translate into tile-local normalized coords.
                    lx1, ly1, lx2, ly2 = ix1 - x, iy1 - y, ix2 - x, iy2 - y
                    lxc, lyc = (lx1 + lx2) / 2 / crop_w, (ly1 + ly2) / 2 / crop_h
                    lw, lh = (lx2 - lx1) / crop_w, (ly2 - ly1) / crop_h
                    tile_boxes.append((cls, lxc, lyc, lw, lh))

                if not tile_boxes:
                    continue

                crop = image[y:y2, x:x2]
                tile_name = f"{img_path.stem}_tile{tile_index}"
                cv2.imwrite(str(images_dir / f"{tile_name}{img_path.suffix}"), crop)
                label_lines = [f"{c} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}" for c, xc, yc, w, h in tile_boxes]
                (labels_dir / f"{tile_name}.txt").write_text("\n".join(label_lines) + "\n")
                tile_index += 1
                generated += 1

    print(f"Generated {generated} tiled training images from {len(source_images)} source images.")


if __name__ == "__main__":
    main()
