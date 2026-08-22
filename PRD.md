# Product Requirements Document — PillCount (working title)

## 1. Overview

PillCount is a browser-based pill counting tool for pharmacies and pharmacy technicians. A user photographs a tray of loose pills; the app detects and counts individual pills using an on-server ML model and returns a count with a visual overlay marking each detected pill. It is a clone of the core "Photo Mode" functionality of the commercial app PillEye.

**Distribution model:** PillCount is given away free to customers who purchase [Your POS Company]'s point-of-sale system. It is a **standalone web app**, not embedded inside the POS UI — it runs at its own URL and requires no integration with the POS software itself. Access is likely gated by a license key or account tied to the POS purchase (see §9).

**Platform:** Web app only for v1. No native iOS/Android app, no app store submission. Must work well on a phone or tablet browser (that's the primary device pharmacy staff will use it from), and should be usable on desktop too.

## 2. Problem statement

Manually counting pills (e.g., 180 tablets into a bottle) is slow, tedious, and interruption-prone — pharmacists report it taking significant time per count and having to restart counts if interrupted. A camera-based counting tool turns a multi-minute manual task into a few-second photo.

## 3. Goals

- Let a user photograph a tray/surface of pills and get an accurate count back in a few seconds.
- Be accurate enough for real pharmacy use (target: comparable to careful manual counting — see §10 for the honest accuracy story).
- Let the user manually correct the count when the model gets it wrong (this is a hard requirement — no ML pill counter is right 100% of the time on day one, and pharmacists need a fast correction path, not a reason to distrust the tool).
- Save count history so a count can be referenced later.
- Ship a real, usable v1 without requiring a finished, highly-tuned ML model on day one (see §8 for how the phased ML rollout works).

## 4. Non-goals (out of scope for v1)

- Identifying *what drug* the pills are (no pill imprint/shape/color lookup, no NDC database). Optional barcode scan of the bottle to attach a label to a saved count is a nice-to-have stretch goal, not v1.
- Live/continuous camera counting mode (PillEye's "Live Mode"). v1 is photo-only: capture a still image, then process it. Live mode is a plausible v2 feature once the detection model is solid.
- Native mobile app / app store distribution.
- Multi-tenant team management, roles/permissions beyond basic auth.
- Regulatory/clinical claims of any kind. This tool counts objects in a photo; it is explicitly not a dosing, identification, or diagnostic tool, and the UI must not imply otherwise (see §11).

## 5. Target users

Pharmacy technicians and pharmacists, primarily using a phone or tablet at a counting station. Not technically sophisticated users — the interaction has to be close to "open page → take photo → read number."

## 6. Core user flow (v1)

1. User opens the web app (desktop or mobile browser).
2. User taps "Count Pills." App requests camera access (or lets them upload/pick an existing photo).
3. User photographs pills spread out on a flat, contrasting surface (e.g., a tray). App can show a lightweight in-frame guide (e.g., "spread pills so they don't overlap, keep tray in frame") since detection accuracy depends heavily on how the photo is taken.
4. Photo is sent to the backend. A loading state shows while inference runs (target: under ~3 seconds).
5. Result screen shows: the photo with a colored dot/box on every detected pill, and a large count number.
6. User can manually add/remove markers if the count looks wrong (tap a missed pill to add a marker, tap a marker to delete it) — the displayed count updates live as they do this.
7. User confirms/saves the count. Optionally names it (e.g., a drug name, typed freely — no lookup required) and it's added to history.
8. User can view past counts (list: thumbnail, count, date/time, name if given).

## 7. Functional requirements

### 7.1 Capture
- Support both live camera capture (`<input capture>` / `getUserMedia`) and file upload, since desktop users won't have a phone camera.
- Client-side image compression before upload (large phone photos should be downscaled to a sane max dimension, e.g. 1600px, before sending — keeps upload fast and is plenty of resolution for detection).

### 7.2 Detection & counting
- Backend runs a single-class ("pill") object detection model over the uploaded image and returns bounding boxes/centroids for every detected pill plus a confidence score per detection.
- Response includes the count (`len(detections)`) and the detection list for overlay rendering.
- A confidence threshold filters weak detections; make this a backend-tunable constant, not hardcoded inline, since it will need tuning as real data comes in.

### 7.3 Manual correction
- Every detection is rendered as an editable marker on the photo (see §6, step 6).
- Tapping empty space in "add mode" adds a marker; tapping an existing marker in "remove mode" (or a small delete affordance per marker) removes it.
- The saved count is always `number of markers currently on screen`, not the raw model output — the model output is just the starting point.

### 7.4 History
- Every saved count is persisted: image (or thumbnail), final count, optional user-entered label, timestamp, and (once auth exists) which user saved it.
- A history list view, newest first, with the ability to open a past count and see the photo + markers as they were saved.

### 7.5 Accounts / access
- v1 needs *some* gate since this is a paid-POS perk, not a public free tool — simplest viable version is a single shared login per pharmacy (business account) rather than building full multi-user auth in v1. Decide license-key vs. email/password before backend work starts (open question, §12).

## 8. ML approach — phased, because this is the part with real uncertainty

**The honest starting point:** there is no off-the-shelf "count any pill" model. YOLOv8 (or a comparable modern object detector) is the right architecture, but it has to be trained or fine-tuned on pill images specifically. This is the one piece of the project that isn't just software engineering — it depends on getting labeled image data.

**Phase A — get the pipeline working end-to-end with a stand-in model.**
Wire up the full path (capture → upload → inference call → overlay rendering → manual correction → save) using either (a) a classical CV blob/contour counter (OpenCV threshold + contour detection) as a temporary stand-in, or (b) a YOLOv8 model pretrained on COCO run in a "detect small round/oval objects" mode, accepting it will undercount on touching/overlapping pills at first. Goal of this phase: prove the *app* works, not the *model*.

**Phase B — collect labeling data.**
Take real photos of pill trays (varied pill shapes/colors/transparency, varied lighting, varied degrees of overlap) and label them (bounding box per pill, single class). Tools: Roboflow or CVAT for labeling; a few hundred labeled images is a reasonable starting target for a single-class detector (much lighter than multi-class problems since there's no drug identification happening).

**Phase C — fine-tune YOLOv8 on the labeled set**, swap it in behind the same inference API, measure count accuracy against manually-verified ground truth on a held-out test set, and iterate the threshold/augmentation/data as needed.

**Phase D (stretch)** — Live Mode (continuous camera counting), improved handling of transparent capsules, per-pharmacy fine-tuning if a pharmacy has unusual stock.

Claude Code should build Phase A first and scaffold Phase C's training script even though it can't run it without data — see the prompt doc for how this is sequenced.

## 9. Technical architecture

- **Backend:** Python, FastAPI. Single service exposing REST endpoints for auth, image upload/inference, and history CRUD.
- **Inference:** `ultralytics` YOLOv8 (Phase A: pretrained/generic weights or classical OpenCV fallback; Phase C: fine-tuned custom weights loaded by the same code path). Inference runs synchronously per request for v1 (async job queue is a later scaling concern, not a v1 need).
- **Storage:** Uploaded images stored in object storage (S3-compatible) or local disk for local dev; a Postgres (or SQLite for local dev) database for count records, users, and metadata.
- **Frontend:** A single-page web app. React is a reasonable default given the interactive marker-editing requirement (canvas/SVG overlay on an image with add/remove interactions benefits from component state). Talks to the backend over REST/JSON.
- **Deployment target:** containerized (Docker) so it can go on any standard host; no native app store pipeline needed.

## 10. Non-functional requirements

- **Accuracy:** No specific number should be promised to end users until Phase C measures it on real data — do not hardcode marketing claims like "99.99% accuracy" anywhere in the UI or copy. Internally, track precision/recall of detections against a labeled test set as the model iterates.
- **Latency:** Inference response under ~3 seconds on a reasonably sized (downscaled) image.
- **Offline:** Not required for v1 (unlike native PillEye, which runs on-device) — v1 assumes network connectivity to reach the backend. Note this as a deliberate trade-off, not an oversight.
- **Privacy:** Pill photos and counts may be tied to a pharmacy's business data; don't send images to any third-party API — inference runs on infrastructure you control.

## 11. Legal / liability note

The app counts *objects in a photo*, not medication identity or dosage. UI copy should avoid implying clinical verification ("verify counts independently" type messaging belongs somewhere in the flow, e.g. first-run or settings) — this is a liability/trust matter, not a regulatory blocker, since a plain counting tool generally sits outside medical-device software territory. Still worth a lightweight disclaimer rather than none.

## 12. Open questions (resolve before or during build — don't let these block starting)

- License/auth model: shared pharmacy login vs. license key vs. full multi-user accounts?
- Branding/name: "PillCount" here is a placeholder — swap in real product name before UI copy is finalized.
- Where does labeled training data come from — will you photograph real pill trays, or is there a synthetic/public dataset worth starting from?
- Hosting target (which cloud, if any) — affects storage/deployment specifics but not app structure.
