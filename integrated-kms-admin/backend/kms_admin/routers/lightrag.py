from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from ..dependencies import get_current_user
from ..lightrag_client import lightrag_client

router = APIRouter(prefix="/api/lightrag", tags=["lightrag"])

WorkspaceMode = Literal["kms", "answer_catalog", "hybrid"]


def _filter_workspace_response(response: dict, user: dict) -> dict:
    if user.get("role") == "admin":
        return response
    allowed = {
        workspace
        for workspace in (user.get("kms_workspace"), user.get("faq_workspace"))
        if workspace
    }
    workspaces = [
        workspace
        for workspace in response.get("workspaces", [])
        if workspace.get("workspace_id") in allowed
    ]
    return {
        **response,
        "workspaces": workspaces,
        "total": len(workspaces),
        "page": 1,
        "page_size": max(len(workspaces), 1),
    }


@router.get("/workspaces")
async def list_lightrag_workspaces(
    user: dict = Depends(get_current_user),
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
    response = await lightrag_client.request_json("GET", "/workspaces", params=params)
    return _filter_workspace_response(response, user)
