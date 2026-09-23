import json
from pathlib import Path

from spaday import ComponentPackage

from .components import SpadayCodemirror

__version__ = "0.1.0"

ASSETS_DIR = Path(__file__).parent / "extension"
MANIFEST = Path(__file__).parent / "components.cem.json"

# Exact versions of the JS libraries bundled into cdn/index.js, written by the JS build.
_VERSIONS_FILE = ASSETS_DIR / "versions.json"
VERSIONS: dict[str, str] = json.loads(_VERSIONS_FILE.read_text(encoding="utf-8")) if _VERSIONS_FILE.exists() else {}

package = ComponentPackage(
    name="codemirror",
    assets_dir=ASSETS_DIR,
    assets=(("css", "css/index.css"), ("js", "cdn/index.js")),
    components=(SpadayCodemirror,),
    provides=VERSIONS,
)

CodeMirror = SpadayCodemirror

#: ``css()`` kwarg → (CSS custom property, what it controls), in the shape of
#: :data:`spaday.theme.SHELL_TOKENS`. Each token keeps CodeMirror's light / One Dark standalone
#: default and follows the nearest shell token where one applies.
TOKENS = {
    "spa_codemirror_surface": ("--spa-codemirror-surface", "editor background (defaults to --spa-surface)"),
    "spa_codemirror_text": ("--spa-codemirror-text", "editor and panel text (defaults to --spa-muted)"),
    "spa_codemirror_gutter_surface": ("--spa-codemirror-gutter-surface", "gutter and panel background (defaults to --spa-surface-2)"),
    "spa_codemirror_gutter_text": ("--spa-codemirror-gutter-text", "line-number color (defaults to --spa-muted)"),
    "spa_codemirror_border": ("--spa-codemirror-border", "editor, gutter, and panel border (defaults to --spa-border)"),
    "spa_codemirror_focus": ("--spa-codemirror-focus", "focused editor border (defaults to --spa-accent)"),
    "spa_codemirror_cursor": ("--spa-codemirror-cursor", "caret and drop-cursor color (defaults to --spa-accent)"),
    "spa_codemirror_selection": ("--spa-codemirror-selection", "selection background"),
    "spa_codemirror_active_line": ("--spa-codemirror-active-line", "active-line background"),
    "spa_codemirror_active_line_gutter": ("--spa-codemirror-active-line-gutter", "active line-number background"),
}

__all__ = [
    "ASSETS_DIR",
    "MANIFEST",
    "TOKENS",
    "VERSIONS",
    "CodeMirror",
    "SpadayCodemirror",
    "__version__",
    "package",
]
