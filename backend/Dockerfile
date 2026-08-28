FROM python:3.11-slim

WORKDIR /app

# opencv-python-headless still dynamically links against libGL despite being
# "headless" — python:3.11-slim doesn't ship it, so cv2 import crashes at
# runtime (ImportError: libGL.so.1) without this.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch build: the default PyPI torch pulls in NVIDIA CUDA runtime
# libraries (cublas/cudnn/nccl/etc, several hundred MB) that get mapped into
# memory at import even on this GPU-less container, which alone was enough
# to blow past Render free tier's 512MB limit before a single request came
# in. Installed first so ultralytics' torch dependency is already satisfied
# and pip doesn't pull the CUDA build in afterward.
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.8.0 torchvision==0.23.0 \
    --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# No --reload: that's a dev-only flag (spawns a file-watcher process) that
# has no purpose in production and was observed crashing the container on
# Render with "Too many open files" (watchfiles hitting the container's fd
# limit) before the app even got a chance to start.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
