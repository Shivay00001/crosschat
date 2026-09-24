import json
import os

os.environ["CROSSCHAT_DB"] = "/tmp/crosschat-test.db"
if os.path.exists("/tmp/crosschat-test.db"):
    os.remove("/tmp/crosschat-test.db")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)


def _drain_joins(ws, n):
    for _ in range(n):
        m = json.loads(ws.receive_text())
        assert m["type"] in ("join", "leave"), m


def test_two_clients_exchange_messages():
    with client.websocket_connect("/ws/lobby/alice") as ws_a:
        assert json.loads(ws_a.receive_text())["type"] == "history"
        _drain_joins(ws_a, 1)  # alice's own join
        with client.websocket_connect("/ws/lobby/bob") as ws_b:
            assert json.loads(ws_b.receive_text())["type"] == "history"
            _drain_joins(ws_b, 1)  # bob's own join
            _drain_joins(ws_a, 1)  # alice sees bob join

            ws_a.send_text("hello from alice")
            m1 = json.loads(ws_a.receive_text())
            m2 = json.loads(ws_b.receive_text())
            assert m1["type"] == "message" and m1["text"] == "hello from alice"
            assert m1["username"] == "alice"
            assert m2["text"] == "hello from alice" and m2["username"] == "alice"

            ws_b.send_text("hi alice, this is bob")
            r1 = json.loads(ws_a.receive_text())
            r2 = json.loads(ws_b.receive_text())
            assert r1["text"] == "hi alice, this is bob" and r1["username"] == "bob"
            assert r2["text"] == "hi alice, this is bob"


def test_history_persists_and_rooms_isolated():
    with client.websocket_connect("/ws/room1/carol") as ws:
        assert json.loads(ws.receive_text())["type"] == "history"
        _drain_joins(ws, 1)
        ws.send_text("room1 secret")
        assert json.loads(ws.receive_text())["text"] == "room1 secret"

    with client.websocket_connect("/ws/room2/dave") as ws:
        hist = json.loads(ws.receive_text())
        _drain_joins(ws, 1)
        # room2 history must NOT contain room1's message
        assert all(m["text"] != "room1 secret" for m in hist["messages"])
        ws.send_text("room2 hello")
        assert json.loads(ws.receive_text())["text"] == "room2 hello"

    # persisted history via REST, across connections
    r = client.get("/api/rooms/room1/history")
    assert r.status_code == 200
    assert "room1 secret" in [m["text"] for m in r.json()["messages"]]
    r = client.get("/api/rooms/room2/history")
    assert "room2 hello" in [m["text"] for m in r.json()["messages"]]


def test_newcomer_gets_history_replay():
    with client.websocket_connect("/ws/replay/erin") as ws:
        assert json.loads(ws.receive_text())["type"] == "history"
        _drain_joins(ws, 1)
        ws.send_text("first replay message")
        json.loads(ws.receive_text())
    # reconnect as someone else: history must include the earlier message
    with client.websocket_connect("/ws/replay/frank") as ws:
        hist = json.loads(ws.receive_text())
        assert hist["type"] == "history"
        assert "first replay message" in [m["text"] for m in hist["messages"]]


def test_rooms_list_and_invalid_names():
    with client.websocket_connect("/ws/listing/gus") as ws:
        assert json.loads(ws.receive_text())["type"] == "history"
        _drain_joins(ws, 1)
        ws.send_text("listing probe")
        json.loads(ws.receive_text())
    r = client.get("/api/rooms")
    assert r.status_code == 200
    names = {x["room"] for x in r.json()["rooms"]}
    assert "listing" in names
    assert client.get("/api/rooms/bad!name/history").status_code == 400


def test_frontend_served():
    r = client.get("/")
    assert r.status_code == 200
    assert "crosschat" in r.text and "WebSocket" in r.text
