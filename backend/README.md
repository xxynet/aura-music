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
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Media files are stored in `backend/data/media/` and served at `/media/...`. The SQLite database lives at `backend/data/data.db`; a legacy `backend/data.sqlite3` / `backend/media/` layout is migrated there automatically on startup.

## Auth & roles

- Users carry a `role` (`admin` or `user`). While the users table is empty, `GET /api/auth/status` reports `initialized: false` and the frontend prompts to create the admin account via `POST /api/auth/init-admin` (rejected once any user exists; the created account gets `role=admin` and is logged in immediately). Regular accounts register through `POST /api/auth/register` afterwards.
- Media rows record the uploader's user id and store the file path relative to the media directory.

