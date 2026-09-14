"""Python-authored CodeMirror page over spaday's worker protocol.

A transports-hosted ``Document`` model is the source of truth. The editable source editor sends each
user edit as a ``spaday:patch`` intent; Python recomputes metrics and a normalized preview, and returns
a component-tree patch. The same :class:`~spaday.WorkerApp` runs inside Pyodide (``worker_app``) or
behind a Starlette websocket (``app``), one app per connection.

The source editor's ``doc`` prop only changes when Python authors the text (reset / normalize), never to
echo a user edit back, so in-flight keystrokes are never overwritten by a stale round-trip.

Run: ``python -m spaday_codemirror.example`` then open http://127.0.0.1:8031/.
"""

import json
from pathlib import Path

import spaday
from pydantic import BaseModel
from spaday import SendPatch, Sequence as Steps, WorkerApp, by_id, element, event_value, lit, prop
from starlette.applications import Starlette
from starlette.responses import HTMLResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect
from transports import Client, Server, Session, to_value

from . import CodeMirror, package

HOST = "127.0.0.1"
PORT = 8031
TAB_SIZE = 4
SOURCE_ID = "source-editor"

SAMPLE = """def greet(name):
\tmessage = f"hello, {name}"   \n\treturn message


print(greet("spaday"))
"""

GALLERY = (
    {
        "key": "gallery-python",
        "title": "Python",
        "settings": "light · line numbers · tab 4",
        "props": {"language": "python", "theme": "light", "line_numbers": True, "tab_size": 4},
        "doc": "def area(r):\n    return 3.14159 * r ** 2\n",
    },
    {
        "key": "gallery-javascript",
        "title": "JavaScript",
        "settings": "dark · line numbers · tab 2",
        "props": {"language": "javascript", "theme": "dark", "line_numbers": True, "tab_size": 2},
        "doc": "const area = (r) => {\n  return Math.PI * r ** 2;\n};\n",
    },
    {
        "key": "gallery-json",
        "title": "JSON",
        "settings": "light · read-only · tab 2",
        "props": {"language": "json", "theme": "light", "read_only": True, "tab_size": 2},
        "doc": '{\n  "name": "spaday-codemirror",\n  "private": true\n}\n',
    },
    {
        "key": "gallery-markdown",
        "title": "Markdown",
        "settings": "light · no line numbers",
        "props": {"language": "markdown", "theme": "light", "line_numbers": False},
        "doc": "# Notes\n\n- **bold** and *italic*\n- `inline code`\n",
    },
    {
        "key": "gallery-plain",
        "title": "Plain text",
        "settings": "dark · read-only · no line numbers · tab 8",
        "props": {"language": "plain", "theme": "dark", "read_only": True, "line_numbers": False, "tab_size": 8},
        "doc": "col\tvalue\nalpha\t1\nbeta\t2\n",
    },
)

styles = """<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f6f8; color: #14212b; font: 15px/1.5 system-ui, sans-serif; }
  #codemirror-example { box-sizing: border-box; max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  #codemirror-example * { box-sizing: border-box; }
  #codemirror-example h1 { margin: 0 0 0.25rem; font-size: 1.6rem; }
  #codemirror-example h2 { margin: 2rem 0 0.75rem; font-size: 1.1rem; }
  #codemirror-example .intro { margin: 0 0 1.25rem; color: #4a5a66; max-width: 46rem; }
  .cm-workspace { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .cm-panel { min-width: 0; padding: 0.75rem; border: 1px solid #d8e1e5; border-radius: 8px; background: #fff; }
  .cm-panel h3, .cm-card h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  .cm-panel spaday-codemirror { height: 16rem; }
  .cm-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.75rem 0 0; }
  .cm-toolbar button { padding: 0.4rem 0.8rem; border: 1px solid #9fb3c0; border-radius: 6px; background: #fff; font: inherit; cursor: pointer; }
  .cm-toolbar button:hover { background: #eef3f6; }
  .cm-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; margin: 1rem 0 0; }
  .cm-metric { min-width: 0; padding: 0.5rem 0.75rem; border-radius: 6px; background: #eef3f6; }
  .cm-metric span { display: block; color: #4a5a66; font-size: 0.8rem; }
  .cm-metric strong { font-size: 1.2rem; font-variant-numeric: tabular-nums; }
  .cm-status { margin: 0.5rem 0 0; color: #4a5a66; overflow-wrap: anywhere; }
  .cm-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: 0.75rem; }
  .cm-card { min-width: 0; padding: 0.75rem; border: 1px solid #d8e1e5; border-radius: 8px; background: #fff; }
  .cm-card p { margin: 0 0 0.5rem; color: #4a5a66; font-size: 0.8rem; }
  .cm-card spaday-codemirror { height: 7.5rem; }
  @media (max-width: 720px) {
    .cm-workspace { grid-template-columns: minmax(0, 1fr); }
    .cm-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>"""


