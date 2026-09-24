"""SQLite message history. One table, no ORM."""
import os
import sqlite3
import time

DB_PATH = os.environ.get("CROSSCHAT_DB",
                          os.path.join(os.path.dirname(__file__), "crosschat.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, id);
"""


def _conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as c:
        c.executescript(SCHEMA)


def save_message(room: str, username: str, text: str) -> dict:
    ts = time.time()
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO messages (room, username, text, ts) VALUES (?, ?, ?, ?)",
            (room, username, text, ts),
        )
        msg_id = cur.lastrowid
    return {"id": msg_id, "room": room, "username": username,
            "text": text, "ts": ts}


def get_history(room: str, limit: int = 50) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, room, username, text, ts FROM messages "
            "WHERE room = ? ORDER BY id DESC LIMIT ?",
            (room, limit),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def list_rooms() -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT room, COUNT(*) AS messages, MAX(ts) AS last_ts "
            "FROM messages GROUP BY room ORDER BY last_ts DESC"
        ).fetchall()
    return [dict(r) for r in rows]
