# crosschat

Real multi-room chat: FastAPI + WebSockets, message history in SQLite, and a
minimal single-page frontend. No external services, no Firebase — everything
runs from this repo.

## What it does

- `GET /` — single-page chat UI (pick a username, join/create rooms, live messages)
- `WS /ws/{room}/{username}` — join a room; newcomers get history replay,
  then live `join`/`message`/`leave` events
- `GET /api/rooms` — rooms with message counts
- `GET /api/rooms/{room}/history?limit=50` — persisted history
- `GET /health`

Messages persist in SQLite (`crosschat.db`, override with `CROSSCHAT_DB`).

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --port 8005
# open http://localhost:8005 in two browser windows and chat
```

## Tests

```bash
python -m pytest tests/ -q
```

Covers: two websocket clients exchanging messages in real time, history
persisted to SQLite and replayed to newcomers, room isolation, REST history,
invalid room names rejected, frontend served.