class Document(BaseModel):
    doc: str = SAMPLE
    revision: int = 0
    status: str = "Ready"


def normalize(doc: str, tab_size: int = TAB_SIZE) -> str:
    """Expand tabs, strip trailing whitespace, and end with exactly one newline."""
    lines = [line.expandtabs(tab_size).rstrip() for line in doc.split("\n")]
    text = "\n".join(lines).rstrip("\n")
    return f"{text}\n" if text else ""


def metrics(doc: str) -> dict[str, int]:
    return {"characters": len(doc), "lines": doc.count("\n") + 1, "words": len(doc.split())}


def python_action(action: str) -> Steps:
    """Sync the browser's text as Python's baseline, then ask Python to rewrite it."""
    return Steps(
        SendPatch("editor", "sync", prop(by_id(SOURCE_ID), "doc")),
        SendPatch("editor", "action", lit(action)),
    )


class CodeMirrorExample:
    """One page's state: a transports-hosted ``Document`` plus the editor text Python last authored."""

    def __init__(self) -> None:
        self.session = Session()
        self.model_id = self.session.host(Document())
        self.server = Server(self.session, default_codec="msgpack")
        self.client = Client(codec="msgpack")
        for frame in self.server.open("browser", "msgpack"):
            self.client.recv(frame)
        # The source editor's `doc` prop. Changes only when Python authors the text.
        self.authored = SAMPLE
        self.app = WorkerApp(self.render, self.on_intent)

    @property
    def document(self) -> Document:
        return self.client.model(self.model_id, Document)

    def _commit(self, **changes) -> None:
        proposal = self.document.model_copy(update=changes)
        outbound = self.client.edit(self.model_id, to_value(proposal))
        for frame in self.server.recv("browser", outbound)["browser"]:
            self.client.recv(frame)

    def on_intent(self, intent: dict) -> None:
        detail = intent["detail"]
        if detail.get("model") != "editor":
            return
        field, value = detail.get("field"), detail.get("value")
        document = self.document
        if field == "doc" and isinstance(value, str) and value != document.doc:
            self._commit(doc=value, revision=document.revision + 1, status=f"Edited in browser · revision {document.revision + 1}")
        elif field == "sync" and isinstance(value, str):
            # Adopt the browser's text as the authored baseline so the following action always patches.
            self.authored = value
            if value != document.doc:
                self._commit(doc=value, revision=document.revision + 1)
        elif field == "action" and value in ("reset", "normalize"):
            target = SAMPLE if value == "reset" else normalize(document.doc)
            label = "Reset" if value == "reset" else "Normalized"
            if target == document.doc:
                self._commit(status=f"{label} in Python · no change")
            else:
                self._commit(doc=target, revision=document.revision + 1, status=f"{label} in Python · revision {document.revision + 1}")
            self.authored = target

    def render(self):
        document = self.document
        counts = metrics(document.doc)
        source = CodeMirror(
            key=SOURCE_ID,
            id=SOURCE_ID,
            doc=self.authored,
            language="python",
            theme="light",
            tab_size=TAB_SIZE,
        ).on("editor-change", SendPatch("editor", "doc", event_value("doc")))
        preview = CodeMirror(
            key="preview-editor",
            id="preview-editor",
            doc=normalize(document.doc),
            language="python",
            theme="dark",
            read_only=True,
            tab_size=TAB_SIZE,
        )
        return (
            element("main", id="codemirror-example")
            .child(element("h1").text("spaday-codemirror"))
            .child(
                element("p")
                .classes("intro")
                .text("Edit the source. Each change goes to Python, which updates the model, the metrics, and the normalized preview.")
            )
            .child(
                element("section")
                .classes("cm-workspace")
                .child(
                    element("div")
                    .classes("cm-panel")
                    .child(element("h3").text("Source · editable"))
                    .child(source)
                    .child(
                        element("div")
                        .classes("cm-toolbar")
                        .child(element("button", id="normalize", type="button").text("Normalize in Python").on("click", python_action("normalize")))
                        .child(element("button", id="reset", type="button").text("Reset").on("click", python_action("reset")))
                    )
                )
                .child(element("div").classes("cm-panel").child(element("h3").text("Normalized preview · read-only, from Python")).child(preview))
            )
            .child(
                element("section", id="metrics")
                .classes("cm-metrics")
                .child(*(self._metric(name, value) for name, value in (*counts.items(), ("revision", document.revision))))
            )
            .child(element("p", id="status").classes("cm-status").text(document.status))
            .child(element("h2").text("Gallery"))
            .child(element("section", id="gallery").classes("cm-gallery").child(*(self._card(entry) for entry in GALLERY)))
        )

    @staticmethod
    def _metric(name: str, value: int):
        return (
            element("div")
            .classes("cm-metric")
            .child(element("span").text(name.capitalize()), element("strong", id=f"metric-{name}").text(str(value)))
        )

    @staticmethod
    def _card(entry: dict):
        return (
            element("article", id=entry["key"])
            .classes("cm-card")
            .child(element("h3").text(entry["title"]))
            .child(element("p").text(entry["settings"]))
            .child(CodeMirror(key=entry["key"], doc=entry["doc"], **entry["props"]))
        )


