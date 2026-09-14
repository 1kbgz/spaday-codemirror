# spaday-codemirror

CodeMirror 6 code editor for spaday.

[![Build Status](https://github.com/1kbgz/spaday-codemirror/actions/workflows/build.yaml/badge.svg?branch=main&event=push)](https://github.com/1kbgz/spaday-codemirror/actions/workflows/build.yaml)
[![codecov](https://codecov.io/gh/1kbgz/spaday-codemirror/branch/main/graph/badge.svg)](https://codecov.io/gh/1kbgz/spaday-codemirror)
[![License](https://img.shields.io/github/license/1kbgz/spaday-codemirror)](https://github.com/1kbgz/spaday-codemirror)
[![PyPI](https://img.shields.io/pypi/v/spaday-codemirror.svg)](https://pypi.python.org/pypi/spaday-codemirror)

## Usage

`spaday-codemirror` provides one custom element, `<spaday-codemirror>`, and its typed spaday binding, `CodeMirror`. The package registers itself as the `codemirror` component package, so pages load its assets with `packages=["codemirror"]`.

```python
from spaday.backends.starlette import serve
from spaday_codemirror import CodeMirror


def page():
    return CodeMirror(doc="print('hello')\n", language="python", theme="dark", tab_size=4)


app = serve(page, packages=["codemirror"])
```

To send edits to Python, bind `editor-change` to an action, e.g. `.on("editor-change", SendPatch("editor", "doc", event_value("doc")))`, and route the `spaday:patch` intent to your model. [`example.py`](spaday_codemirror/example.py) does this over a websocket.

Without Python, load `cdn/index.js` and `css/index.css` from `spaday_codemirror/extension/` (or `js/dist/`) and use the tag directly:

```html
<spaday-codemirror language="json" tab_size="2"></spaday-codemirror>
```

### Properties

Attributes share the property names.

| Property       | Type                                                                  | Default   | Description                                                                        |
| -------------- | --------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `doc`          | `string`                                                              | `""`      | Editor contents                                                                    |
| `language`     | `"python"` \| `"javascript"` \| `"json"` \| `"markdown"` \| `"plain"` | `"plain"` | Syntax mode                                                                        |
| `theme`        | `"light"` \| `"dark"`                                                 | `"light"` | Color theme (`dark` uses One Dark)                                                 |
| `read_only`    | `boolean`                                                             | `false`   | Disallow user edits                                                                |
| `line_numbers` | `boolean`                                                             | `true`    | Show the line-number gutter                                                        |
| `tab_size`     | `number`                                                              | `4`       | Tab width and indent unit, in spaces                                               |
| `selection`    | `{anchor: number, head?: number} \| null`                             | `null`    | Main selection; property only. `head` defaults to `anchor`; `null` leaves it as-is |

Setting a property updates the existing `EditorView` in place, so focus and scroll position are kept. Property changes never emit events.

### Events

Both events bubble and are composed.

| Event              | `detail`                                                          | Fired when                                   |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------- |
| `editor-change`    | `{doc, changes: [{from, to, insert}], selection: {anchor, head}}` | The user edits the document                  |
| `editor-selection` | `{selection: {anchor, head}}`                                     | The user moves the selection without editing |

## Browser examples

- [Hosted Pyodide example](https://1kbgz.github.io/spaday-codemirror/lite/): the example page running in a Python Web Worker.
- [`spaday_codemirror/example.py`](spaday_codemirror/example.py): two editors wired to a transports-hosted model, plus a gallery covering every language and representative settings. Python computes metrics and a normalized preview on each edit, and has Normalize and Reset actions.
- [`js/examples/`](js/examples/): the Pyodide page and worker.

## Run the examples locally

```bash
make develop
make build
python -m spaday_codemirror.example  # http://127.0.0.1:8031/
```

Build and test the Pyodide example:

```bash
make test-pyodide-example
cd dist/lite && python -m http.server
```

> [!NOTE]
> This library was generated using [copier](https://copier.readthedocs.io/en/stable/) from the [Base Python Project Template repository](https://github.com/python-project-templates/base).
