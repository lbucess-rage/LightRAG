"""
This module contains all workspace-related routes for the LightRAG API.
Allows managing workspaces for multi-tenant data isolation.
"""

import json
from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from lightrag.utils import logger
from lightrag.kg.shared_storage import get_namespace_data
from ..utils_api import get_combined_auth_dependency

router = APIRouter(
    prefix="/workspaces",
    tags=["workspaces"],
)


# =====================================================
# Request/Response Models
# =====================================================


class WorkspaceCreate(BaseModel):
    """Request model for creating a workspace."""

    workspace_id: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Unique identifier for the workspace (alphanumeric, hyphens, underscores)",
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Display name for the workspace",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=1000,
        description="Optional description of the workspace",
    )
    metadata: Optional[dict] = Field(
        default=None,
        description="Optional JSON metadata for the workspace",
    )


class WorkspaceUpdate(BaseModel):
    """Request model for updating a workspace."""

    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="New display name for the workspace",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=1000,
        description="New description of the workspace",
    )
    metadata: Optional[dict] = Field(
        default=None,
        description="New JSON metadata for the workspace",
    )


class WorkspaceResponse(BaseModel):
    """Response model for workspace data."""

    workspace_id: str
    name: str
    description: Optional[str] = None
    is_default: bool = False
    document_count: int = 0
    entity_count: int = 0
    relation_count: int = 0
    metadata: Optional[dict] = None
    create_time: Optional[int] = None
    update_time: Optional[int] = None
    is_busy: bool = False


class WorkspaceListResponse(BaseModel):
    """Response model for workspace list."""

    workspaces: list[WorkspaceResponse]
    total: int
    page: int
    page_size: int


class WorkspaceStatsResponse(BaseModel):
    """Response model for workspace statistics."""

    workspace_id: str
    document_count: int
    entity_count: int
    relation_count: int
    is_busy: bool = False
    busy_start_time: Optional[float] = None


class CopySettingsRequest(BaseModel):
    """Request model for copying workspace settings."""

    target_workspace_id: str = Field(
        ...,
        description="Target workspace ID to copy settings to",
    )
    include_prompts: bool = Field(
        default=True,
        description="Whether to copy prompt customizations",
    )
    include_templates: bool = Field(
        default=True,
        description="Whether to copy user prompt templates",
    )


class CopyDataRequest(BaseModel):
    """Request model for copying workspace data."""

    target_workspace_id: str = Field(
        ...,
        description="Target workspace ID to copy data to",
    )
    include_documents: bool = Field(
        default=True,
        description="Whether to copy documents",
    )
    include_entities: bool = Field(
        default=True,
        description="Whether to copy entities",
    )
    include_relations: bool = Field(
        default=True,
        description="Whether to copy relations",
    )
    include_vectors: bool = Field(
        default=True,
        description="Whether to copy vector embeddings",
    )


ANSWER_CATALOG_COPY_TABLES = [
    {
        "table": "LIGHTRAG_ANSWER_ITEMS",
        "label": "answer_items",
        "columns": (
            "workspace, answer_id, title, body, approved_summary, content_format, "
            "display_policy, status, version, valid_from, valid_until, priority, "
            "tags, metadata, publish_time, create_time, update_time"
        ),
        "select": (
            "$2, answer_id, title, body, approved_summary, content_format, "
            "display_policy, status, version, valid_from, valid_until, priority, "
            "tags, metadata, publish_time, create_time, update_time"
        ),
        "conflict": "(workspace, answer_id)",
    },
    {
        "table": "LIGHTRAG_ANSWER_REVISIONS",
        "label": "answer_revisions",
        "columns": "revision_id, workspace, answer_id, version, snapshot_json, created_at",
        "select": "'rev-' || md5($2 || ':' || revision_id), $2, answer_id, version, snapshot_json, created_at",
        "conflict": "(revision_id)",
    },
    {
        "table": "LIGHTRAG_ANSWER_GUIDANCE",
        "label": "answer_guidance",
        "columns": "guidance_id, workspace, answer_id, guidance_type, text, weight, metadata, create_time",
        "select": "'agd-' || md5($2 || ':' || guidance_id), $2, answer_id, guidance_type, text, weight, metadata, create_time",
        "conflict": "(guidance_id)",
    },
    {
        "table": "LIGHTRAG_ANSWER_EVENTS",
        "label": "answer_events",
        "columns": "event_id, workspace, event_type, query, selected_answer_id, candidate_ids, scores, metadata, create_time",
        "select": "'evt-' || md5($2 || ':' || event_id), $2, event_type, query, selected_answer_id, candidate_ids, scores, metadata, create_time",
        "conflict": "(event_id)",
    },
]

