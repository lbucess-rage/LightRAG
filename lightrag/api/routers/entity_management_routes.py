"""
This module contains entity management routes for the LightRAG API.
Provides paginated access to entities and relations for the Entity Management Center.
"""

from typing import Optional, List
import traceback
from fastapi import APIRouter, Depends, Query, HTTPException, Request
from pydantic import BaseModel, Field

from lightrag.utils import logger
from lightrag.kg.shared_storage import get_default_workspace
from ..utils_api import get_combined_auth_dependency

router = APIRouter(tags=["entity-management"])

# Import RAG workspace management functions (will be available after server startup)
_get_rag_for_workspace = None


def set_rag_workspace_getter(getter_func):
    """Set the function to get RAG instance by workspace.

    This is called from lightrag_server.py after the RAG factory is configured.
    """
    global _get_rag_for_workspace
    _get_rag_for_workspace = getter_func


async def get_workspace_rag(workspace: str):
    """Get RAG instance for the specified workspace.

    Args:
        workspace: Workspace identifier

    Returns:
        RAG instance for the workspace, or None if not available
    """
    if _get_rag_for_workspace is not None:
        return await _get_rag_for_workspace(workspace)
    return None


def _get_workspace_from_request(request: Request) -> str:
    """Extract workspace from request header.

    Args:
        request: FastAPI Request object

    Returns:
        Workspace ID from header or default workspace
    """
    workspace = request.headers.get("LIGHTRAG-WORKSPACE", "").strip()
    if workspace:
        return workspace
    # Fall back to server default workspace
    return get_default_workspace() or "base"


# Request/Response Models
class EntitiesRequest(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=20, ge=1, le=100, description="Items per page")
    search: Optional[str] = Field(default=None, description="Search query for entity_id")
    entity_type: Optional[str] = Field(default=None, description="Filter by entity type")
    sort_field: str = Field(default="entity_id", description="Field to sort by")
    sort_direction: str = Field(default="asc", description="Sort direction: asc or desc")


class EntityResponse(BaseModel):
    entity_id: str
    entity_type: Optional[str] = None
    description: Optional[str] = None
    source_id: Optional[str] = None
    file_path: Optional[str] = None
    created_at: Optional[str] = None
    degree: int = 0


class PaginationInfo(BaseModel):
    page: int
    page_size: int
    total_count: int
    total_pages: int
    has_next: bool
    has_prev: bool


class EntitiesResponse(BaseModel):
    entities: List[EntityResponse]
    pagination: PaginationInfo


class EntityTypeCount(BaseModel):
    entity_type: str
    count: int


class EntityTypesResponse(BaseModel):
    types: List[EntityTypeCount]
    total_entities: int


class RelationsRequest(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=20, ge=1, le=100, description="Items per page")
    search: Optional[str] = Field(default=None, description="Search query for source/target/keywords")
    sort_field: str = Field(default="source_id", description="Field to sort by")
    sort_direction: str = Field(default="asc", description="Sort direction: asc or desc")


class RelationResponse(BaseModel):
    source_id: str
    target_id: str
    weight: Optional[float] = None
    keywords: Optional[str] = None
    description: Optional[str] = None
    source_chunk_id: Optional[str] = None
    created_at: Optional[str] = None


class RelationsResponse(BaseModel):
    relations: List[RelationResponse]
    pagination: PaginationInfo


class RelatedEntityItem(BaseModel):
    entity_id: str
    entity_type: Optional[str] = None
    description: Optional[str] = None
    degree: int = 0


class RelatedEntitiesResponse(BaseModel):
    related: List[RelatedEntityItem]
    total: int


class DeleteEntityResponse(BaseModel):
    status: str
    message: str


class BatchDeleteRequest(BaseModel):
    entity_ids: List[str] = Field(..., description="List of entity IDs to delete")
    cascade: bool = Field(default=True, description="If true, also delete vector embeddings and chunk mappings")


class BatchDeleteResponse(BaseModel):
    status: str
    message: str
    deleted: int
    failed: int