example = CodeMirrorExample()
worker_app = example.app

PAGE = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>spaday-codemirror</title>
    <link rel="stylesheet" href="/components/codemirror/css/index.css" />
    {styles}
  </head>
  <body>
    <div id="example-root"></div>
    <script type="module">
      import {{ connectWorker, init }} from "/runtime/spaday/cdn/index.js";
      import "/components/codemirror/cdn/index.js";

      await init({{ module_or_path: "/runtime/spaday/pkg/spaday_bg.wasm" }});
      // Present the websocket as the Worker that connectWorker expects: same snapshot/patch protocol.
      const socket = new WebSocket(`${{location.protocol === "https:" ? "wss" : "ws"}}://${{location.host}}/ws`);
      const opened = new Promise((resolve) => socket.addEventListener("open", resolve, {{ once: true }}));
      const channel = new EventTarget();
      socket.addEventListener("message", (event) => channel.dispatchEvent(new MessageEvent("message", {{ data: JSON.parse(event.data) }})));
      channel.postMessage = (message) => opened.then(() => socket.send(JSON.stringify(message)));
      await connectWorker(document.querySelector("#example-root"), channel).ready;
      document.documentElement.dataset.ready = "true";
    </script>
  </body>
</html>
"""


async def homepage(_request) -> HTMLResponse:
    return HTMLResponse(PAGE)


async def socket(websocket: WebSocket) -> None:
    await websocket.accept()
    page = CodeMirrorExample()
    try:
        async for text in websocket.iter_text():
            message = json.loads(text)
            await websocket.send_text(page.app.start_json() if message.get("type") == "start" else page.app.dispatch_json(text))
    except WebSocketDisconnect:
        pass


app = Starlette(
    routes=[
        Route("/", homepage),
        WebSocketRoute("/ws", socket),
        Mount("/components/codemirror", StaticFiles(directory=package.assets_dir)),
        Mount("/runtime/spaday", StaticFiles(directory=Path(spaday.__file__).parent / "extension")),
    ]
)


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()