ANSWER_CATALOG_TABLE_NAMES = [item["table"] for item in ANSWER_CATALOG_COPY_TABLES]


# =====================================================
# Route Factory
# =====================================================


def create_workspace_routes(rag, api_key: Optional[str] = None):
    """Create workspace management routes."""
    combined_auth = get_combined_auth_dependency(api_key)

    async def get_db():
        """Get database connection from rag's storage."""
        if hasattr(rag, "llm_response_cache") and hasattr(rag.llm_response_cache, "db"):
            return rag.llm_response_cache.db
        elif hasattr(rag, "text_chunks") and hasattr(rag.text_chunks, "db"):
            return rag.text_chunks.db
        return None

    async def get_workspace_busy_status(workspace_id: str) -> tuple[bool, Optional[float]]:
        """Check if workspace is busy (processing documents)."""
        try:
            pipeline_status = await get_namespace_data("pipeline_status", workspace=workspace_id)
            is_busy = pipeline_status.get("busy", False)
            busy_start_time = pipeline_status.get("busy_start_time")
            return is_busy, busy_start_time
        except Exception:
            return False, None

    async def copy_answer_catalog_tables(
        db,
        source_workspace_id: str,
        target_workspace_id: str,
        *,
        return_labels: bool = True,
    ) -> list[str]:
        """Copy FAQ answer-catalog tables while avoiding global ID conflicts."""
        copied_tables: list[str] = []
        for spec in ANSWER_CATALOG_COPY_TABLES:
            try:
                copy_sql = f"""
                    INSERT INTO {spec["table"]} ({spec["columns"]})
                    SELECT {spec["select"]}
                    FROM {spec["table"]} WHERE workspace = $1
                    ON CONFLICT {spec["conflict"]} DO NOTHING
                """
                await db.execute(
                    copy_sql,
                    {"src": source_workspace_id, "dst": target_workspace_id},
                )
                copied_tables.append(spec["label"] if return_labels else spec["table"])
            except Exception as e:
                logger.warning(f"Failed to copy {spec['table']}: {e}")
        return copied_tables

    # =====================================================
    # CRUD Endpoints
    # =====================================================

    @router.post(
        "",
        response_model=WorkspaceResponse,
        dependencies=[Depends(combined_auth)],
        summary="Create a new workspace",
        description="Create a new workspace for data isolation. Each workspace has its own documents, entities, relations, and settings.",
    )
    async def create_workspace(request: WorkspaceCreate):
        """Create a new workspace."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Check if workspace already exists
            if await db.workspace_exists(request.workspace_id):
                raise HTTPException(
                    status_code=409,
                    detail=f"Workspace '{request.workspace_id}' already exists",
                )

            # Create workspace
            result = await db.create_workspace(
                workspace_id=request.workspace_id,
                name=request.name,
                description=request.description,
                is_default=False,
                metadata=request.metadata,
            )

            if not result:
                raise HTTPException(status_code=500, detail="Failed to create workspace")

            return WorkspaceResponse(
                workspace_id=result["workspace_id"],
                name=result["name"],
                description=result.get("description"),
                is_default=result.get("is_default", False),
                document_count=result.get("document_count", 0),
                entity_count=result.get("entity_count", 0),
                relation_count=result.get("relation_count", 0),
                metadata=result.get("metadata"),
                create_time=result.get("create_time"),
                update_time=result.get("update_time"),
                is_busy=False,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to create workspace: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "",
        response_model=WorkspaceListResponse,
        dependencies=[Depends(combined_auth)],
        summary="List all workspaces",
        description="Get a paginated list of all workspaces with their statistics.",
    )
    async def list_workspaces(
        page: int = Query(default=1, ge=1, description="Page number"),
        page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    ):
        """List all workspaces with pagination."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            offset = (page - 1) * page_size
            workspaces, total = await db.list_workspaces(limit=page_size, offset=offset)

            # Add busy status for each workspace
            workspace_responses = []
            for ws in workspaces:
                is_busy, _ = await get_workspace_busy_status(ws["workspace_id"])
                workspace_responses.append(
                    WorkspaceResponse(
                        workspace_id=ws["workspace_id"],
                        name=ws["name"],
                        description=ws.get("description"),
                        is_default=ws.get("is_default", False),
                        document_count=ws.get("document_count", 0),
                        entity_count=ws.get("entity_count", 0),
                        relation_count=ws.get("relation_count", 0),
                        metadata=ws.get("metadata"),
                        create_time=ws.get("create_time"),
                        update_time=ws.get("update_time"),
                        is_busy=is_busy,
                    )
                )

            return WorkspaceListResponse(
                workspaces=workspace_responses,
                total=total,
                page=page,
                page_size=page_size,
            )
        except Exception as e:
            logger.error(f"Failed to list workspaces: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/{workspace_id}",
        response_model=WorkspaceResponse,
        dependencies=[Depends(combined_auth)],
        summary="Get workspace details",
        description="Get detailed information about a specific workspace.",
    )
    async def get_workspace(workspace_id: str):
        """Get workspace by ID."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            result = await db.get_workspace(workspace_id)
            if not result:
                raise HTTPException(
                    status_code=404,
                    detail=f"Workspace '{workspace_id}' not found",
                )

            is_busy, _ = await get_workspace_busy_status(workspace_id)

            return WorkspaceResponse(
                workspace_id=result["workspace_id"],
                name=result["name"],
                description=result.get("description"),
                is_default=result.get("is_default", False),
                document_count=result.get("document_count", 0),
                entity_count=result.get("entity_count", 0),
                relation_count=result.get("relation_count", 0),
                metadata=result.get("metadata"),
                create_time=result.get("create_time"),
                update_time=result.get("update_time"),
                is_busy=is_busy,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to get workspace: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.patch(
        "/{workspace_id}",
        response_model=WorkspaceResponse,
        dependencies=[Depends(combined_auth)],
        summary="Update workspace",
        description="Update workspace name, description, or metadata.",
    )
    async def update_workspace(workspace_id: str, request: WorkspaceUpdate):
        """Update workspace information."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Check if workspace exists
            if not await db.workspace_exists(workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Workspace '{workspace_id}' not found",
                )

            # Update workspace
            result = await db.update_workspace(
                workspace_id=workspace_id,
                name=request.name,
                description=request.description,
                metadata=request.metadata,
            )

            if not result:
                raise HTTPException(status_code=500, detail="Failed to update workspace")

            is_busy, _ = await get_workspace_busy_status(workspace_id)

            return WorkspaceResponse(
                workspace_id=result["workspace_id"],
                name=result["name"],
                description=result.get("description"),
                is_default=result.get("is_default", False),
                document_count=result.get("document_count", 0),
                entity_count=result.get("entity_count", 0),
                relation_count=result.get("relation_count", 0),
                metadata=result.get("metadata"),
                create_time=result.get("create_time"),
                update_time=result.get("update_time"),
                is_busy=is_busy,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to update workspace: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete(
        "/{workspace_id}",
        dependencies=[Depends(combined_auth)],
        summary="Delete workspace",
        description="Delete a workspace and all its data. Cannot delete default workspace or workspace that is currently busy.",
    )
    async def delete_workspace(
        workspace_id: str,
        delete_data: bool = Query(
            default=True,
            description="Whether to delete all data in the workspace",
        ),
    ):
        """Delete a workspace."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Check if workspace exists
            workspace = await db.get_workspace(workspace_id)
            if not workspace:
                raise HTTPException(
                    status_code=404,
                    detail=f"Workspace '{workspace_id}' not found",
                )

            # Cannot delete default workspace
            if workspace.get("is_default"):
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete the default workspace. Set another workspace as default first.",
                )

            # Check if workspace is busy
            is_busy, _ = await get_workspace_busy_status(workspace_id)
            if is_busy:
                raise HTTPException(
                    status_code=409,
                    detail=f"Workspace '{workspace_id}' is currently processing. Please wait until processing is complete.",
                )

            # Delete workspace
            success = await db.delete_workspace(workspace_id, delete_data=delete_data)
            if not success:
                raise HTTPException(status_code=500, detail="Failed to delete workspace")

            return {"message": f"Workspace '{workspace_id}' deleted successfully"}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to delete workspace: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # =====================================================
    # Status Endpoints
    # =====================================================

    @router.get(
        "/{workspace_id}/stats",
        response_model=WorkspaceStatsResponse,
        dependencies=[Depends(combined_auth)],
        summary="Get workspace statistics",
        description="Get real-time statistics for a workspace including document, entity, and relation counts.",
    )
    async def get_workspace_stats(workspace_id: str):
        """Get workspace statistics."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Check if workspace exists
            if not await db.workspace_exists(workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Workspace '{workspace_id}' not found",
                )

            # Get real-time stats
            stats = await db.get_workspace_stats(workspace_id)
            is_busy, busy_start_time = await get_workspace_busy_status(workspace_id)

            return WorkspaceStatsResponse(
                workspace_id=workspace_id,
                document_count=stats.get("document_count", 0),
                entity_count=stats.get("entity_count", 0),
                relation_count=stats.get("relation_count", 0),
                is_busy=is_busy,
                busy_start_time=busy_start_time,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to get workspace stats: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/{workspace_id}/sync-stats",
        dependencies=[Depends(combined_auth)],
        summary="Synchronize workspace statistics",
        description="Update the cached statistics for a workspace with actual counts from the database.",
    )
    async def sync_workspace_stats(workspace_id: str):
        """Synchronize workspace statistics with actual data."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Check if workspace exists
            if not await db.workspace_exists(workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Workspace '{workspace_id}' not found",
                )

            await db.sync_workspace_stats(workspace_id)
            return {"message": f"Statistics synchronized for workspace '{workspace_id}'"}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to sync workspace stats: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # =====================================================
    # Default Workspace Endpoints
    # =====================================================

    @router.post(
        "/{workspace_id}/set-default",
        dependencies=[Depends(combined_auth)],
        summary="Set default workspace",
        description="Set a workspace as the default workspace.",
    )
    async def set_default_workspace(workspace_id: str):
        """Set a workspace as the default."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Check if workspace exists
            if not await db.workspace_exists(workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Workspace '{workspace_id}' not found",
                )

            success = await db.set_default_workspace(workspace_id)
            if not success:
                raise HTTPException(status_code=500, detail="Failed to set default workspace")

            return {"message": f"Workspace '{workspace_id}' is now the default workspace"}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to set default workspace: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/default",
        response_model=WorkspaceResponse,
        dependencies=[Depends(combined_auth)],
        summary="Get default workspace",
        description="Get the current default workspace.",
    )
    async def get_default_workspace_route():
        """Get the default workspace."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            workspaces, _ = await db.list_workspaces()
            default_ws = next((ws for ws in workspaces if ws.get("is_default")), None)

            if not default_ws:
                raise HTTPException(status_code=404, detail="No default workspace found")

            is_busy, _ = await get_workspace_busy_status(default_ws["workspace_id"])

            return WorkspaceResponse(
                workspace_id=default_ws["workspace_id"],
                name=default_ws["name"],
                description=default_ws.get("description"),
                is_default=True,
                document_count=default_ws.get("document_count", 0),
                entity_count=default_ws.get("entity_count", 0),
                relation_count=default_ws.get("relation_count", 0),
                metadata=default_ws.get("metadata"),
                create_time=default_ws.get("create_time"),
                update_time=default_ws.get("update_time"),
                is_busy=is_busy,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to get default workspace: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # =====================================================
    # Data Copy/Move Endpoints (Phase 4 placeholder)
    # =====================================================

    @router.post(
        "/{workspace_id}/copy-settings",
        dependencies=[Depends(combined_auth)],
        summary="Copy workspace settings",
        description="Copy prompts and templates from one workspace to another.",
    )
    async def copy_workspace_settings(workspace_id: str, request: CopySettingsRequest):
        """Copy settings from one workspace to another."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Validate source workspace
            if not await db.workspace_exists(workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Source workspace '{workspace_id}' not found",
                )

            # Validate target workspace
            if not await db.workspace_exists(request.target_workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Target workspace '{request.target_workspace_id}' not found",
                )

            if workspace_id == request.target_workspace_id:
                raise HTTPException(
                    status_code=400,
                    detail="Source and target workspace cannot be the same",
                )

            copied_items = []

            # Copy prompts
            if request.include_prompts:
                try:
                    copy_sql = """
                        INSERT INTO LIGHTRAG_PROMPTS (workspace, prompt_key, prompt_value, prompt_type, description, is_active)
                        SELECT $2, prompt_key, prompt_value, prompt_type, description, is_active
                        FROM LIGHTRAG_PROMPTS WHERE workspace = $1
                        ON CONFLICT (workspace, prompt_key) DO UPDATE
                        SET prompt_value = EXCLUDED.prompt_value,
                            prompt_type = EXCLUDED.prompt_type,
                            description = EXCLUDED.description,
                            is_active = EXCLUDED.is_active,
                            update_time = CURRENT_TIMESTAMP
                    """
                    await db.execute(copy_sql, {"src": workspace_id, "dst": request.target_workspace_id})
                    copied_items.append("prompts")
                except Exception as e:
                    logger.warning(f"Failed to copy prompts: {e}")

            # Copy user prompt templates
            if request.include_templates:
                try:
                    copy_sql = """
                        INSERT INTO LIGHTRAG_USER_PROMPT_TEMPLATES (workspace, template_id, template_name, content, description, is_favorite)
                        SELECT $2, template_id, template_name, content, description, is_favorite
                        FROM LIGHTRAG_USER_PROMPT_TEMPLATES WHERE workspace = $1
                        ON CONFLICT (workspace, template_id) DO UPDATE
                        SET template_name = EXCLUDED.template_name,
                            content = EXCLUDED.content,
                            description = EXCLUDED.description,
                            is_favorite = EXCLUDED.is_favorite,
                            update_time = CURRENT_TIMESTAMP
                    """
                    await db.execute(copy_sql, {"src": workspace_id, "dst": request.target_workspace_id})
                    copied_items.append("templates")
                except Exception as e:
                    logger.warning(f"Failed to copy templates: {e}")

            return {
                "message": f"Settings copied from '{workspace_id}' to '{request.target_workspace_id}'",
                "copied_items": copied_items,
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to copy settings: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/{workspace_id}/copy-data",
        dependencies=[Depends(combined_auth)],
        summary="Copy workspace data",
        description="Copy documents, entities, and relations from one workspace to another. This is a long-running operation.",
    )
    async def copy_workspace_data(workspace_id: str, request: CopyDataRequest):
        """Copy data from one workspace to another."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Validate source workspace
            if not await db.workspace_exists(workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Source workspace '{workspace_id}' not found",
                )

            # Validate target workspace
            if not await db.workspace_exists(request.target_workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Target workspace '{request.target_workspace_id}' not found",
                )

            if workspace_id == request.target_workspace_id:
                raise HTTPException(
                    status_code=400,
                    detail="Source and target workspace cannot be the same",
                )

            # Check if target workspace is busy
            is_busy, _ = await get_workspace_busy_status(request.target_workspace_id)
            if is_busy:
                raise HTTPException(
                    status_code=409,
                    detail=f"Target workspace '{request.target_workspace_id}' is currently busy",
                )

            copied_tables = []

            # Copy documents
            if request.include_documents:
                try:
                    # Copy doc_full
                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_DOC_FULL (id, workspace, doc_name, content, meta)
                        SELECT id, $2, doc_name, content, meta
                        FROM LIGHTRAG_DOC_FULL WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )

                    # Copy doc_chunks
                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_DOC_CHUNKS (id, workspace, full_doc_id, chunk_order_index, tokens, content, file_path)
                        SELECT id, $2, full_doc_id, chunk_order_index, tokens, content, file_path
                        FROM LIGHTRAG_DOC_CHUNKS WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )

                    # Copy doc_status
                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_DOC_STATUS (id, workspace, content_summary, content_length, chunks_count, status, file_path)
                        SELECT id, $2, content_summary, content_length, chunks_count, status, file_path
                        FROM LIGHTRAG_DOC_STATUS WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )
                    copied_tables.extend(["doc_full", "doc_chunks", "doc_status"])
                except Exception as e:
                    logger.warning(f"Failed to copy documents: {e}")

                copied_tables.extend(
                    await copy_answer_catalog_tables(
                        db,
                        workspace_id,
                        request.target_workspace_id,
                        return_labels=True,
                    )
                )

            # Copy entities and relations
            if request.include_entities:
                try:
                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_FULL_ENTITIES (id, workspace, entity_names, count)
                        SELECT id, $2, entity_names, count
                        FROM LIGHTRAG_FULL_ENTITIES WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )

                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_ENTITY_CHUNKS (id, workspace, chunk_ids, count)
                        SELECT id, $2, chunk_ids, count
                        FROM LIGHTRAG_ENTITY_CHUNKS WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )
                    copied_tables.extend(["full_entities", "entity_chunks"])
                except Exception as e:
                    logger.warning(f"Failed to copy entities: {e}")

            if request.include_relations:
                try:
                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_FULL_RELATIONS (id, workspace, relation_pairs, count)
                        SELECT id, $2, relation_pairs, count
                        FROM LIGHTRAG_FULL_RELATIONS WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )

                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_RELATION_CHUNKS (id, workspace, chunk_ids, count)
                        SELECT id, $2, chunk_ids, count
                        FROM LIGHTRAG_RELATION_CHUNKS WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )
                    copied_tables.extend(["full_relations", "relation_chunks"])
                except Exception as e:
                    logger.warning(f"Failed to copy relations: {e}")

            # Copy vectors
            if request.include_vectors:
                try:
                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_VDB_CHUNKS (id, workspace, full_doc_id, chunk_order_index, tokens, content, content_vector)
                        SELECT id, $2, full_doc_id, chunk_order_index, tokens, content, content_vector
                        FROM LIGHTRAG_VDB_CHUNKS WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )

                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_VDB_ENTITY (id, workspace, entity_name, content, content_vector)
                        SELECT id, $2, entity_name, content, content_vector
                        FROM LIGHTRAG_VDB_ENTITY WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )

                    await db.execute(
                        """
                        INSERT INTO LIGHTRAG_VDB_RELATION (id, workspace, source_id, target_id, content, content_vector)
                        SELECT id, $2, source_id, target_id, content, content_vector
                        FROM LIGHTRAG_VDB_RELATION WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                        """,
                        {"src": workspace_id, "dst": request.target_workspace_id},
                    )
                    copied_tables.extend(["vdb_chunks", "vdb_entity", "vdb_relation"])
                except Exception as e:
                    logger.warning(f"Failed to copy vectors: {e}")

            # Sync target workspace stats
            await db.sync_workspace_stats(request.target_workspace_id)

            return {
                "message": f"Data copied from '{workspace_id}' to '{request.target_workspace_id}'",
                "copied_tables": copied_tables,
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to copy data: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/{workspace_id}/move-data",
        dependencies=[Depends(combined_auth)],
        summary="Move workspace data",
        description="Move all data from one workspace to another. Source workspace data will be deleted after successful copy.",
    )
    async def move_workspace_data(workspace_id: str, request: CopyDataRequest):
        """Move data from one workspace to another (copy then delete source)."""
        db = await get_db()
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")

        try:
            # Validate source workspace
            source_ws = await db.get_workspace(workspace_id)
            if not source_ws:
                raise HTTPException(
                    status_code=404,
                    detail=f"Source workspace '{workspace_id}' not found",
                )

            # Cannot move from default workspace
            if source_ws.get("is_default"):
                raise HTTPException(
                    status_code=400,
                    detail="Cannot move data from the default workspace",
                )

            # Check if source workspace is busy
            is_busy, _ = await get_workspace_busy_status(workspace_id)
            if is_busy:
                raise HTTPException(
                    status_code=409,
                    detail=f"Source workspace '{workspace_id}' is currently busy",
                )

            # Validate target workspace
            if not await db.workspace_exists(request.target_workspace_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Target workspace '{request.target_workspace_id}' not found",
                )

            if workspace_id == request.target_workspace_id:
                raise HTTPException(
                    status_code=400,
                    detail="Source and target workspace cannot be the same",
                )

            # Check if target workspace is busy
            target_busy, _ = await get_workspace_busy_status(request.target_workspace_id)
            if target_busy:
                raise HTTPException(
                    status_code=409,
                    detail=f"Target workspace '{request.target_workspace_id}' is currently busy",
                )

            moved_tables = []
            deleted_tables = []

            # Tables to process
            tables_config = []
            if request.include_documents:
                tables_config.extend([
                    ("LIGHTRAG_DOC_FULL", "id, workspace, doc_name, content, meta"),
                    ("LIGHTRAG_DOC_CHUNKS", "id, workspace, full_doc_id, chunk_order_index, tokens, content, file_path"),
                    ("LIGHTRAG_DOC_STATUS", "id, workspace, content_summary, content_length, chunks_count, status, file_path"),
                ])
            if request.include_entities:
                tables_config.extend([
                    ("LIGHTRAG_FULL_ENTITIES", "id, workspace, entity_names, count"),
                    ("LIGHTRAG_ENTITY_CHUNKS", "id, workspace, chunk_ids, count"),
                ])
            if request.include_relations:
                tables_config.extend([
                    ("LIGHTRAG_FULL_RELATIONS", "id, workspace, relation_pairs, count"),
                    ("LIGHTRAG_RELATION_CHUNKS", "id, workspace, chunk_ids, count"),
                ])
            if request.include_vectors:
                tables_config.extend([
                    ("LIGHTRAG_VDB_CHUNKS", "id, workspace, full_doc_id, chunk_order_index, tokens, content, content_vector"),
                    ("LIGHTRAG_VDB_ENTITY", "id, workspace, entity_name, content, content_vector"),
                    ("LIGHTRAG_VDB_RELATION", "id, workspace, source_id, target_id, content, content_vector"),
                ])

            # Copy data from each table
            for table_name, columns in tables_config:
                try:
                    # Build column list for INSERT (replace workspace with target)
                    col_list = columns.split(", ")
                    insert_cols = ", ".join(col_list)
                    select_cols = ", ".join(
                        ["$2" if c.strip() == "workspace" else c.strip() for c in col_list]
                    )

                    copy_sql = f"""
                        INSERT INTO {table_name} ({insert_cols})
                        SELECT {select_cols}
                        FROM {table_name} WHERE workspace = $1
                        ON CONFLICT (workspace, id) DO NOTHING
                    """
                    await db.execute(copy_sql, {"src": workspace_id, "dst": request.target_workspace_id})
                    moved_tables.append(table_name)
                except Exception as e:
                    logger.warning(f"Failed to copy {table_name}: {e}")

            answer_catalog_moved_tables = []
            if request.include_documents:
                answer_catalog_moved_tables = await copy_answer_catalog_tables(
                    db,
                    workspace_id,
                    request.target_workspace_id,
                    return_labels=False,
                )
                moved_tables.extend(answer_catalog_moved_tables)

            # Delete source data after successful copy
            for table_name, _ in tables_config:
                if table_name in moved_tables:
                    try:
                        delete_sql = f"DELETE FROM {table_name} WHERE workspace = $1"
                        await db.execute(delete_sql, {"workspace": workspace_id})
                        deleted_tables.append(table_name)
                    except Exception as e:
                        logger.warning(f"Failed to delete from {table_name}: {e}")

            for table_name in ANSWER_CATALOG_TABLE_NAMES:
                if table_name in answer_catalog_moved_tables:
                    try:
                        delete_sql = f"DELETE FROM {table_name} WHERE workspace = $1"
                        await db.execute(delete_sql, {"workspace": workspace_id})
                        deleted_tables.append(table_name)
                    except Exception as e:
                        logger.warning(f"Failed to delete from {table_name}: {e}")

            # Sync both workspace stats
            await db.sync_workspace_stats(workspace_id)
            await db.sync_workspace_stats(request.target_workspace_id)

            return {
                "message": f"Data moved from '{workspace_id}' to '{request.target_workspace_id}'",
                "moved_tables": moved_tables,
                "deleted_from_source": deleted_tables,
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to move data: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
