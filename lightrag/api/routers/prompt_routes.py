"""
This module contains all prompt-related routes for the LightRAG API.
Allows managing prompts stored in PostgreSQL for customization.
"""

import json
from typing import Optional, List, Any
from collections import OrderedDict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lightrag.utils import logger
from lightrag.prompt import PROMPTS
from ..utils_api import get_combined_auth_dependency

router = APIRouter(
    prefix="/prompts",
    tags=["prompts"],
)


class PromptResponse(BaseModel):
    prompt_key: str
    prompt_value: Any
    prompt_type: str = "text"
    description: Optional[str] = None
    is_active: bool = True
    is_default: bool = False


class PromptUpdateRequest(BaseModel):
    prompt_value: Any = Field(..., description="The prompt content (string or JSON array)")
    prompt_type: str = Field(default="text", description="Type of prompt: 'text' or 'json'")
    description: Optional[str] = Field(default=None, description="Description of the prompt")


class PromptResetRequest(BaseModel):
    prompt_key: str = Field(..., description="The prompt key to reset to default")


# Default prompt descriptions
PROMPT_DESCRIPTIONS = {
    "entity_extraction_system_prompt": "Entity extraction system prompt - defines how to extract entities and relations from text",
    "entity_extraction_user_prompt": "Entity extraction user prompt - task instructions for extraction",
    "entity_continue_extraction_user_prompt": "Continue extraction prompt for missed entities",
    "entity_extraction_examples": "Examples for entity extraction (JSON array)",
    "summarize_entity_descriptions": "Template for summarizing entity descriptions",
    "fail_response": "Response message when unable to answer",
    "rag_response": "Main RAG response template with knowledge graph context",
    "naive_rag_response": "Simple RAG response template without knowledge graph",
    "kg_query_context": "Knowledge graph query context template",
    "naive_query_context": "Simple query context template",
    "keywords_extraction": "Keyword extraction prompt for query analysis",
    "keywords_extraction_examples": "Examples for keyword extraction (JSON array)",
}

# Editable prompt keys (excluding delimiters)
EDITABLE_PROMPTS = [
    "entity_extraction_system_prompt",
    "entity_extraction_user_prompt",
    "entity_continue_extraction_user_prompt",
    "entity_extraction_examples",
    "summarize_entity_descriptions",
    "fail_response",
    "rag_response",
    "naive_rag_response",
    "kg_query_context",
    "naive_query_context",
    "keywords_extraction",
    "keywords_extraction_examples",
]


