"""Per-resource APIRouter modules.

Each module exposes a ``router`` (``fastapi.APIRouter``) that ``app.py`` mounts
with ``app.include_router(...)``. Routers depend on ``db``, ``schemas``,
``auth``, ``constants``, ``services/*`` and ``limiter`` — never on ``app`` —
which keeps the dependency graph acyclic. Row→model mappers used by a single
router stay private to that module; anything shared lives in ``services/``.
"""
