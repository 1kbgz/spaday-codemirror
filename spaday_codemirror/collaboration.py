"""Collaborative CodeMirror editing through Spaday and transports.

Alice and Bob have write access to one CRDT-backed document. Viewer has read access. Open two users
in separate tabs to see concurrent edits converge. The URL paths identify users for this small demo;
production applications should derive that identity from an authenticated websocket connection.

Run: ``python -m spaday_codemirror.collaboration`` then open http://127.0.0.1:8032/.
"""

import asyncio
from contextlib import asynccontextmanager, suppress

import transports
import uvicorn
from pydantic import BaseModel
from spaday import Wire, element
from spaday.backends.starlette import PageSpec, build_site
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocket

from . import CodeMirror, package

HOST = "127.0.0.1"
PORT = 8032

USERS = {
    "alice": ("Alice", transports.WRITE),
    "bob": ("Bob", transports.WRITE),
    "viewer": ("Viewer", transports.READ),
}
USER_COLORS = {"alice": "#b42318", "bob": "#175cd3", "viewer": "#067647"}

STYLE = """
body { margin: 0; background: #f4f6f8; color: #14212b; font: 15px/1.5 system-ui, sans-serif; }
#collaboration-example { box-sizing: border-box; max-width: 64rem; margin: 0 auto; padding: 2rem 1rem; }
#collaboration-example * { box-sizing: border-box; }
#collaboration-example h1 { margin: 0 0 0.25rem; font-size: 1.6rem; }
.collaboration-intro { margin: 0 0 1rem; color: #4a5a66; }
.collaboration-users { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0 0 1rem; }
.collaboration-users a { padding: 0.4rem 0.75rem; border: 1px solid #9fb3c0; border-radius: 6px; color: inherit; text-decoration: none; }
.collaboration-users a:hover { background: #eef3f6; }
.collaboration-users a.active { border-color: #176b87; background: #dff3fa; }
.collaboration-panel { padding: 1rem; border: 1px solid #d8e1e5; border-radius: 8px; background: #fff; }
.collaboration-role { display: flex; gap: 0.5rem; align-items: baseline; margin: 0 0 0.75rem; }
.collaboration-role span { color: #4a5a66; }
.collaboration-panel spaday-codemirror { height: 26rem; }
.collaboration-note { margin: 0.75rem 0 0; color: #4a5a66; font-size: 0.9rem; }
"""


class SharedDocument(BaseModel):
    doc: str = "# Shared notes\n\nAlice and Bob can edit 🙂 this document. Viewer can only read it.\n"


spec = transports.CrdtSpec(
    {
        "kind": "map",
        "fields": {"doc": {"kind": "sequence", "materialization": "string"}},
    }
)
hub = transports.Hub(key=lambda websocket: websocket.path_params["user"])
document_id = hub.share(SharedDocument(), crdt_spec=spec)
for user, (_label, access) in USERS.items():
    hub.subscribe(user, document_id, access)


def collaboration_page(user: str):
    """Return one user's view of the shared document."""
    label, access = USERS[user]
    links = []
    for candidate, (candidate_label, candidate_access) in USERS.items():
        path = "/" if candidate == "alice" else f"/{candidate}"
        link = element("a", href=path, target="_blank", rel="noopener noreferrer").text(
            f"{candidate_label} · {'edit' if candidate_access == transports.WRITE else 'read only'}"
        )
        if candidate == user:
            link.classes("active").prop("aria-current", "page")
        links.append(link)

    editor = CodeMirror(
        id="shared-editor",
        language="markdown",
        theme="light",
        read_only=access == transports.READ,
    ).bind("doc", "doc", mode="two-way", event="editor-change")
    editor.prop("data-user-name", label).prop("data-user-color", USER_COLORS[user])
    return (
        element("main", id="collaboration-example")
        .child(element("h1").text("Collaborative editing"))
        .child(
            element("p")
            .classes("collaboration-intro")
            .text("Open two users in separate tabs. Their edits merge and their live selections appear in the shared editor.")
        )
        .child(element("nav").prop("aria-label", "Users").classes("collaboration-users").child(*links))
        .child(
            element("section")
            .classes("collaboration-panel")
            .child(
                element("p")
                .classes("collaboration-role")
                .child(
                    element("strong", id="current-user").text(label),
                    element("span", id="current-access").text("Can edit" if access == transports.WRITE else "Read only"),
                )
            )
            .child(editor)
            .child(
                element("p")
                .classes("collaboration-note")
                .text("The server grants access through transports subscriptions; the read-only editor is only the matching user interface.")
            )
        )
    )


def page_spec(user: str) -> PageSpec:
    return PageSpec(
        collaboration_page(user),
        packages=[package],
        wire=Wire(f"/ws/{user}", reconnect=True),
        tree="inline",
        title=f"spaday-codemirror collaboration · {USERS[user][0]}",
        styles=[STYLE],
        scripts=["/components/codemirror/cdn/collaboration.js"],
    )


hub_endpoint = transports.ws_endpoint(hub)


async def websocket(websocket: WebSocket) -> None:
    if websocket.path_params["user"] not in USERS:
        await websocket.close(code=1008)
        return
    await hub_endpoint(websocket)


site = build_site(
    {"/": page_spec("alice"), "/bob": page_spec("bob"), "/viewer": page_spec("viewer")},
    routes=[WebSocketRoute("/ws/{user}", websocket)],
)


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(transports.autosync(hub))
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = Starlette(routes=site.all(), lifespan=lifespan)


def main() -> None:
    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()
