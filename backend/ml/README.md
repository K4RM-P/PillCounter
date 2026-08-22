# Training the pill detector

This folder holds the fine-tuning pipeline for Phase 3. It won't do
anything useful until you have labeled data — that's expected. This doc
explains the data format, how to label, how to train, and how to swap the
result into the running app.

## 1. Data format / folder layout

YOLOv8 expects the standard YOLO detection format: one image file, one
matching `.txt` label file (same basename), one row per bounding box.

```
backend/ml/data/
  images/
    train/
      img001.jpg
      img002.jpg
      ...
    val/
      img101.jpg
      ...
  labels/
    train/
      img001.txt
      img002.txt
      ...
    val/
      img101.txt
      ...
```

Each `.txt` label file has one line per pill in that image:

```
<class_id> <x_center> <y_center> <width> <height>
```

- `class_id` is always `0` (single class: "pill").
- All four coordinates are normalized to `0.0–1.0` (fraction of image
  width/height), not pixels.
- A pill tray photo with 40 pills has 40 lines in its label file.

Then create `backend/ml/data/dataset.yaml` (start from
`dataset.yaml.example` in this folder):

```yaml
path: backend/ml/data
train: images/train
val: images/val
names:
  0: pill
```

A reasonable starting target is a few hundred labeled images (single-class
detectors need much less data than multi-class ones). Vary lighting, pill
shape/color/transparency, tray background, and degree of overlap — the more
your training photos look like real pharmacy counting conditions, the
better this generalizes.

## 2. Labeling

You take the photos; you'll also need to draw the boxes. Two solid options,
both free for small projects:

- **[Roboflow](https://roboflow.com/)** — browser-based, has AI-assisted
  labeling, and can export directly in YOLOv8 format (images + labels +
  dataset.yaml already in the layout above — just drop the export in place).
- **[CVAT](https://www.cvat.ai/)** — open source, self-hostable, more manual
  but full control if you'd rather not use a hosted tool.

Either way: draw a tight box around each individual pill, single class
("pill"), export in YOLO format, and split into train/val (a 80/20 split is
a reasonable default).

## 3. Running training

Once `backend/ml/data/dataset.yaml` exists and points at your labeled
images:

```bash
cd backend
source venv/bin/activate   # or however you run the backend env
pip install -r requirements.txt   # ultralytics is already in there

python ml/train.py --data ml/data/dataset.yaml --epochs 100
```

Useful flags (all optional, see `python ml/train.py --help`):
- `--weights` — base weights to fine-tune from (default `yolov8n.pt`, the
  same pretrained weights Phase 2 uses — fine-tuning from it is faster than
  starting from scratch).
- `--epochs` — training epochs (start around 100, watch for
  plateau/overfitting in the val metrics).
- `--imgsz` — input resolution (default 640).
- `--batch` — batch size (default 16; lower it if you run out of memory).

Training writes results to `backend/ml/runs/pillcount/`, including
`weights/best.pt` (best checkpoint by validation metric) and
`weights/last.pt`.

## 4. Swapping the trained weights into the app

The inference module (`backend/app/inference/model.py`) loads whatever
weights file `MODEL_WEIGHTS_PATH` points to — it doesn't care whether
that's the generic Phase 2 weights or your fine-tuned ones.

1. Copy (or move) the checkpoint you want to use, e.g.:
   ```bash
   cp backend/ml/runs/pillcount/weights/best.pt backend/ml/weights/pill_yolov8.pt
   ```
2. Point the backend at it, either via `.env` / your shell:
   ```bash
   export MODEL_WEIGHTS_PATH=backend/ml/weights/pill_yolov8.pt
   ```
   or in `docker-compose.yml`, add under the `backend` service:
   ```yaml
   environment:
     - MODEL_WEIGHTS_PATH=backend/ml/weights/pill_yolov8.pt
   ```
3. Restart the backend. No code changes needed — `count_pills()`'s
   interface is unchanged.

## 5. Measuring accuracy

Before trusting a new checkpoint, check its validation metrics (printed at
the end of training, and in `backend/ml/runs/pillcount/results.csv`) —
precision/recall/mAP on the held-out `val` split. For a real accuracy read,
also spot check actual counts against manually-verified ground truth on a
handful of real tray photos, since a bounding-box metric isn't the same
thing as "did it get the count right."

Don't put any accuracy number in user-facing UI copy until you have real
numbers from this — see PRD §10.
