import asyncio
import logging
import os
import urllib.request

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import init_db
from app.inference.model import get_model
from app.routers import auth, counts

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="PillCount API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=settings.IMAGE_STORAGE_DIR), name="media")
app.include_router(auth.router)
app.include_router(counts.router)


async def _self_ping_loop(url: str, interval_seconds: float) -> None:
    """Pings this service's own public health endpoint on a timer, forever,
    for as long as the process is alive. Render's free tier sleeps a web
    service after ~15 min with no incoming request — a GitHub Actions cron
    job pinging it from outside was supposed to prevent that, but GitHub
    silently delays or drops scheduled runs by hours on low-traffic repos
    (observed directly: gaps up to 5+ hours despite a 4-minute schedule),
    so it can't be relied on alone. This loop pings from *inside* the
    running process instead — no external scheduler, no browser tab open
    anywhere, nothing else required — so as long as the service is awake it
    keeps re-proving activity to Render before the idle window ever closes.
    """
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await asyncio.get_running_loop().run_in_executor(
                None, lambda: urllib.request.urlopen(url, timeout=20).read()
            )
        except Exception as exc:
            logger.warning("Self-ping to %s failed: %s", url, exc)


@app.on_event("startup")
async def on_startup():
    init_db()
    # Load the model at startup instead of on the first /api/count request —
    # otherwise the first count after every cold start (or process restart)
    # pays model-load time on top of inference time, which on a slow/free CPU
    # host is enough to blow past the platform's request timeout entirely.
    get_model()

    # Render auto-injects RENDER_EXTERNAL_URL with this service's own public
    # URL; only present when actually deployed on Render, so this is a no-op
    # in local dev.
    external_url = os.getenv("RENDER_EXTERNAL_URL")
    if external_url:
        asyncio.create_task(_self_ping_loop(f"{external_url}/health", interval_seconds=4 * 60))


@app.get("/health")
def health():
    return {"status": "ok"}
