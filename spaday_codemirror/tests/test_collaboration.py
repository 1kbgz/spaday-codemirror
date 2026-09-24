import json

import pytest
from spaday import validate
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from transports import Client

from spaday_codemirror.collaboration import USERS, SharedDocument, app, collaboration_page, document_id


def walk(node):
    yield node
    for children in node.get("slots", {}).values():
        for child in children:
            yield from walk(child)


def by_id(tree, node_id):
    return next(node for node in walk(tree) if node.get("props", {}).get("id") == {"Str": node_id})


def test_pages_bind_the_editor_and_match_access():
    for user in USERS:
        component = collaboration_page(user)
        validate(component)
        tree = component.to_node()
        editor = by_id(tree, "shared-editor")
        assert editor["bindings"]["doc"] == {"field": "doc", "mode": "two-way", "event": "editor-change"}
        assert editor["props"]["read_only"] == {"Bool": user == "viewer"}


def test_viewer_write_is_rejected_without_changing_shared_document():
    with TestClient(app) as browser:
        with browser.websocket_connect("/ws/viewer") as socket:
            viewer = Client()
            viewer.recv(socket.receive_text())
            before = viewer.model(document_id, SharedDocument)
            frame = viewer.edit_crdt(
                document_id,
                [
                    {
                        "kind": "sequence_splice",
                        "path": [{"kind": "key", "key": "doc"}],
                        "index": 0,
                        "delete_count": 0,
                        "values": ["x"],
                    }
                ],
            )
            assert isinstance(frame, str)
            socket.send_text(frame)
            rejected = json.loads(socket.receive_text())

        assert rejected["t"] == "reject"
        assert rejected["error"] == "read-only subscription"
        with browser.websocket_connect("/ws/alice") as socket:
            alice = Client()
            alice.recv(socket.receive_text())
            assert alice.model(document_id, SharedDocument) == before


def test_unknown_user_is_rejected():
    with TestClient(app) as browser, pytest.raises(WebSocketDisconnect), browser.websocket_connect("/ws/mallory"):
        pass
