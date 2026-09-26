import json
from pathlib import Path

from spaday import ComponentPackage, Token

from .components import SpadayCodemirror

__version__ = "0.1.1"

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

#: ``css()`` kwarg → (CSS custom property, what it controls). Each token keeps CodeMirror's light / One Dark standalone
#: default and follows the nearest shell token where one applies.
TOKENS = {
    "spa_codemirror_surface": Token("--spa-codemirror-surface", "editor background", fallback="--spa-surface"),
    "spa_codemirror_text": Token("--spa-codemirror-text", "editor and panel text", fallback="--spa-muted"),
    "spa_codemirror_gutter_surface": Token("--spa-codemirror-gutter-surface", "gutter and panel background", fallback="--spa-surface-2"),
    "spa_codemirror_gutter_text": Token("--spa-codemirror-gutter-text", "line-number color", fallback="--spa-muted"),
    "spa_codemirror_border": Token("--spa-codemirror-border", "editor, gutter, and panel border", fallback="--spa-border"),
    "spa_codemirror_focus": Token("--spa-codemirror-focus", "focused editor border", fallback="--spa-accent"),
    "spa_codemirror_cursor": Token("--spa-codemirror-cursor", "caret and drop-cursor color", fallback="--spa-accent"),
    "spa_codemirror_selection": Token("--spa-codemirror-selection", "selection background"),
    "spa_codemirror_active_line": Token("--spa-codemirror-active-line", "active-line background"),
    "spa_codemirror_active_line_gutter": Token("--spa-codemirror-active-line-gutter", "active line-number background"),
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
