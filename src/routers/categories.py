"""Custom transaction categories — list, create, delete."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from constants import DEFAULT_CATEGORIES, MAX_CUSTOM_CATEGORIES
from db import db
from auth import require_auth
from schemas import CategoriesOut, CategoryIn, CustomCategoryOut, OkOut

router = APIRouter(tags=["categories"])


@router.get("/api/categories", response_model=CategoriesOut)
def list_categories(uid: int = Depends(require_auth)) -> CategoriesOut:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name FROM user_categories WHERE user_id=? ORDER BY created_at",
            (uid,),
        ).fetchall()
    return CategoriesOut(
        defaults=DEFAULT_CATEGORIES,
        custom=[CustomCategoryOut(id=r["id"], name=r["name"]) for r in rows],
    )


@router.post("/api/categories", status_code=201, response_model=CustomCategoryOut)
def create_category(
    data: CategoryIn, uid: int = Depends(require_auth)
) -> CustomCategoryOut:
    with db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM user_categories WHERE user_id=?", (uid,)
        ).fetchone()[0]
        if count >= MAX_CUSTOM_CATEGORIES:
            raise HTTPException(
                422, f"Maximum of {MAX_CUSTOM_CATEGORIES} custom categories reached"
            )
        try:
            cur = conn.execute(
                "INSERT INTO user_categories(user_id, name) VALUES(?,?)",
                (uid, data.name),
            )
            conn.commit()
            row = conn.execute(
                "SELECT id, name FROM user_categories WHERE id=?", (cur.lastrowid,)
            ).fetchone()
        except sqlite3.IntegrityError:
            raise HTTPException(409, "A category with that name already exists")
    return CustomCategoryOut(id=row["id"], name=row["name"])


@router.delete("/api/categories/{cid}", response_model=OkOut)
def delete_category(cid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM user_categories WHERE id=? AND user_id=?", (cid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM user_categories WHERE id=?", (cid,))
        conn.commit()
    return OkOut(ok=True)
