"""Import-layering guard for the backend.

The layout (docs/architecture.md) depends on these directions holding: routers
depend on services and infrastructure but never on `app` or each other, and
services know nothing of HTTP or routers — they raise ``services.errors``
instead, which ``app.py`` maps to 404/400. Checked statically from the source,
so a stray import fails here rather than as a cycle at runtime.
"""

import ast
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"


def _imports(path: Path) -> set[str]:
    """Top-level module names (and dotted paths) a file imports."""
    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(f"{node.module}.{alias.name}" for alias in node.names)
    return names


def _modules(package: str) -> list[Path]:
    return sorted(p for p in (SRC / package).glob("*.py") if p.name != "__init__.py")


@pytest.mark.parametrize("path", _modules("services"), ids=lambda p: p.stem)
def test_services_know_nothing_of_http_or_routers(path):
    bad = {
        name
        for name in _imports(path)
        if name.split(".")[0] in {"fastapi", "starlette", "routers", "app"}
    }
    assert not bad, f"services/{path.name} imports {sorted(bad)}"


@pytest.mark.parametrize("path", _modules("routers"), ids=lambda p: p.stem)
def test_routers_import_neither_app_nor_each_other(path):
    bad = {
        name
        for name in _imports(path)
        if name == "app" or (name.startswith("routers") and name != "routers")
    }
    assert not bad, f"routers/{path.name} imports {sorted(bad)}"
