"""
This module contains all user prompt template routes for the LightRAG API.
Allows managing user prompt templates stored in PostgreSQL per workspace.
"""

import uuid
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lightrag.utils import logger
from ..utils_api import get_combined_auth_dependency

router = APIRouter(
    prefix="/user-prompt-templates",
    tags=["user-prompt-templates"],
)


class UserPromptTemplate(BaseModel):
    template_id: str
    template_name: str
    content: str
    description: Optional[str] = None
    is_favorite: bool = False
    create_time: Optional[str] = None
    update_time: Optional[str] = None


class UserPromptTemplateCreateRequest(BaseModel):
    template_name: str = Field(..., description="Template name")
    content: str = Field(..., description="Template content")
    description: Optional[str] = Field(default=None, description="Template description")
    is_favorite: Optional[bool] = Field(default=False, description="Mark as favorite")


class UserPromptTemplateUpdateRequest(BaseModel):
    template_name: Optional[str] = Field(default=None, description="Template name")
    content: Optional[str] = Field(default=None, description="Template content")
    description: Optional[str] = Field(default=None, description="Template description")
    is_favorite: Optional[bool] = Field(default=None, description="Mark as favorite")


def create_user_prompt_template_routes(rag, api_key: Optional[str] = None):
    """Create user prompt template management routes."""
    combined_auth = get_combined_auth_dependency(api_key)

    async def get_db():
        """Get database connection from rag's storage."""
        if hasattr(rag, 'llm_response_cache') and hasattr(rag.llm_response_cache, 'db'):
            return rag.llm_response_cache.db
        elif hasattr(rag, 'text_chunks') and hasattr(rag.text_chunks, 'db'):
            return rag.text_chunks.db
        return None

    async def get_workspace():
        """Get current workspace from rag."""
        if hasattr(rag, 'llm_response_cache') and hasattr(rag.llm_response_cache, 'workspace'):
            return rag.llm_response_cache.workspace or "base"
        return "base"

    @router.get("", dependencies=[Depends(combined_auth)])
    async def get_all_templates() -> dict:
        """
        Get all user prompt templates for the current workspace.
        """
        try:
            db = await get_db()
            workspace = await get_workspace()

            templates = []

            if db is not None and db.pool is not None:
                try:
                    sql = """SELECT template_id, template_name, content, description, is_favorite,
                             TO_CHAR(create_time, 'YYYY-MM-DD HH24:MI:SS') as create_time,
                             TO_CHAR(update_time, 'YYYY-MM-DD HH24:MI:SS') as update_time
                             FROM LIGHTRAG_USER_PROMPT_TEMPLATES
                             WHERE workspace=$1
                             ORDER BY is_favorite DESC, update_time DESC"""
                    rows = await db.query(sql, [workspace], multirows=True)
                    if rows:
                        for row in rows:
                            templates.append(UserPromptTemplate(
                                template_id=row['template_id'],
                                template_name=row['template_name'],
                                content=row['content'],
                                description=row.get('description'),
                                is_favorite=row.get('is_favorite', False),
                                create_time=row.get('create_time'),
                                update_time=row.get('update_time')
                            ))
                except Exception as e:
                    logger.warning(f"Failed to fetch templates from database: {e}")

            return {
                "status": "success",
                "data": {
                    "templates": [t.model_dump() for t in templates],
                    "total": len(templates)
                }
            }
        except Exception as e:
            logger.error(f"Error getting templates: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/{template_id}", dependencies=[Depends(combined_auth)])
    async def get_template(template_id: str) -> dict:
        """
        Get a specific template by ID.
        """
        try:
            db = await get_db()
            workspace = await get_workspace()

            if db is None or db.pool is None:
                raise HTTPException(status_code=503, detail="Database not available")

            sql = """SELECT template_id, template_name, content, description, is_favorite,
                     TO_CHAR(create_time, 'YYYY-MM-DD HH24:MI:SS') as create_time,
                     TO_CHAR(update_time, 'YYYY-MM-DD HH24:MI:SS') as update_time
                     FROM LIGHTRAG_USER_PROMPT_TEMPLATES
                     WHERE workspace=$1 AND template_id=$2"""
            row = await db.query(sql, [workspace, template_id])

            if not row:
                raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

            template = UserPromptTemplate(
                template_id=row['template_id'],
                template_name=row['template_name'],
                content=row['content'],
                description=row.get('description'),
                is_favorite=row.get('is_favorite', False),
                create_time=row.get('create_time'),
                update_time=row.get('update_time')
            )

            return {
                "status": "success",
                "data": template.model_dump()
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting template: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("", dependencies=[Depends(combined_auth)])
    async def create_template(request: UserPromptTemplateCreateRequest) -> dict:
        """
        Create a new user prompt template.
        """
        try:
            db = await get_db()
            workspace = await get_workspace()

            if db is None or db.pool is None:
                raise HTTPException(status_code=503, detail="Database not available")

            # Generate unique template ID
            template_id = str(uuid.uuid4())[:8]

            sql = """INSERT INTO LIGHTRAG_USER_PROMPT_TEMPLATES
                     (workspace, template_id, template_name, content, description, is_favorite)
                     VALUES ($1, $2, $3, $4, $5, $6)"""
            async with db.pool.acquire() as conn:
                await conn.execute(
                    sql,
                    workspace,
                    template_id,
                    request.template_name,
                    request.content,
                    request.description,
                    request.is_favorite or False
                )

            return {
                "status": "success",
                "message": "Template created successfully",
                "data": {
                    "template_id": template_id,
                    "template_name": request.template_name,
                    "content": request.content,
                    "description": request.description,
                    "is_favorite": request.is_favorite or False
                }
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error creating template: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.put("/{template_id}", dependencies=[Depends(combined_auth)])
    async def update_template(template_id: str, request: UserPromptTemplateUpdateRequest) -> dict:
        """
        Update an existing template.
        """
        try:
            db = await get_db()
            workspace = await get_workspace()

            if db is None or db.pool is None:
                raise HTTPException(status_code=503, detail="Database not available")

            # Check if template exists
            check_sql = """SELECT template_id FROM LIGHTRAG_USER_PROMPT_TEMPLATES
                          WHERE workspace=$1 AND template_id=$2"""
            existing = await db.query(check_sql, [workspace, template_id])
            if not existing:
                raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

            # Build update query dynamically based on provided fields
            update_fields = []
            params = [workspace, template_id]
            param_idx = 3

            if request.template_name is not None:
                update_fields.append(f"template_name=${param_idx}")
                params.append(request.template_name)
                param_idx += 1

            if request.content is not None:
                update_fields.append(f"content=${param_idx}")
                params.append(request.content)
                param_idx += 1

            if request.description is not None:
                update_fields.append(f"description=${param_idx}")
                params.append(request.description)
                param_idx += 1

            if request.is_favorite is not None:
                update_fields.append(f"is_favorite=${param_idx}")
                params.append(request.is_favorite)
                param_idx += 1

            if not update_fields:
                raise HTTPException(status_code=400, detail="No fields to update")

            update_fields.append("update_time=CURRENT_TIMESTAMP")

            sql = f"""UPDATE LIGHTRAG_USER_PROMPT_TEMPLATES
                     SET {', '.join(update_fields)}
                     WHERE workspace=$1 AND template_id=$2"""

            async with db.pool.acquire() as conn:
                await conn.execute(sql, *params)

            return {
                "status": "success",
                "message": f"Template '{template_id}' updated successfully"
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating template: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/{template_id}", dependencies=[Depends(combined_auth)])
    async def delete_template(template_id: str) -> dict:
        """
        Delete a template.
        """
        try:
            db = await get_db()
            workspace = await get_workspace()

            if db is None or db.pool is None:
                raise HTTPException(status_code=503, detail="Database not available")

            # Check if template exists
            check_sql = """SELECT template_id FROM LIGHTRAG_USER_PROMPT_TEMPLATES
                          WHERE workspace=$1 AND template_id=$2"""
            existing = await db.query(check_sql, [workspace, template_id])
            if not existing:
                raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

            sql = """DELETE FROM LIGHTRAG_USER_PROMPT_TEMPLATES
                    WHERE workspace=$1 AND template_id=$2"""
            async with db.pool.acquire() as conn:
                await conn.execute(sql, workspace, template_id)

            return {
                "status": "success",
                "message": f"Template '{template_id}' deleted successfully"
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting template: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
