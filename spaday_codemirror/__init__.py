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

__all__ = ["ASSETS_DIR", "MANIFEST", "VERSIONS", "CodeMirror", "SpadayCodemirror", "__version__", "package"]
