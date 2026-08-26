"""Fine-tune YOLOv8 on a labeled pill dataset.

Won't run without labeled data — see README.md in this folder for how to
collect/label data and the expected folder layout. Once you have a
dataset.yaml, run e.g.:

    python backend/ml/train.py --data backend/ml/data/dataset.yaml --epochs 100

The resulting weights (runs/<name>/weights/best.pt) can then be pointed to
via the MODEL_WEIGHTS_PATH env var — see README.md for the swap-in steps.
"""

import argparse

import torch
from ultralytics import YOLO


def default_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "0"
    return "cpu"


def main():
    parser = argparse.ArgumentParser(description="Fine-tune YOLOv8 on labeled pill images")
    parser.add_argument("--data", required=True, help="Path to dataset.yaml (YOLO format)")
    parser.add_argument("--weights", default="yolov8s.pt", help="Base weights to fine-tune from (yolov8s has more capacity than the n variant for small/dense objects)")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=1280, help="Higher resolution helps separate small/touching pills")
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--project", default="backend/ml/runs", help="Where to write training runs")
    parser.add_argument("--name", default="pillcount", help="Run name (subfolder under --project)")
    parser.add_argument("--device", default=None, help="Torch device (mps/cpu/0). Auto-detects MPS/CUDA if omitted")
    parser.add_argument("--cos-lr", dest="cos_lr", action="store_true", default=True, help="Cosine LR schedule for smoother late-training convergence")
    parser.add_argument("--multi-scale", dest="multi_scale", action="store_true", default=False, help="Randomly vary input scale per batch (up to 1.5x imgsz) for better scale invariance. Memory-hungry — off by default, opt in on machines with headroom")
    parser.add_argument("--mixup", type=float, default=0.1, help="Mixup augmentation probability — helps generalization on dense/occluded scenes")
    parser.add_argument("--copy-paste", dest="copy_paste", type=float, default=0.1, help="Copy-paste augmentation — synthesizes more overlapping-object training examples")
    parser.add_argument("--close-mosaic", dest="close_mosaic", type=int, default=15, help="Disable mosaic augmentation for the final N epochs so the model sees undistorted layouts before finishing")
    parser.add_argument("--patience", type=int, default=30, help="Early-stop patience (epochs without val improvement)")
    parser.add_argument("--workers", type=int, default=8, help="Dataloader worker processes")
    parser.add_argument(
        "--cache",
        default="disk",
        choices=["ram", "disk", "none"],
        help="Cache decoded images so every epoch doesn't re-read+re-decode JPEGs from disk — "
        "on MPS especially, data loading is otherwise the actual bottleneck, not compute "
        "('none' disables, matching Ultralytics' old default).",
    )
    args = parser.parse_args()

    device = args.device or default_device()
    print(f"Using device: {device}")

    model = YOLO(args.weights)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
        device=device,
        cos_lr=args.cos_lr,
        multi_scale=args.multi_scale,
        mixup=args.mixup,
        copy_paste=args.copy_paste,
        close_mosaic=args.close_mosaic,
        patience=args.patience,
        workers=args.workers,
        cache=False if args.cache == "none" else args.cache,
    )


if __name__ == "__main__":
    main()
