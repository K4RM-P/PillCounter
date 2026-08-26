from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import init_db
from app.inference.model import get_model
from app.routers import auth, counts

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


@app.on_event("startup")
def on_startup():
    init_db()
    # Load the model at startup instead of on the first /api/count request —
    # otherwise the first count after every cold start (or process restart)
    # pays model-load time on top of inference time, which on a slow/free CPU
    # host is enough to blow past the platform's request timeout entirely.
    get_model()


@app.get("/health")
def health():
    return {"status": "ok"}
