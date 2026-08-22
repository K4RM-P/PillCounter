# PillCount

Browser-based pill counting tool. See `PRD.md` for full requirements.

## Stack
- Backend: Python + FastAPI (`/backend`)
- Frontend: React + Vite (`/frontend`)
- DB: SQLite (local dev)

## Run with Docker (recommended)

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000 (docs at /docs)

## Run locally without Docker

Backend:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

## Login

PillCount uses a single shared business-account login (not per-user
accounts). Default local dev credentials: `pharmacy` / `changeme`
(set via `AUTH_USERNAME` / `AUTH_PASSWORD` env vars — change these before
any real deployment, along with `SECRET_KEY`).

## Status
Phase 4: shared-login auth gate, liability disclaimer, and full
capture → count → correct → save → history flow. Detection runs on
YOLOv8 (Phase 2, pretrained weights until Phase 3 training data is ready).
