"""crosschat: real multi-room chat over WebSockets.

- WebSocket /ws/{room}/{username}: join a room, receive history, send/receive
  live messages. Messages persist to SQLite and are replayed to newcomers.
- GET /api/rooms, GET /api/rooms/{room}/history
- GET / serves a minimal single-page chat frontend.
"""
import asyncio
import json
import os
import re

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

import db

db.init_db()

app = FastAPI(title="crosschat", version="1.0.0")

SAFE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

# room -> set of active websockets
rooms: dict[str, set[WebSocket]] = {}
lock = asyncio.Lock()


async def broadcast(room: str, payload: dict):
    dead = []
    async with lock:
        targets = list(rooms.get(room, set()))
    data = json.dumps(payload)
    for ws in targets:
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    if dead:
        async with lock:
            for ws in dead:
                rooms.get(room, set()).discard(ws)


@app.get("/")
def index():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "index.html"))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/rooms")
def api_rooms():
    return {"rooms": db.list_rooms()}


@app.get("/api/rooms/{room}/history")
def api_history(room: str, limit: int = 50):
    if not SAFE.match(room):
        raise HTTPException(400, "invalid room name")
    return {"room": room, "messages": db.get_history(room, min(limit, 200))}


@app.websocket("/ws/{room}/{username}")
async def ws_room(ws: WebSocket, room: str, username: str):
    if not SAFE.match(room) or not SAFE.match(username):
        await ws.close(code=1008)
        return
    await ws.accept()
    async with lock:
        rooms.setdefault(room, set()).add(ws)
    try:
        # replay history to the newcomer
        await ws.send_text(json.dumps({"type": "history",
                                       "messages": db.get_history(room)}))
        await broadcast(room, {"type": "join", "username": username,
                               "text": f"{username} joined {room}"})
        while True:
            text = (await ws.receive_text()).strip()
            if not text:
                continue
            msg = db.save_message(room, username, text[:2000])
            await broadcast(room, {"type": "message", **msg})
    except WebSocketDisconnect:
        pass
    finally:
        async with lock:
            rooms.get(room, set()).discard(ws)
        await broadcast(room, {"type": "leave", "username": username,
                               "text": f"{username} left {room}"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8005)))
