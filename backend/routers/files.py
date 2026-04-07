"""Serve files from Modal Volume (reports, charts, etc.)."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import posixpath
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from services.volume import get_volume

logger = logging.getLogger(__name__)
router = APIRouter()

_ALLOWED_PREFIXES = ("/sessions/", "/datasets/")


def _validate_path(path: str) -> str:
    """Normalize and validate that a path stays within allowed prefixes."""
    normalized = posixpath.normpath(path)
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    if not any(
        normalized.startswith(p) or normalized == p.rstrip("/")
        for p in _ALLOWED_PREFIXES
    ):
        raise HTTPException(
            status_code=403, detail="Access denied: path outside allowed directories"
        )
    if ".." in normalized.split("/"):
        raise HTTPException(
            status_code=403, detail="Access denied: path traversal detected"
        )
    return normalized


@router.get("/files/list")
async def list_files(path: str = "/"):
    """List files/dirs in Modal Volume at given path."""
    try:
        path = _validate_path(path)

        def _blocking():
            vol = get_volume()
            return [
                {
                    "path": entry.path,
                    "type": "file" if entry.type.name == "FILE" else "directory",
                }
                for entry in vol.listdir(path, recursive=False)
            ]

        entries = await asyncio.to_thread(_blocking)
        return {"path": path, "entries": entries}
    except Exception as e:
        logger.error(f"list_files error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/read")
async def read_file(path: str):
    """Read a text file from Modal Volume."""
    try:
        path = _validate_path(path)

        def _blocking():
            vol = get_volume()
            return b"".join(vol.read_file(path))

        data = await asyncio.to_thread(_blocking)
        return {"path": path, "content": data.decode("utf-8", errors="replace")}
    except Exception as e:
        logger.error(f"read_file error: {e}")
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/files/raw")
async def raw_file(path: str):
    """Serve a raw file from Modal Volume (images, etc.)."""
    try:
        path = _validate_path(path)

        def _blocking():
            vol = get_volume()
            return b"".join(vol.read_file(path))

        data = await asyncio.to_thread(_blocking)
        mime, _ = mimetypes.guess_type(path)
        return Response(content=data, media_type=mime or "application/octet-stream")
    except Exception as e:
        logger.error(f"raw_file error: {e}")
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/files/tree")
async def file_tree(root: str = "/"):
    """Return a nested file tree from Modal Volume.

    The root is typically /sessions/{uuid}. We unwrap wrapper directories
    so the UI sees eda/, prep/, train/ at the top level.
    """
    try:
        root = _validate_path(root)

        def _blocking():
            vol = get_volume()
            return list(vol.listdir(root, recursive=True))

        entries = await asyncio.to_thread(_blocking)
        tree = _build_tree(root, entries)
        tree = _unwrap_tree(tree)
        tree["name"] = "workspace"
        return tree
    except Exception as e:
        logger.error(f"file_tree error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _build_tree(root: str, entries) -> dict:
    """Convert flat file listing into nested tree structure."""
    # Normalize: strip leading slashes for consistent comparison
    root_clean = root.strip("/")
    tree = {
        "name": root_clean.split("/")[-1] or "workspace",
        "path": root,
        "type": "directory",
        "children": [],
    }

    for entry in entries:
        # Get path relative to root (normalize both sides)
        rel = entry.path.lstrip("/")
        if rel.startswith(root_clean + "/"):
            rel = rel[len(root_clean) + 1 :]
        elif rel == root_clean:
            continue
        rel = rel.lstrip("/")
        if not rel:
            continue

        is_file = entry.type.name == "FILE"
        segments = rel.split("/")

        # Walk/create intermediate directories
        current = tree
        for i, seg in enumerate(segments):
            is_last = i == len(segments) - 1
            if is_last and is_file:
                current["children"].append(
                    {
                        "name": seg,
                        "path": entry.path,
                        "type": "file",
                    }
                )
            else:
                # Find or create directory node
                child = next(
                    (
                        c
                        for c in current["children"]
                        if c["name"] == seg and c["type"] == "directory"
                    ),
                    None,
                )
                if child is None:
                    child = {
                        "name": seg,
                        "path": root_clean + "/" + "/".join(segments[: i + 1]),
                        "type": "directory",
                        "children": [],
                    }
                    current["children"].append(child)
                current = child

    # Sort: directories first, then files, alphabetically
    _sort_tree(tree)
    return tree


def _sort_tree(node: dict):
    """Recursively sort tree children: dirs first, then files, alphabetically."""
    if "children" not in node:
        return
    for child in node["children"]:
        _sort_tree(child)
    node["children"].sort(
        key=lambda c: (0 if c["type"] == "directory" else 1, c["name"])
    )


def _is_infra_name(name: str) -> bool:
    """Check if a directory name is infrastructure (sessions, UUIDs) not a stage."""

    return name == "sessions" or bool(re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-", name))


def _unwrap_tree(tree: dict) -> dict:
    """Strip infrastructure directories (sessions, UUIDs) from tree root.

    sessions > {uuid} > eda, prep, train  →  eda, prep, train at top level.
    Never unwraps stage dirs (eda, prep, train) even if they're the only child.
    """
    while (
        tree.get("children")
        and len(tree["children"]) == 1
        and tree["children"][0].get("type") == "directory"
        and _is_infra_name(tree["children"][0].get("name", ""))
    ):
        only_child = tree["children"][0]
        tree["children"] = only_child.get("children", [])
    return tree
