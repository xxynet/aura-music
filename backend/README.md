# Aura Music Sync Backend (FastAPI)

This backend provides:
- Room-based **authoritative playback state** (queue, play mode, current song, play/pause, current time)
- **WebSocket** realtime sync
- **Local file upload** + static media hosting (so imported local songs are playable on other devices)
- **SQLite** persistence

## Requirements

- Python 3.10+

## Install

```bash
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run (dev)

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 5237
```

Media files are stored in `backend/data/media/` and served at `/media/...`. The SQLite database lives at `backend/data/data.db`; a legacy `backend/data.sqlite3` / `backend/media/` layout is migrated there automatically on startup.

## Auth & roles

- Users carry a `role` (`admin` or `user`). While the users table is empty, `GET /api/auth/status` reports `initialized: false` and the frontend prompts to create the admin account via `POST /api/auth/init-admin` (rejected once any user exists; the created account gets `role=admin` and is logged in immediately). Regular accounts register through `POST /api/auth/register` afterwards.
- Media rows record the uploader's user id and store the file path relative to the media directory.

## Production (single process)

When a built frontend is present, the backend serves it itself: it hosts the SPA at `/` (with fallback to `index.html` for unknown paths), so `uvicorn` alone can host the whole app. The static directory comes from `AURA_STATIC_DIR` and defaults to the repo-root `dist/`; pointing it at a missing directory disables static hosting.

```bash
# From the repo root: build with base "/" (the default /aura-music/ base is for GitHub Pages).
VITE_BASE_PATH=/ npm run build
uvicorn app.main:app --host 0.0.0.0 --port 5237
```

The `Dockerfile` at the repo root does exactly this — build the SPA with `VITE_BASE_PATH=/`, copy the result into the image, and run `uvicorn` as the only server.

