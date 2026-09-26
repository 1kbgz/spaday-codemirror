import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest
from spaday import ComponentSchema, validate
from spaday.cem import generate, schemas

import spaday_codemirror
from spaday_codemirror import MANIFEST, TOKENS, CodeMirror, SpadayCodemirror, package

ROOT = Path(__file__).parents[2]


def test_serializes_props_by_property_name():
    node = SpadayCodemirror(
        doc="print(1)",
        language="python",
        theme="dark",
        read_only=True,
        line_numbers=False,
        tab_size=2,
        selection={"anchor": 1, "head": 3},
        remote_cursors=[{"peer": "alice", "anchor": 4}],
        key="editor",
    ).to_node()
    assert node == {
        "tag": "spaday-codemirror",
        "key": "editor",
        "props": {
            "doc": {"Str": "print(1)"},
            "language": {"Str": "python"},
            "theme": {"Str": "dark"},
            "read_only": {"Bool": True},
            "line_numbers": {"Bool": False},
            "tab_size": {"Int": 2},
            "selection": {"Map": {"anchor": {"Int": 1}, "head": {"Int": 3}}},
            "remote_cursors": {"List": [{"Map": {"peer": {"Str": "alice"}, "anchor": {"Int": 4}}}]},
        },
    }


def test_omits_unset_props():
    assert SpadayCodemirror().to_node() == {"tag": "spaday-codemirror"}


def test_public_alias():
    assert CodeMirror is SpadayCodemirror


def test_validates_against_schema():
    validate(SpadayCodemirror(doc="x", language="json", selection=None, remote_cursors=[]))
    with pytest.raises(Exception, match="unknown prop"):
        validate(SpadayCodemirror(value="x"))


def test_schema():
    assert SpadayCodemirror.schema.to_dict() == {
        "tag": "spaday-codemirror",
        "class_name": "SpadayCodemirror",
        "summary": "CodeMirror 6 code editor.",
        "props": [
            {"name": "doc", "kind": "string", "default": "", "description": "Editor contents."},
            {
                "name": "language",
                "kind": "enum",
                "choices": ["python", "javascript", "json", "markdown", "plain"],
                "default": "plain",
                "description": "Syntax mode.",
            },
            {"name": "theme", "kind": "enum", "choices": ["light", "dark"], "default": "light", "description": "Color theme."},
            {"name": "read_only", "kind": "boolean", "default": "false", "description": "Disallow user edits."},
            {"name": "line_numbers", "kind": "boolean", "default": "true", "description": "Show the line-number gutter."},
            {"name": "tab_size", "kind": "number", "default": "4", "description": "Tab width and indent unit, in spaces."},
        ],
        "fields": [
            {
                "name": "selection",
                "kind": "json",
                "type_text": "{ anchor: number; head?: number } | null",
                "description": "Main selection; head defaults to anchor.",
            },
            {
                "name": "remote_cursors",
                "kind": "json",
                "type_text": "{ peer: string; anchor: number; head?: number; label?: string; color?: string }[]",
                "description": "Remote selections keyed by peer; labels and colors are optional presentation metadata.",
            },
        ],
        "events": ["editor-change", "editor-selection"],
        "slots": [],
    }


def test_manifest_matches_generated_schema():
    [parsed] = schemas(str(MANIFEST))
    assert ComponentSchema.from_cem(parsed) == SpadayCodemirror.schema


def test_generated_binding_is_current(tmp_path):
    out = tmp_path / "components.py"
    generate(str(MANIFEST), str(out))
    subprocess.run([sys.executable, "-m", "ruff", "format", "--quiet", str(out)], check=True)
    assert out.read_text(encoding="utf-8") == (ROOT / "spaday_codemirror" / "components.py").read_text(encoding="utf-8")


def test_package_descriptor():
    assert package.name == "codemirror"
    assert package.assets_dir == ROOT / "spaday_codemirror" / "extension"
    assert package.assets == (("css", "css/index.css"), ("js", "cdn/index.js"))
    assert package.components == (SpadayCodemirror,)
    assert package.imports == ()
    assert package.requires == ()
    assert package.catalog == (SpadayCodemirror.schema,)


def test_package_assets_built():
    for _, path in package.assets:
        assert (package.assets_dir / path).is_file()


def test_entry_point():
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert pyproject["project"]["entry-points"]["spaday.component_packages"] == {"codemirror": "spaday_codemirror:package"}


def test_manifest_lists_exact_api():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    [declaration] = manifest["modules"][0]["declarations"]
    assert declaration["tagName"] == "spaday-codemirror"
    assert [a["name"] for a in declaration["attributes"]] == ["doc", "language", "theme", "read_only", "line_numbers", "tab_size"]
    assert [m["name"] for m in declaration["members"]] == [
        "doc",
        "language",
        "theme",
        "read_only",
        "line_numbers",
        "tab_size",
        "selection",
        "remote_cursors",
    ]
    assert [e["name"] for e in declaration["events"]] == ["editor-change", "editor-selection"]


def test_all_exports():
    assert set(spaday_codemirror.__all__) == {
        "ASSETS_DIR",
        "CodeMirror",
        "MANIFEST",
        "TOKENS",
        "VERSIONS",
        "SpadayCodemirror",
        "__version__",
        "package",
    }


def test_tokens_document_exactly_what_the_stylesheet_exposes():
    css = re.sub(r"\s+", "", (ROOT / "js" / "src" / "css" / "index.css").read_text(encoding="utf-8"))
    read = set(re.findall(r"var\((--spa-codemirror-[a-z-]+)[,)]", css))
    assert read == {prop for prop, _ in TOKENS.values()}
    assert not re.findall(r"(?<![-\w])(--spa-codemirror-[a-z-]+):", css)


def test_structured_fallbacks_match_the_stylesheet():
    css = re.sub(r"\s+", "", (ROOT / "js" / "src" / "css" / "index.css").read_text(encoding="utf-8"))
    for token in (token for token in TOKENS.values() if token.fallback is not None):
        prop = token.property
        fallback = token.fallback
        private = prop.replace("--spa-", "--_spa-")
        definitions = re.findall(rf"{private}:([^;]+);", css)
        assert definitions and all(f"var({fallback}," in definition for definition in definitions)
