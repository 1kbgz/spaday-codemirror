import json
import tomllib
from pathlib import Path

from spaday_codemirror import VERSIONS, __version__, package

ROOT = Path(__file__).parents[2]
PACKAGE_JSON = json.loads((ROOT / "js" / "package.json").read_text(encoding="utf-8"))


def test_version_matches_metadata():
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert __version__ == "0.1.0"
    assert pyproject["project"]["version"] == __version__
    assert PACKAGE_JSON["version"] == __version__


def test_versions_match_pinned_dependencies():
    assert VERSIONS == PACKAGE_JSON["dependencies"]
    assert all(name.startswith("@codemirror/") for name in VERSIONS)


def test_package_provides_bundled_versions():
    assert package.provides == tuple(sorted(VERSIONS.items()))
