from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from ..dependencies import get_current_user
from ..lightrag_client import lightrag_client

router = APIRouter(prefix="/api/lightrag", tags=["lightrag"])

WorkspaceMode = Literal["kms", "answer_catalog", "hybrid"]


@router.get("/workspaces")
async def list_lightrag_workspaces(
    _: dict = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
    search: str | None = None,
    workspace_mode: WorkspaceMode | None = None,
) -> dict:
    params: dict[str, object] = {"page": page, "page_size": page_size}
    if search:
        params["search"] = search
    if workspace_mode:
        params["workspace_mode"] = workspace_mode
    return await lightrag_client.request_json("GET", "/workspaces", params=params)
