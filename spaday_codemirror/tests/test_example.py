import json

from spaday import validate
from starlette.testclient import TestClient

from spaday_codemirror.example import GALLERY, SAMPLE, SOURCE_ID, CodeMirrorExample, app, metrics, normalize, styles, worker_app


def walk(node):
    yield node
    for children in node.get("slots", {}).values():
        for child in children:
            yield from walk(child)


def by_id(tree, id):
    return next(node for node in walk(tree) if node.get("props", {}).get("id") == {"Str": id})


def editors(tree):
    return [node for node in walk(tree) if node["tag"] == "spaday-codemirror"]


def intent(field, value):
    return {"type": "spaday:patch", "detail": {"model": "editor", "field": field, "value": value}}


def patched(message, name):
    return [op["SetProp"]["value"] for op in message["patch"]["ops"] if "SetProp" in op and op["SetProp"]["name"] == name]


def text(tree, id):
    return by_id(tree, id)["props"]["textContent"]["Str"]


def test_normalize():
    assert normalize("a\t= 1   \n\n\n") == "a   = 1\n"
    assert normalize("\tx", tab_size=2) == "  x\n"
    assert normalize("") == ""
    assert normalize(normalize(SAMPLE)) == normalize(SAMPLE)


def test_metrics():
    assert metrics("") == {"characters": 0, "lines": 1, "words": 0}
    assert metrics("one two\nthree\n") == {"characters": 14, "lines": 3, "words": 3}


def test_initial_render():
    page = CodeMirrorExample()
    tree = page.render().to_node()
    validate(page.render())
    source = by_id(tree, SOURCE_ID)
    assert source["props"]["doc"] == {"Str": SAMPLE}
    assert source["props"]["language"] == {"Str": "python"}
    assert source["events"]["editor-change"] == {
        "kind": "patch",
        "model": "editor",
        "field": "doc",
        "value": {"expr": "event", "path": "doc"},
    }
    preview = by_id(tree, "preview-editor")
    assert preview["props"]["doc"] == {"Str": normalize(SAMPLE)}
    assert preview["props"]["read_only"] == {"Bool": True}
    assert preview["props"]["theme"] == {"Str": "dark"}
    assert text(tree, "metric-characters") == str(len(SAMPLE))
    assert text(tree, "metric-revision") == "0"
    assert text(tree, "status") == "Ready"


def test_gallery_covers_languages_and_settings():
    tree = CodeMirrorExample().render().to_node()
    gallery = editors(by_id(tree, "gallery"))
    assert len(gallery) == len(GALLERY) == 5
    assert {node["props"]["language"]["Str"] for node in gallery} == {"python", "javascript", "json", "markdown", "plain"}
    assert {node["props"]["theme"]["Str"] for node in gallery} == {"light", "dark"}
    assert any(node["props"].get("read_only") == {"Bool": True} for node in gallery)
    assert any(node["props"].get("line_numbers") == {"Bool": False} for node in gallery)
    assert {node["props"]["tab_size"]["Int"] for node in gallery if "tab_size" in node["props"]} == {2, 4, 8}


def test_user_edit_updates_model_and_patches_without_echo():
    page = CodeMirrorExample()
    page.app.start()
    message = page.app.dispatch(intent("doc", "a = 1\n"))
    document = page.document
    assert (document.doc, document.revision, document.status) == ("a = 1\n", 1, "Edited in browser · revision 1")
    # only the preview's doc changes; the source editor keeps the user's text without an echo
    assert patched(message, "doc") == [{"Str": "a = 1\n"}]
    assert {"Str": "6"} in patched(message, "textContent")
    tree = page.render().to_node()
    assert by_id(tree, SOURCE_ID)["props"]["doc"] == {"Str": SAMPLE}
    assert text(tree, "metric-lines") == "2"
    assert text(tree, "metric-revision") == "1"


def test_repeated_doc_does_not_bump_revision():
    page = CodeMirrorExample()
    page.app.start()
    page.app.dispatch(intent("doc", "x"))
    message = page.app.dispatch(intent("doc", "x"))
    assert page.document.revision == 1
    assert message["patch"]["ops"] == []


def test_normalize_action_patches_source():
    page = CodeMirrorExample()
    page.app.start()
    page.app.dispatch(intent("doc", "a\t=1   \n"))
    page.app.dispatch(intent("sync", "a\t=1   \n"))
    message = page.app.dispatch(intent("action", "normalize"))
    # the preview already showed the normalized text, so only the source editor changes
    assert patched(message, "doc") == [{"Str": "a   =1\n"}]
    assert page.document.doc == "a   =1\n"
    assert page.document.status == "Normalized in Python · revision 2"
    assert by_id(page.render().to_node(), SOURCE_ID)["props"]["doc"] == {"Str": "a   =1\n"}

    page.app.dispatch(intent("sync", "a   =1\n"))
    message = page.app.dispatch(intent("action", "normalize"))
    assert patched(message, "doc") == []
    assert page.document.revision == 2
    assert page.document.status == "Normalized in Python · no change"


def test_reset_patches_source_even_when_baseline_matches():
    page = CodeMirrorExample()
    page.app.start()
    page.app.dispatch(intent("doc", "edited"))
    sync = page.app.dispatch(intent("sync", "edited"))
    # the sync render only adopts the browser's own text
    assert {"Str": "edited"} in patched(sync, "doc")
    message = page.app.dispatch(intent("action", "reset"))
    assert {"Str": SAMPLE} in patched(message, "doc")
    assert page.document.doc == SAMPLE
    assert page.document.status == "Reset in Python · revision 2"


def test_ignores_other_models():
    page = CodeMirrorExample()
    page.app.start()
    message = page.app.dispatch({"type": "spaday:patch", "detail": {"model": "other", "field": "doc", "value": "x"}})
    assert message["patch"]["ops"] == []


def test_worker_app_json_protocol():
    snapshot = json.loads(worker_app.start_json())
    assert snapshot["type"] == "snapshot"
    assert snapshot["tree"]["props"]["id"] == {"Str": "codemirror-example"}
    assert len(editors(snapshot["tree"])) == 7
    assert styles.startswith("<style>") and styles.endswith("</style>")


def test_starlette_routes_and_websocket():
    with TestClient(app) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "/runtime/spaday/cdn/index.js" in page.text
        assert "/components/codemirror/cdn/index.js" in page.text
        assert client.get("/components/codemirror/cdn/index.js").status_code == 200
        assert client.get("/components/codemirror/css/index.css").status_code == 200
        assert client.get("/runtime/spaday/pkg/spaday_bg.wasm").status_code == 200
        with client.websocket_connect("/ws") as socket:
            socket.send_text(json.dumps({"type": "start"}))
            assert json.loads(socket.receive_text())["type"] == "snapshot"
            socket.send_text(json.dumps(intent("doc", "hello world")))
            message = json.loads(socket.receive_text())
            assert message["type"] == "patch"
            assert {"Str": "2"} in patched(message, "textContent")