def create_prompt_routes(rag, api_key: Optional[str] = None):
    """Create prompt management routes."""
    combined_auth = get_combined_auth_dependency(api_key)

    async def get_db():
        """Get database connection from rag's storage."""
        # Try to get db from kv_storage (PGKVStorage)
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
    async def get_all_prompts() -> dict:
        """
        Get all available prompts with their current values.
        Returns both database-stored prompts and defaults.
        """
        try:
            db = await get_db()
            workspace = await get_workspace()

            result = []
            db_prompts = {}

            # Fetch prompts from database if available
            if db is not None and db.pool is not None:
                try:
                    sql = """SELECT prompt_key, prompt_value, prompt_type, description, is_active
                             FROM LIGHTRAG_PROMPTS WHERE workspace=$1"""
                    rows = await db.query(sql, [workspace], multirows=True)
                    if rows:
                        for row in rows:
                            db_prompts[row['prompt_key']] = row
                except Exception as e:
                    logger.warning(f"Failed to fetch prompts from database: {e}")

            # Build response with all editable prompts
            for key in EDITABLE_PROMPTS:
                if key in db_prompts:
                    # Use database value
                    row = db_prompts[key]
                    value = row['prompt_value']
                    if row['prompt_type'] == 'json':
                        try:
                            value = json.loads(value)
                        except json.JSONDecodeError:
                            pass
                    result.append(PromptResponse(
                        prompt_key=key,
                        prompt_value=value,
                        prompt_type=row['prompt_type'],
                        description=row['description'] or PROMPT_DESCRIPTIONS.get(key, ""),
                        is_active=row['is_active'],
                        is_default=False
                    ))
                else:
                    # Use default value from PROMPTS
                    default_value = PROMPTS.get(key, "")
                    prompt_type = "json" if isinstance(default_value, list) else "text"
                    result.append(PromptResponse(
                        prompt_key=key,
                        prompt_value=default_value,
                        prompt_type=prompt_type,
                        description=PROMPT_DESCRIPTIONS.get(key, ""),
                        is_active=True,
                        is_default=True
                    ))

            return {
                "status": "success",
                "data": {
                    "prompts": [p.model_dump() for p in result],
                    "total": len(result)
                }
            }
        except Exception as e:
            logger.error(f"Error getting prompts: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/{prompt_key}", dependencies=[Depends(combined_auth)])
    async def get_prompt(prompt_key: str) -> dict:
        """
        Get a specific prompt by key.
        """
        if prompt_key not in EDITABLE_PROMPTS:
            raise HTTPException(status_code=404, detail=f"Prompt '{prompt_key}' not found or not editable")

        try:
            db = await get_db()
            workspace = await get_workspace()

            # Try to fetch from database
            if db is not None and db.pool is not None:
                try:
                    sql = """SELECT prompt_key, prompt_value, prompt_type, description, is_active
                             FROM LIGHTRAG_PROMPTS WHERE workspace=$1 AND prompt_key=$2"""
                    row = await db.query(sql, [workspace, prompt_key])
                    if row:
                        value = row['prompt_value']
                        if row['prompt_type'] == 'json':
                            try:
                                value = json.loads(value)
                            except json.JSONDecodeError:
                                pass
                        return {
                            "status": "success",
                            "data": PromptResponse(
                                prompt_key=prompt_key,
                                prompt_value=value,
                                prompt_type=row['prompt_type'],
                                description=row['description'] or PROMPT_DESCRIPTIONS.get(prompt_key, ""),
                                is_active=row['is_active'],
                                is_default=False
                            ).model_dump()
                        }
                except Exception as e:
                    logger.warning(f"Failed to fetch prompt from database: {e}")

            # Return default
            default_value = PROMPTS.get(prompt_key, "")
            prompt_type = "json" if isinstance(default_value, list) else "text"
            return {
                "status": "success",
                "data": PromptResponse(
                    prompt_key=prompt_key,
                    prompt_value=default_value,
                    prompt_type=prompt_type,
                    description=PROMPT_DESCRIPTIONS.get(prompt_key, ""),
                    is_active=True,
                    is_default=True
                ).model_dump()
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting prompt: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.put("/{prompt_key}", dependencies=[Depends(combined_auth)])
    async def update_prompt(prompt_key: str, request: PromptUpdateRequest) -> dict:
        """
        Update a specific prompt.
        """
        if prompt_key not in EDITABLE_PROMPTS:
            raise HTTPException(status_code=404, detail=f"Prompt '{prompt_key}' not found or not editable")

        try:
            db = await get_db()
            workspace = await get_workspace()

            if db is None or db.pool is None:
                raise HTTPException(status_code=503, detail="Database not available")

            # Prepare value for storage
            value = request.prompt_value
            if request.prompt_type == 'json':
                if isinstance(value, (list, dict)):
                    value = json.dumps(value, ensure_ascii=False)
                elif not isinstance(value, str):
                    value = json.dumps(value, ensure_ascii=False)
            else:
                value = str(value)

            description = request.description or PROMPT_DESCRIPTIONS.get(prompt_key, "")

            # Upsert prompt using pool directly
            sql = """INSERT INTO LIGHTRAG_PROMPTS (workspace, prompt_key, prompt_value, prompt_type, description, is_active)
                     VALUES ($1, $2, $3, $4, $5, TRUE)
                     ON CONFLICT (workspace, prompt_key) DO UPDATE
                     SET prompt_value = EXCLUDED.prompt_value,
                         prompt_type = EXCLUDED.prompt_type,
                         description = EXCLUDED.description,
                         is_active = TRUE,
                         update_time = CURRENT_TIMESTAMP"""
            async with db.pool.acquire() as conn:
                await conn.execute(sql, workspace, prompt_key, value, request.prompt_type, description)

            # Return updated value
            return_value = request.prompt_value
            if request.prompt_type == 'json' and isinstance(request.prompt_value, str):
                try:
                    return_value = json.loads(request.prompt_value)
                except json.JSONDecodeError:
                    pass

            return {
                "status": "success",
                "message": f"Prompt '{prompt_key}' updated successfully",
                "data": PromptResponse(
                    prompt_key=prompt_key,
                    prompt_value=return_value,
                    prompt_type=request.prompt_type,
                    description=description,
                    is_active=True,
                    is_default=False
                ).model_dump()
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating prompt: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/{prompt_key}", dependencies=[Depends(combined_auth)])
    async def reset_prompt(prompt_key: str) -> dict:
        """
        Reset a prompt to its default value by deleting from database.
        """
        if prompt_key not in EDITABLE_PROMPTS:
            raise HTTPException(status_code=404, detail=f"Prompt '{prompt_key}' not found or not editable")

        try:
            db = await get_db()
            workspace = await get_workspace()

            if db is not None and db.pool is not None:
                sql = """DELETE FROM LIGHTRAG_PROMPTS WHERE workspace=$1 AND prompt_key=$2"""
                async with db.pool.acquire() as conn:
                    await conn.execute(sql, workspace, prompt_key)

            # Return default value
            default_value = PROMPTS.get(prompt_key, "")
            prompt_type = "json" if isinstance(default_value, list) else "text"

            return {
                "status": "success",
                "message": f"Prompt '{prompt_key}' reset to default",
                "data": PromptResponse(
                    prompt_key=prompt_key,
                    prompt_value=default_value,
                    prompt_type=prompt_type,
                    description=PROMPT_DESCRIPTIONS.get(prompt_key, ""),
                    is_active=True,
                    is_default=True
                ).model_dump()
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error resetting prompt: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/reset-all", dependencies=[Depends(combined_auth)])
    async def reset_all_prompts() -> dict:
        """
        Reset all prompts to their default values.
        """
        try:
            db = await get_db()
            workspace = await get_workspace()

            if db is not None and db.pool is not None:
                sql = """DELETE FROM LIGHTRAG_PROMPTS WHERE workspace=$1"""
                async with db.pool.acquire() as conn:
                    await conn.execute(sql, workspace)

            return {
                "status": "success",
                "message": "All prompts reset to defaults"
            }
        except Exception as e:
            logger.error(f"Error resetting all prompts: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
