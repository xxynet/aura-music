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

Media files are stored in `backend/media/` and served at `/media/...`.