class DeleteRelationRequest(BaseModel):
    source_id: str = Field(..., description="Source entity ID")
    target_id: str = Field(..., description="Target entity ID")


class DeleteRelationResponse(BaseModel):
    status: str
    message: str


def create_entity_management_routes(rag, api_key: Optional[str] = None):
    combined_auth = get_combined_auth_dependency(api_key)

    @router.post("/entities", dependencies=[Depends(combined_auth)])
    async def get_entities_paginated(http_request: Request, request: EntitiesRequest):
        """
        Get paginated list of entities with optional search and filtering.

        Args:
            request: EntitiesRequest with pagination, search, and filter options

        Returns:
            EntitiesResponse with entities list and pagination info
        """
        try:
            # Get workspace-specific RAG instance
            workspace = _get_workspace_from_request(http_request)
            workspace_rag = await get_workspace_rag(workspace)
            if workspace_rag is None:
                workspace_rag = rag
                logger.warning(f"[EntityMgmt] Using default RAG instance for workspace: {workspace}")
            else:
                logger.debug(f"[EntityMgmt] Using workspace-specific RAG instance for: {workspace}")

            graph_storage = workspace_rag.chunk_entity_relation_graph

            # Get entities with pagination
            result = await graph_storage.get_entities_paginated(
                page=request.page,
                page_size=request.page_size,
                search=request.search,
                entity_type=request.entity_type,
                sort_field=request.sort_field,
                sort_direction=request.sort_direction,
            )

            return result
        except Exception as e:
            logger.error(f"Error getting entities: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error getting entities: {str(e)}"
            )

    @router.get("/entity-types", dependencies=[Depends(combined_auth)])
    async def get_entity_types(http_request: Request):
        """
        Get list of all entity types with their counts.

        Returns:
            EntityTypesResponse with list of types and counts
        """
        try:
            # Get workspace-specific RAG instance
            workspace = _get_workspace_from_request(http_request)
            workspace_rag = await get_workspace_rag(workspace)
            if workspace_rag is None:
                workspace_rag = rag
                logger.warning(f"[EntityMgmt] Using default RAG instance for workspace: {workspace}")
            else:
                logger.debug(f"[EntityMgmt] Using workspace-specific RAG instance for: {workspace}")

            graph_storage = workspace_rag.chunk_entity_relation_graph

            result = await graph_storage.get_entity_type_counts()

            return result
        except Exception as e:
            logger.error(f"Error getting entity types: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error getting entity types: {str(e)}"
            )

    @router.post("/relations", dependencies=[Depends(combined_auth)])
    async def get_relations_paginated(http_request: Request, request: RelationsRequest):
        """
        Get paginated list of relations with optional search.

        Args:
            request: RelationsRequest with pagination and search options

        Returns:
            RelationsResponse with relations list and pagination info
        """
        try:
            # Get workspace-specific RAG instance
            workspace = _get_workspace_from_request(http_request)
            workspace_rag = await get_workspace_rag(workspace)
            if workspace_rag is None:
                workspace_rag = rag
                logger.warning(f"[EntityMgmt] Using default RAG instance for workspace: {workspace}")
            else:
                logger.debug(f"[EntityMgmt] Using workspace-specific RAG instance for: {workspace}")

            graph_storage = workspace_rag.chunk_entity_relation_graph

            result = await graph_storage.get_relations_paginated(
                page=request.page,
                page_size=request.page_size,
                search=request.search,
                sort_field=request.sort_field,
                sort_direction=request.sort_direction,
            )

            return result
        except Exception as e:
            logger.error(f"Error getting relations: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error getting relations: {str(e)}"
            )

    @router.get("/entities/{entity_id}/related", dependencies=[Depends(combined_auth)])
    async def get_related_entities(
        http_request: Request,
        entity_id: str,
    ):
        """
        Find entities with similar names to the given entity.
        Used to suggest related entities for batch deletion.
        """
        try:
            workspace = _get_workspace_from_request(http_request)
            workspace_rag = await get_workspace_rag(workspace)
            if workspace_rag is None:
                workspace_rag = rag

            graph_storage = workspace_rag.chunk_entity_relation_graph

            # Extract core keywords from entity name (remove common suffixes like (image), (table))
            import re
            core_name = re.sub(r'\s*\((?:image|table|equation)\)\s*$', '', entity_id, flags=re.IGNORECASE).strip()
            # Use the longest meaningful segment (at least 4 chars)
            if len(core_name) < 4:
                core_name = entity_id

            # Search for entities containing the core name
            result = await graph_storage.get_entities_paginated(
                page=1,
                page_size=50,
                search=core_name,
            )

            related = []
            for entity in result.get("entities", []):
                eid = entity.get("entity_id", "")
                if eid != entity_id:  # Exclude the entity itself
                    related.append(RelatedEntityItem(
                        entity_id=eid,
                        entity_type=entity.get("entity_type"),
                        description=entity.get("description", "")[:100] if entity.get("description") else None,
                        degree=entity.get("degree", 0),
                    ))

            return RelatedEntitiesResponse(related=related, total=len(related))
        except Exception as e:
            logger.error(f"Error finding related entities for '{entity_id}': {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/entities/batch-delete", dependencies=[Depends(combined_auth)])
    async def batch_delete_entities(
        http_request: Request,
        request: BatchDeleteRequest,
    ):
        """
        Delete multiple entities in batch.
        """
        try:
            workspace = _get_workspace_from_request(http_request)
            workspace_rag = await get_workspace_rag(workspace)
            if workspace_rag is None:
                workspace_rag = rag

            deleted = 0
            failed = 0
            messages = []

            for entity_id in request.entity_ids:
                try:
                    if request.cascade:
                        from lightrag.utils_graph import adelete_by_entity

                        result = await adelete_by_entity(
                            chunk_entity_relation_graph=workspace_rag.chunk_entity_relation_graph,
                            entities_vdb=workspace_rag.entities_vdb,
                            relationships_vdb=workspace_rag.relationships_vdb,
                            entity_name=entity_id,
                            entity_chunks_storage=workspace_rag.entity_chunks,
                            relation_chunks_storage=workspace_rag.relation_chunks,
                            text_chunks_storage=workspace_rag.text_chunks,
                            chunks_vdb=workspace_rag.chunks_vdb,
                            llm_response_cache=workspace_rag.llm_response_cache,
                        )
                        if result.status_code == 200:
                            deleted += 1
                            messages.append(result.message)
                        else:
                            failed += 1
                            messages.append(f"Failed: {entity_id} - {result.message}")
                    else:
                        graph_storage = workspace_rag.chunk_entity_relation_graph
                        if await graph_storage.has_node(entity_id):
                            await graph_storage.delete_node(entity_id)
                            deleted += 1
                        else:
                            failed += 1
                            messages.append(f"Not found: {entity_id}")
                except Exception as e:
                    failed += 1
                    messages.append(f"Error: {entity_id} - {str(e)}")
                    logger.error(f"Batch delete error for '{entity_id}': {str(e)}")

            summary = f"Batch delete: {deleted} deleted, {failed} failed out of {len(request.entity_ids)}"
            logger.info(summary)
            return BatchDeleteResponse(
                status="success" if failed == 0 else "partial",
                message=summary,
                deleted=deleted,
                failed=failed,
            )
        except Exception as e:
            logger.error(f"Error in batch delete: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/entities/{entity_id}", dependencies=[Depends(combined_auth)])
    async def delete_entity(
        http_request: Request,
        entity_id: str,
        cascade: bool = Query(True, description="true: delete graph+vector+chunk mappings, false: graph only"),
    ):
        """
        Delete an entity and optionally cascade to vector embeddings and chunk mappings.

        Args:
            entity_id: The entity ID to delete
            cascade: If true, also delete vector embeddings and chunk mappings

        Returns:
            DeleteEntityResponse with status and message
        """
        try:
            # Get workspace-specific RAG instance
            workspace = _get_workspace_from_request(http_request)
            workspace_rag = await get_workspace_rag(workspace)
            if workspace_rag is None:
                workspace_rag = rag
                logger.warning(f"[EntityMgmt] Using default RAG instance for workspace: {workspace}")
            else:
                logger.debug(f"[EntityMgmt] Using workspace-specific RAG instance for: {workspace}")

            graph_storage = workspace_rag.chunk_entity_relation_graph

            # Check if entity exists
            exists = await graph_storage.has_node(entity_id)
            if not exists:
                raise HTTPException(
                    status_code=404, detail=f"Entity '{entity_id}' not found"
                )

            if cascade:
                from lightrag.utils_graph import adelete_by_entity

                result = await adelete_by_entity(
                    chunk_entity_relation_graph=workspace_rag.chunk_entity_relation_graph,
                    entities_vdb=workspace_rag.entities_vdb,
                    relationships_vdb=workspace_rag.relationships_vdb,
                    entity_name=entity_id,
                    entity_chunks_storage=workspace_rag.entity_chunks,
                    relation_chunks_storage=workspace_rag.relation_chunks,
                    text_chunks_storage=workspace_rag.text_chunks,
                    chunks_vdb=workspace_rag.chunks_vdb,
                    llm_response_cache=workspace_rag.llm_response_cache,
                )
                if result.status_code != 200:
                    raise HTTPException(status_code=result.status_code, detail=result.message)
                return DeleteEntityResponse(status="success", message=result.message)
            else:
                await graph_storage.delete_node(entity_id)
                return DeleteEntityResponse(
                    status="success",
                    message=f"Entity '{entity_id}' deleted from graph only"
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting entity '{entity_id}': {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error deleting entity: {str(e)}"
            )

    @router.delete("/relations", dependencies=[Depends(combined_auth)])
    async def delete_relation(
        http_request: Request,
        request: DeleteRelationRequest,
        cascade: bool = Query(True, description="true: delete graph+vector+chunk mappings, false: graph only"),
    ):
        """
        Delete a relation between two entities, optionally cascading to vector embeddings and chunk mappings.

        Args:
            request: DeleteRelationRequest with source_id and target_id
            cascade: If true, also delete vector embeddings and chunk mappings

        Returns:
            DeleteRelationResponse with status and message
        """
        try:
            # Get workspace-specific RAG instance
            workspace = _get_workspace_from_request(http_request)
            workspace_rag = await get_workspace_rag(workspace)
            if workspace_rag is None:
                workspace_rag = rag
                logger.warning(f"[EntityMgmt] Using default RAG instance for workspace: {workspace}")
            else:
                logger.debug(f"[EntityMgmt] Using workspace-specific RAG instance for: {workspace}")

            graph_storage = workspace_rag.chunk_entity_relation_graph

            # Check if relation exists
            exists = await graph_storage.has_edge(request.source_id, request.target_id)
            if not exists:
                raise HTTPException(
                    status_code=404,
                    detail=f"Relation between '{request.source_id}' and '{request.target_id}' not found"
                )

            if cascade:
                from lightrag.utils_graph import adelete_by_relation

                result = await adelete_by_relation(
                    chunk_entity_relation_graph=workspace_rag.chunk_entity_relation_graph,
                    relationships_vdb=workspace_rag.relationships_vdb,
                    source_entity=request.source_id,
                    target_entity=request.target_id,
                    relation_chunks_storage=workspace_rag.relation_chunks,
                    entity_chunks_storage=workspace_rag.entity_chunks,
                    text_chunks_storage=workspace_rag.text_chunks,
                    chunks_vdb=workspace_rag.chunks_vdb,
                    llm_response_cache=workspace_rag.llm_response_cache,
                )
                if result.status_code != 200:
                    raise HTTPException(status_code=result.status_code, detail=result.message)
                return DeleteRelationResponse(status="success", message=result.message)
            else:
                await graph_storage.remove_edges([(request.source_id, request.target_id)])
                return DeleteRelationResponse(
                    status="success",
                    message=f"Relation between '{request.source_id}' and '{request.target_id}' deleted from graph only"
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                f"Error deleting relation between '{request.source_id}' and '{request.target_id}': {str(e)}"
            )
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error deleting relation: {str(e)}"
            )

    return router
