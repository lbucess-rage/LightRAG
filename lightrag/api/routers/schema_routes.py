"""
Schema Management API Routes

지식 그래프 스키마 관리를 위한 API 엔드포인트입니다.
"""

import asyncio
from io import BytesIO
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from pydantic import BaseModel, Field

from lightrag.api.utils_api import decode_workspace_header
from lightrag.schema import (
    DomainSchema,
    SchemaDiscoveryResult,
    SchemaTemplateManager,
)
from lightrag.schema.discovery import SchemaDiscoveryEngine
from lightrag.utils import logger
from lightrag.kg.shared_storage import get_default_workspace

router = APIRouter(tags=["Schema"])

# 전역 템플릿 매니저 (서버 시작 시 초기화됨)
_template_manager: Optional[SchemaTemplateManager] = None
_discovery_engine: Optional[SchemaDiscoveryEngine] = None
_rag_instance: Optional[Any] = None
_default_entity_types: Optional[list[str]] = None
_schema_storage: Optional[Any] = None  # WorkspaceSchemaStorage instance


async def _init_schema_storage():
    """Initialize WorkspaceSchemaStorage from RAG's database connection."""
    global _schema_storage
    if _schema_storage is not None:
        return _schema_storage

    if _rag_instance is None:
        return None

    try:
        # Get database connection from RAG instance
        # RAG uses doc_status storage which has PostgresDB instance
        if hasattr(_rag_instance, "doc_status") and _rag_instance.doc_status:
            db = getattr(_rag_instance.doc_status, "db", None)
            if db:
                from lightrag.kg.postgres_impl import WorkspaceSchemaStorage
                _schema_storage = WorkspaceSchemaStorage(db)
                logger.info("WorkspaceSchemaStorage initialized")
                return _schema_storage
    except Exception as e:
        logger.warning(f"Failed to initialize WorkspaceSchemaStorage: {e}")

    return None


async def _get_schema_storage():
    """Get or initialize schema storage."""
    global _schema_storage
    if _schema_storage is None:
        await _init_schema_storage()
    return _schema_storage


_get_rag_for_workspace = None


def set_rag_instance(rag: Any):
    """RAG 인스턴스 설정 (서버 초기화 시 호출)"""
    global _rag_instance, _default_entity_types, _schema_storage
    _rag_instance = rag
    _schema_storage = None  # Reset storage to reinitialize with new RAG
    # 초기 entity_types를 기본값으로 저장
    if rag and hasattr(rag, "addon_params"):
        _default_entity_types = list(rag.addon_params.get("entity_types", []))


def set_rag_workspace_getter(getter_func):
    """Set the function to get RAG instance by workspace."""
    global _get_rag_for_workspace
    _get_rag_for_workspace = getter_func


def get_rag_instance() -> Optional[Any]:
    """RAG 인스턴스 반환"""
    return _rag_instance


async def _get_workspace_rag(workspace: str):
    """Get workspace-specific RAG instance, fall back to default."""
    if _get_rag_for_workspace is not None:
        rag = await _get_rag_for_workspace(workspace)
        if rag is not None:
            return rag
    return _rag_instance


_schema_addon_loaded: set[str] = set()


async def ensure_workspace_schema_loaded(workspace: str, rag: Any):
    """Ensure workspace schema (entity_types, seed_entities) is loaded into RAG addon_params.

    Called when a RAG instance is accessed for a workspace, so that
    entity extraction uses the correct schema without requiring a prior
    GET /current API call.
    """
    global _schema_addon_loaded

    if rag is None or not hasattr(rag, "addon_params"):
        return

    # Already loaded into this workspace's addon_params
    if workspace in _schema_addon_loaded:
        return

    try:
        schema_meta = await _get_workspace_schema_meta(workspace)
        if schema_meta.get("entity_types") is not None:
            rag.addon_params["entity_types"] = list(schema_meta["entity_types"])
        if schema_meta.get("entity_type_details"):
            rag.addon_params["entity_type_details"] = schema_meta["entity_type_details"]
        if schema_meta.get("seed_entities"):
            rag.addon_params["seed_entities"] = schema_meta["seed_entities"]
        _schema_addon_loaded.add(workspace)
        logger.info(
            f"Auto-loaded schema for workspace '{workspace}': "
            f"{len(schema_meta.get('entity_types') or [])} entity types, "
            f"{len(schema_meta.get('seed_entities') or [])} seed entities"
        )
    except Exception as e:
        logger.warning(f"Failed to auto-load schema for workspace '{workspace}': {e}")


def get_default_entity_types() -> list[str]:
    """기본 entity_types 반환"""
    global _default_entity_types
    if _default_entity_types is None:
        from lightrag.constants import DEFAULT_ENTITY_TYPES
        return list(DEFAULT_ENTITY_TYPES)
    return _default_entity_types


def get_template_manager() -> SchemaTemplateManager:
    """템플릿 매니저 인스턴스 반환"""
    global _template_manager
    if _template_manager is None:
        _template_manager = SchemaTemplateManager()
    return _template_manager


def set_discovery_engine(engine: SchemaDiscoveryEngine):
    """Discovery 엔진 설정 (서버 초기화 시 호출)"""
    global _discovery_engine
    _discovery_engine = engine


def get_discovery_engine() -> Optional[SchemaDiscoveryEngine]:
    """Discovery 엔진 반환"""
    return _discovery_engine


async def _get_workspace_discovery_engine(
    request: Request,
) -> Optional[SchemaDiscoveryEngine]:
    """Create a request-scoped discovery engine using the workspace LLM policy."""
    workspace = _get_workspace_from_request(request)
    workspace_rag = await _get_workspace_rag(workspace)
    llm_func = getattr(workspace_rag, "llm_model_func", None)
    if llm_func is None:
        return get_discovery_engine()

    async def workspace_schema_llm(
        prompt: str, system_prompt: Optional[str] = None
    ) -> str:
        return await llm_func(
            prompt,
            system_prompt=system_prompt,
            _llm_purpose="schema_design",
        )

    return SchemaDiscoveryEngine(llm_func=workspace_schema_llm)


# =============================================================================
# Request/Response Models
# =============================================================================


class DocumentInput(BaseModel):
    """문서 입력"""

    content: str = Field(..., description="문서 내용")
    file_path: Optional[str] = Field(None, description="파일 경로")


class DiscoverFromDocumentRequest(BaseModel):
    """문서 기반 스키마 발견 요청"""

    documents: list[DocumentInput] = Field(..., description="분석할 문서 목록")
    options: Optional[dict[str, Any]] = Field(
        None,
        description="옵션: sample_size, max_entity_types, max_relation_types, language, domain_hints, include_common_types",
    )
    include_common_types: bool = Field(
        default=True,
        description="컨택센터 공통 엔티티/관계 타입 포함 여부"
    )


class DiscoverFromDomainRequest(BaseModel):
    """도메인 기반 스키마 추천 요청"""

    domains: list[str] = Field(..., description="도메인 식별자 목록")
    options: Optional[dict[str, Any]] = Field(
        None,
        description="옵션: merge_strategy, max_entity_types, max_relation_types, language, include_common_types",
    )
    include_common_types: bool = Field(
        default=True,
        description="컨택센터 공통 엔티티/관계 타입 포함 여부"
    )


class HybridDiscoverRequest(BaseModel):
    """하이브리드 스키마 발견 요청"""

    documents: list[DocumentInput] = Field(..., description="분석할 문서 목록")
    domain_hints: list[str] = Field(..., description="도메인 힌트 목록")
    options: Optional[dict[str, Any]] = Field(
        None,
        description="옵션: template_weight, discovery_weight",
    )


class EntityTypeInput(BaseModel):
    """엔티티 타입 입력"""

    name: str = Field(..., description="타입 이름 (PascalCase)")
    display_name: str = Field(..., description="표시 이름")
    description: str = Field("", description="설명")
    examples: list[str] = Field(default_factory=list, description="예시")
    color: Optional[str] = Field(None, description="색상 (hex)")
    icon: Optional[str] = Field(None, description="아이콘 이름")


class RelationTypeInput(BaseModel):
    """관계 타입 입력"""

    name: str = Field(..., description="관계 이름 (UPPER_SNAKE_CASE)")
    display_name: str = Field(..., description="표시 이름")
    description: str = Field("", description="설명")
    source_types: list[str] = Field(..., description="소스 엔티티 타입 목록")
    target_types: list[str] = Field(..., description="타겟 엔티티 타입 목록")


class CreateTemplateRequest(BaseModel):
    """템플릿 생성 요청"""

    domain: str = Field(..., description="도메인 식별자 (snake_case)")
    display_name: str = Field(..., description="표시 이름")
    description: str = Field("", description="설명")
    entity_types: list[EntityTypeInput] = Field(..., description="엔티티 타입 목록")
    relation_types: list[RelationTypeInput] = Field(..., description="관계 타입 목록")
    tags: list[str] = Field(default_factory=list, description="태그")


class MergeTemplatesRequest(BaseModel):
    """템플릿 병합 요청"""

    domains: list[str] = Field(..., description="병합할 도메인 목록")
    new_domain: Optional[str] = Field(None, description="새 도메인 이름")
    options: Optional[dict[str, Any]] = Field(
        None,
        description="옵션: merge_strategy, save_as_template",
    )


class ApplySchemaRequest(BaseModel):
    """스키마 적용 요청"""

    source: str = Field(..., description="소스 타입: template 또는 custom")
    domain: Optional[str] = Field(None, description="템플릿 도메인 (source=template)")
    entity_types: Optional[list[str]] = Field(
        None, description="엔티티 타입 목록 (source=custom)"
    )


class ApiResponse(BaseModel):
    """API 응답"""

    success: bool
    data: Optional[Any] = None
    error: Optional[dict[str, Any]] = None


# =============================================================================
# File Extraction Utilities
# =============================================================================


def _extract_pdf_pypdf(file_bytes: bytes, filename: str = "unknown", password: str = None) -> str:
    """Extract PDF content using PyMuPDF for better quality (synchronous).

    Uses PyMuPDF (fitz) for layout-aware text extraction.

    Args:
        file_bytes: PDF file content as bytes
        filename: Original filename for logging
        password: Optional password for encrypted PDFs

    Returns:
        str: Extracted text content
    """
    import fitz  # PyMuPDF

    doc = fitz.open(stream=file_bytes, filetype="pdf")

    # Handle encrypted PDFs
    if doc.is_encrypted:
        if password is None:
            doc.close()
            raise Exception("PDF is encrypted but no password provided")
        if not doc.authenticate(password):
            doc.close()
            raise Exception("Incorrect PDF password")

    content_parts = []
    page_count = doc.page_count
    extracted_pages = 0

    for i, page in enumerate(doc):
        try:
            text = page.get_text("text", sort=True)
            if text and text.strip():
                content_parts.append(text)
                extracted_pages += 1
        except Exception as e:
            logger.warning(f"Failed to extract text from page {i+1} of {filename}: {e}")

    doc.close()

    content = "\n".join(content_parts)

    logger.info(f"PDF extraction (PyMuPDF): {filename} - {extracted_pages}/{page_count} pages, {len(content)} chars")

    if not content.strip():
        logger.warning(f"No text extracted from PDF: {filename}. This may be a scanned/image-based PDF.")

    return content


def _extract_docx(file_bytes: bytes) -> str:
    """Extract DOCX content (synchronous)."""
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = Document(BytesIO(file_bytes))
    content_parts = []

    for element in doc.element.body:
        if element.tag.endswith("p"):
            for paragraph in doc.paragraphs:
                if paragraph._element == element:
                    text = paragraph.text
                    if text.strip():
                        content_parts.append(text)
                    break
        elif element.tag.endswith("tbl"):
            for table in doc.tables:
                if table._element == element:
                    for row in table.rows:
                        row_text = [cell.text.strip() for cell in row.cells]
                        if any(cell for cell in row_text):
                            content_parts.append("\t".join(row_text))
                    break

    return "\n".join(content_parts)


SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx", ".json", ".xml", ".yaml", ".yml", ".csv", ".html", ".htm"}


async def extract_file_content(file: UploadFile) -> str:
    """Extract text content from uploaded file.

    Args:
        file: Uploaded file

    Returns:
        str: Extracted text content

    Raises:
        HTTPException: If file type is not supported or extraction fails
    """
    filename = file.filename or "unknown"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    file_bytes = await file.read()

    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"Empty file: {filename}")

    try:
        if ext == ".pdf":
            content = await asyncio.to_thread(_extract_pdf_pypdf, file_bytes, filename)
        elif ext == ".docx":
            content = await asyncio.to_thread(_extract_docx, file_bytes)
        else:
            # Text-based files
            content = file_bytes.decode("utf-8")

        if not content or not content.strip():
            if ext == ".pdf":
                raise HTTPException(
                    status_code=400,
                    detail=f"No text extracted from '{filename}'. This PDF may be scanned/image-based and requires OCR processing."
                )
            raise HTTPException(status_code=400, detail=f"No text content extracted from: {filename}")

        return content

    except HTTPException:
        raise
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"File encoding error ({filename}): {str(e)}")
    except Exception as e:
        logger.error(f"File extraction failed for {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract content from {filename}: {str(e)}")


# =============================================================================
# Discovery Endpoints
# =============================================================================


@router.post("/discover/from-files", response_model=ApiResponse)
async def discover_from_files(
    http_request: Request,
    files: list[UploadFile] = File(..., description="Files to analyze (PDF, DOCX, TXT, MD, etc.)"),
    max_entity_types: int = Form(default=30, description="Maximum entity types to generate"),
    max_relation_types: int = Form(default=25, description="Maximum relation types to generate"),
    domain_hints: Optional[str] = Form(default=None, description="Domain hints (comma-separated)"),
    language: str = Form(default="Korean", description="Output language"),
    include_common_types: bool = Form(default=True, description="Include common contact center types"),
):
    """파일 업로드 기반 스키마 발견

    PDF, DOCX, TXT 등의 파일을 업로드하여 스키마를 발견합니다.
    """
    engine = await _get_workspace_discovery_engine(http_request)
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail="Schema discovery engine not initialized. LLM configuration required.",
        )

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    try:
        # Extract content from all files
        documents = []
        for file in files:
            content = await extract_file_content(file)
            documents.append(content)
            logger.info(f"Extracted {len(content)} chars from {file.filename}")

        if not documents:
            raise HTTPException(status_code=400, detail="No content extracted from files")

        # Build options
        options = {
            "max_entity_types": max_entity_types,
            "max_relation_types": max_relation_types,
            "language": language,
            "include_common_types": include_common_types,
        }
        if domain_hints:
            options["domain_hints"] = domain_hints

        # Discover schema
        result = await engine.discover_from_documents(
            documents=documents,
            options=options,
        )

        return ApiResponse(success=True, data=result.to_dict())

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Schema discovery parse error (from-files): {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Schema discovery runtime error (from-files): {e}")
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Schema discovery from files failed: {e}")
        raise HTTPException(status_code=500, detail=f"Discovery failed: {str(e)}")


@router.post("/discover/from-document", response_model=ApiResponse)
async def discover_from_document(
    request: DiscoverFromDocumentRequest, http_request: Request
):
    """문서 기반 스키마 발견

    업로드된 문서를 분석하여 도메인에 적합한 엔티티/관계 타입을 발견합니다.
    """
    engine = await _get_workspace_discovery_engine(http_request)
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail="Schema discovery engine not initialized. LLM configuration required.",
        )

    try:
        # 문서 내용 추출
        documents = [doc.content for doc in request.documents]

        if not documents:
            raise HTTPException(status_code=400, detail="No documents provided")

        # Build options with include_common_types
        options = request.options or {}
        options["include_common_types"] = request.include_common_types

        # 스키마 발견
        result = await engine.discover_from_documents(
            documents=documents,
            options=options,
        )

        return ApiResponse(success=True, data=result.to_dict())

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Schema discovery parse error (from-document): {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Schema discovery runtime error (from-document): {e}")
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Schema discovery failed: {e}")
        raise HTTPException(status_code=500, detail=f"Discovery failed: {str(e)}")


@router.post("/discover/from-domain", response_model=ApiResponse)
async def discover_from_domain(
    request: DiscoverFromDomainRequest, http_request: Request
):
    """도메인 키워드 기반 스키마 생성

    LLM을 사용하여 도메인 키워드를 분석하고 적합한 스키마를 생성합니다.
    """
    engine = await _get_workspace_discovery_engine(http_request)
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail="Schema discovery engine not initialized",
        )

    try:
        if not request.domains:
            raise HTTPException(status_code=400, detail="No domain keywords provided")

        # LLM 기반 스키마 생성
        options = request.options or {}
        result = await engine.discover_from_domain(
            domains=request.domains,
            options={
                "max_entity_types": options.get("max_entity_types", 15),
                "max_relation_types": options.get("max_relation_types", 12),
                "language": options.get("language", "Korean"),
                "use_templates": options.get("use_templates", True),
                "include_common_types": request.include_common_types,
            },
        )

        return ApiResponse(success=True, data=result.to_dict())

    except ValueError as e:
        logger.warning(f"Domain discovery validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Domain discovery runtime error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Domain discovery failed: {e}")
        raise HTTPException(status_code=500, detail=f"Discovery failed: {str(e)}")


@router.post("/discover/hybrid", response_model=ApiResponse)
async def discover_hybrid(request: HybridDiscoverRequest, http_request: Request):
    """하이브리드 스키마 발견

    문서 분석과 도메인 템플릿을 결합하여 스키마를 발견합니다.
    """
    engine = await _get_workspace_discovery_engine(http_request)
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail="Schema discovery engine not initialized",
        )

    try:
        documents = [doc.content for doc in request.documents]

        result = await engine.discover_hybrid(
            documents=documents,
            domain_hints=request.domain_hints,
            options=request.options,
        )

        return ApiResponse(success=True, data=result.to_dict())

    except Exception as e:
        logger.error(f"Hybrid discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Template Endpoints
# =============================================================================


@router.get("/templates", response_model=ApiResponse)
async def list_templates(
    tags: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """템플릿 목록 조회

    등록된 도메인 스키마 템플릿 목록을 반환합니다.
    """
    manager = get_template_manager()

    try:
        tag_list = tags.split(",") if tags else None
        templates, total = await manager.list_templates(
            tags=tag_list,
            limit=limit,
            offset=offset,
        )

        return ApiResponse(
            success=True,
            data={
                "templates": [
                    {
                        "domain": t.domain,
                        "display_name": t.display_name,
                        "description": t.description,
                        "entity_count": len(t.entity_types),
                        "relation_count": len(t.relation_types),
                        "tags": t.tags,
                        "version": t.version,
                    }
                    for t in templates
                ],
                "total": total,
                "limit": limit,
                "offset": offset,
            },
        )

    except Exception as e:
        logger.error(f"Failed to list templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{domain}", response_model=ApiResponse)
async def get_template(domain: str):
    """템플릿 상세 조회

    특정 도메인의 스키마 템플릿을 반환합니다.
    """
    manager = get_template_manager()

    try:
        template = await manager.get_template(domain)
        if template is None:
            raise HTTPException(
                status_code=404,
                detail=f"Template not found: {domain}",
            )

        return ApiResponse(success=True, data=template.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates", response_model=ApiResponse)
async def create_template(request: CreateTemplateRequest):
    """템플릿 생성

    새로운 도메인 스키마 템플릿을 생성합니다.
    """
    manager = get_template_manager()

    try:
        # 기존 템플릿 확인
        existing = await manager.get_template(request.domain)
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Template already exists: {request.domain}",
            )

        # EntityType/RelationType 객체 생성
        from lightrag.schema import EntityType, RelationType

        entity_types = [
            EntityType(
                name=et.name,
                display_name=et.display_name,
                description=et.description,
                examples=et.examples,
                color=et.color,
                icon=et.icon,
            )
            for et in request.entity_types
        ]

        relation_types = [
            RelationType(
                name=rt.name,
                display_name=rt.display_name,
                description=rt.description,
                source_types=rt.source_types,
                target_types=rt.target_types,
            )
            for rt in request.relation_types
        ]

        schema = DomainSchema(
            domain=request.domain,
            display_name=request.display_name,
            description=request.description,
            entity_types=entity_types,
            relation_types=relation_types,
            tags=request.tags,
        )

        # 유효성 검증
        errors = schema.validate()
        if errors:
            raise HTTPException(
                status_code=400,
                detail={"message": "Schema validation failed", "errors": errors},
            )

        # 저장
        success = await manager.save_template(schema)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save template")

        return ApiResponse(success=True, data=schema.to_dict())

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/templates/{domain}", response_model=ApiResponse)
async def update_template(domain: str, request: CreateTemplateRequest):
    """템플릿 수정

    기존 도메인 스키마 템플릿을 수정합니다.
    """
    manager = get_template_manager()

    try:
        # 기존 템플릿 확인
        existing = await manager.get_template(domain)
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail=f"Template not found: {domain}",
            )

        from lightrag.schema import EntityType, RelationType

        entity_types = [
            EntityType(
                name=et.name,
                display_name=et.display_name,
                description=et.description,
                examples=et.examples,
                color=et.color,
                icon=et.icon,
            )
            for et in request.entity_types
        ]

        relation_types = [
            RelationType(
                name=rt.name,
                display_name=rt.display_name,
                description=rt.description,
                source_types=rt.source_types,
                target_types=rt.target_types,
            )
            for rt in request.relation_types
        ]

        schema = DomainSchema(
            domain=domain,
            display_name=request.display_name,
            description=request.description,
            entity_types=entity_types,
            relation_types=relation_types,
            tags=request.tags,
            created_at=existing.created_at,
        )

        errors = schema.validate()
        if errors:
            raise HTTPException(
                status_code=400,
                detail={"message": "Schema validation failed", "errors": errors},
            )

        success = await manager.save_template(schema, overwrite=True)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update template")

        return ApiResponse(success=True, data=schema.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/templates/{domain}", response_model=ApiResponse)
async def delete_template(domain: str):
    """템플릿 삭제

    도메인 스키마 템플릿을 삭제합니다.
    """
    manager = get_template_manager()

    try:
        success = await manager.delete_template(domain)
        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Template not found: {domain}",
            )

        return ApiResponse(success=True, data={"deleted": domain})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/merge", response_model=ApiResponse)
async def merge_templates(request: MergeTemplatesRequest):
    """템플릿 병합

    여러 도메인 템플릿을 하나로 병합합니다.
    """
    manager = get_template_manager()

    try:
        if len(request.domains) < 2:
            raise HTTPException(
                status_code=400,
                detail="At least 2 domains required for merge",
            )

        merged = await manager.merge_schemas(
            request.domains,
            merge_strategy=request.options.get("merge_strategy", "union")
            if request.options
            else "union",
        )

        if merged is None:
            raise HTTPException(
                status_code=404,
                detail=f"No templates found for domains: {request.domains}",
            )

        # 새 템플릿으로 저장 (옵션)
        save_as_template = (
            request.options.get("save_as_template", False)
            if request.options
            else False
        )
        if save_as_template and request.new_domain:
            merged.domain = request.new_domain
            await manager.save_template(merged)

        return ApiResponse(success=True, data=merged.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to merge templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Analysis Endpoints
# =============================================================================


@router.post("/analyze/validate", response_model=ApiResponse)
async def validate_schema(request: CreateTemplateRequest):
    """스키마 유효성 검증

    스키마의 유효성을 검증합니다.
    """
    try:
        from lightrag.schema import EntityType, RelationType

        entity_types = [
            EntityType(
                name=et.name,
                display_name=et.display_name,
                description=et.description,
                examples=et.examples,
            )
            for et in request.entity_types
        ]

        relation_types = [
            RelationType(
                name=rt.name,
                display_name=rt.display_name,
                description=rt.description,
                source_types=rt.source_types,
                target_types=rt.target_types,
            )
            for rt in request.relation_types
        ]

        schema = DomainSchema(
            domain=request.domain,
            display_name=request.display_name,
            description=request.description,
            entity_types=entity_types,
            relation_types=relation_types,
        )

        errors = schema.validate()

        return ApiResponse(
            success=True,
            data={
                "valid": len(errors) == 0,
                "errors": errors,
                "entity_count": len(entity_types),
                "relation_count": len(relation_types),
            },
        )

    except ValueError as e:
        return ApiResponse(
            success=True,
            data={
                "valid": False,
                "errors": [str(e)],
            },
        )
    except Exception as e:
        logger.error(f"Validation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Schema Application API (스키마 적용)
# =============================================================================


class SeedEntityItem(BaseModel):
    """시드 엔티티 항목"""

    keyword: str = Field(..., description="주요 키워드")
    variants: list[str] = Field(default_factory=list, description="변형 표현 목록")
    entity_type: str = Field(..., description="엔티티 타입")
    description: Optional[str] = Field(None, description="LLM을 위한 컨텍스트 설명")


class SeedEntitiesRequest(BaseModel):
    """시드 엔티티 저장 요청"""

    seed_entities: list[SeedEntityItem]


class ApplySchemaRequest(BaseModel):
    """스키마 적용 요청"""

    entity_types: list[str] = Field(..., description="적용할 엔티티 타입 목록")
    relation_types: Optional[list[dict]] = Field(None, description="적용할 관계 타입 목록 (name, source_types, target_types 등)")
    source: Optional[str] = Field(None, description="스키마 출처 (template:name, discovery, custom)")
    entity_type_details: Optional[list[dict]] = Field(
        None, description="엔티티 타입 상세정보 (description, examples, extraction_hints)"
    )
    seed_entities: Optional[list[dict]] = Field(
        None, description="시드 엔티티 목록 (keyword, variants, entity_type, description)"
    )


class MergePreviewRequest(BaseModel):
    """스키마 병합 미리보기 요청"""

    new_entity_types: list[str] = Field(..., description="병합할 새 엔티티 타입 목록")
    source: Optional[str] = Field(None, description="새 스키마 출처")


class MergePreviewResponse(BaseModel):
    """스키마 병합 미리보기 응답"""

    current_types: list[str] = Field(..., description="현재 엔티티 타입")
    new_types: list[str] = Field(..., description="추가할 새 엔티티 타입")
    duplicates: list[str] = Field(..., description="중복된 엔티티 타입 (이미 존재)")
    merged_result: list[str] = Field(..., description="병합 후 최종 엔티티 타입")
    current_count: int = Field(..., description="현재 타입 수")
    new_count: int = Field(..., description="새로 추가될 타입 수")
    duplicate_count: int = Field(..., description="중복 타입 수")
    merged_count: int = Field(..., description="병합 후 총 타입 수")


class MergeApplyRequest(BaseModel):
    """스키마 병합 적용 요청"""

    new_entity_types: list[str] = Field(..., description="병합할 새 엔티티 타입 목록")
    source: Optional[str] = Field(None, description="새 스키마 출처")
    exclude_duplicates: bool = Field(True, description="중복 항목 제외 여부")
    confirmed: bool = Field(False, description="사용자 확인 여부 (True여야 적용)")


class CurrentSchemaResponse(BaseModel):
    """현재 스키마 응답"""

    entity_types: list[str] = Field(..., description="현재 적용된 엔티티 타입 목록")
    source: Optional[str] = Field(None, description="스키마 출처")
    applied_at: Optional[str] = Field(None, description="적용 시간")


# 현재 적용된 스키마 메타데이터 캐시 (워크스페이스별, DB와 동기화)
# key: workspace_id, value: {"source": str, "applied_at": str, "entity_types": list, "relation_types": list}
_workspace_schema_cache: dict[str, dict[str, Any]] = {}
_schema_cache_loaded: set[str] = set()  # 이미 DB에서 로드한 워크스페이스 추적


def _get_workspace_from_request(request: Request) -> str:
    """Request 헤더에서 워크스페이스 ID 추출"""
    workspace = decode_workspace_header(request.headers.get("LIGHTRAG-WORKSPACE", ""))
    if workspace:
        return workspace
    # 서버 기본 워크스페이스 사용 (보통 "base")
    return get_default_workspace() or "base"


async def _load_workspace_schema_from_db(workspace: str) -> dict[str, Any] | None:
    """DB에서 워크스페이스 스키마 로드"""
    storage = await _get_schema_storage()
    if storage:
        return await storage.load_schema(workspace)
    return None


async def _save_workspace_schema_to_db(
    workspace: str,
    entity_types: list[str],
    relation_types: list[dict] | None = None,
    source: str | None = None,
    applied_at: str | None = None,
    entity_type_details: list[dict] | None = None,
    seed_entities: list[dict] | None = None,
) -> bool:
    """DB에 워크스페이스 스키마 저장"""
    storage = await _get_schema_storage()
    if storage:
        return await storage.save_schema(
            workspace=workspace,
            entity_types=entity_types,
            relation_types=relation_types,
            source=source,
            applied_at=applied_at,
            entity_type_details=entity_type_details,
            seed_entities=seed_entities,
        )
    return False


async def _delete_workspace_schema_from_db(workspace: str) -> bool:
    """DB에서 워크스페이스 스키마 삭제"""
    storage = await _get_schema_storage()
    if storage:
        return await storage.delete_schema(workspace)
    return False


async def _get_workspace_schema_meta(workspace: str) -> dict[str, Any]:
    """워크스페이스별 스키마 메타데이터 반환 (DB 우선, 캐시 사용)"""
    global _workspace_schema_cache, _schema_cache_loaded

    # 이미 캐시에 로드되어 있으면 반환
    if workspace in _schema_cache_loaded and workspace in _workspace_schema_cache:
        return _workspace_schema_cache[workspace]

    # DB에서 로드 시도
    db_schema = await _load_workspace_schema_from_db(workspace)
    if db_schema:
        _workspace_schema_cache[workspace] = {
            "source": db_schema.get("source"),
            "applied_at": db_schema.get("applied_at"),
            "entity_types": db_schema.get("entity_types"),
            "relation_types": db_schema.get("relation_types", []),
            "entity_type_details": db_schema.get("entity_type_details"),
            "seed_entities": db_schema.get("seed_entities"),
        }
        _schema_cache_loaded.add(workspace)
        logger.debug(f"Loaded schema from DB for workspace '{workspace}'")
        return _workspace_schema_cache[workspace]

    # DB에 없으면 빈 메타데이터 생성
    if workspace not in _workspace_schema_cache:
        _workspace_schema_cache[workspace] = {
            "source": None,
            "applied_at": None,
            "entity_types": None,
            "relation_types": None,
            "entity_type_details": None,
            "seed_entities": None,
        }
    _schema_cache_loaded.add(workspace)
    return _workspace_schema_cache[workspace]


def _update_schema_cache(
    workspace: str,
    entity_types: list[str] | None,
    relation_types: list[dict] | None = None,
    source: str | None = None,
    applied_at: str | None = None,
    entity_type_details: list[dict] | None = None,
    seed_entities: list[dict] | None = None,
):
    """스키마 캐시 업데이트 (메모리)"""
    global _workspace_schema_cache
    _workspace_schema_cache[workspace] = {
        "source": source,
        "applied_at": applied_at,
        "entity_types": entity_types,
        "relation_types": relation_types,
        "entity_type_details": entity_type_details,
        "seed_entities": seed_entities,
    }
    _schema_cache_loaded.add(workspace)


@router.get("/current", summary="현재 적용된 스키마 조회")
async def get_current_schema(request: Request):
    """
    현재 워크스페이스에 적용된 스키마(엔티티 타입, 관계 타입)를 조회합니다.
    """
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        workspace = _get_workspace_from_request(request)
        schema_meta = await _get_workspace_schema_meta(workspace)

        # 워크스페이스별 저장된 entity_types가 있으면 사용, 없으면 기본값
        if schema_meta.get("entity_types") is not None:
            current_entity_types = schema_meta["entity_types"]
        else:
            current_entity_types = get_default_entity_types()

        # relation_types도 반환 (없으면 빈 리스트)
        current_relation_types = schema_meta.get("relation_types") or []

        # entity_type_details도 반환 (DB에서 로드된 것 포함)
        current_entity_type_details = schema_meta.get("entity_type_details")

        # seed_entities도 반환
        current_seed_entities = schema_meta.get("seed_entities")

        # DB에서 로드한 스키마가 있고 RAG addon_params에 아직 반영되지 않았으면 적용
        workspace_rag = await _get_workspace_rag(workspace)
        if (
            workspace_rag
            and hasattr(workspace_rag, "addon_params")
            and schema_meta.get("entity_types") is not None
        ):
            workspace_rag.addon_params["entity_types"] = list(current_entity_types)
            if current_entity_type_details:
                workspace_rag.addon_params["entity_type_details"] = current_entity_type_details
            else:
                workspace_rag.addon_params.pop("entity_type_details", None)
            if current_seed_entities:
                workspace_rag.addon_params["seed_entities"] = current_seed_entities
            else:
                workspace_rag.addon_params.pop("seed_entities", None)

        return ApiResponse(
            success=True,
            data={
                "entity_types": list(current_entity_types),
                "relation_types": current_relation_types,
                "entity_type_details": current_entity_type_details,
                "seed_entities": current_seed_entities,
                "source": schema_meta.get("source"),
                "applied_at": schema_meta.get("applied_at"),
                "is_default": current_entity_types == get_default_entity_types(),
                "workspace": workspace,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get current schema: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _resolve_entity_type_details(
    schema_request: ApplySchemaRequest,
    entity_types: list[str],
) -> list[dict] | None:
    """ApplySchemaRequest에서 entity_type_details 추출.

    entity_type_details가 요청에 있으면 사용,
    없으면 저장된 DomainSchema 템플릿에서 조회 시도.
    """
    if schema_request.entity_type_details:
        return schema_request.entity_type_details

    # 스키마 소스가 template인 경우 템플릿에서 상세정보 로드
    if schema_request.source and schema_request.source.startswith("template:"):
        domain = schema_request.source.replace("template:", "")
        if _template_manager:
            template = await _template_manager.get_template(domain)
            if template:
                return [
                    {
                        "name": et.name,
                        "description": et.description,
                        "examples": et.examples,
                        "extraction_hints": et.extraction_hints or [],
                    }
                    for et in template.entity_types
                    if et.name in entity_types
                ]
    return None


@router.post("/apply", summary="스키마 적용")
async def apply_schema(request: Request, schema_request: ApplySchemaRequest):
    """
    새로운 스키마(엔티티 타입, 관계 타입)를 현재 워크스페이스에 적용합니다.

    적용된 스키마는 이후 문서 처리 시 엔티티 추출에 사용됩니다.
    스키마는 PostgreSQL에 영구 저장되어 서버 재시작 후에도 유지됩니다.
    """
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        if not schema_request.entity_types:
            raise HTTPException(status_code=400, detail="entity_types cannot be empty")

        workspace = _get_workspace_from_request(request)
        workspace_rag = await _get_workspace_rag(workspace)
        schema_meta = await _get_workspace_schema_meta(workspace)

        # 중복 제거 및 정규화
        entity_types = list(dict.fromkeys(schema_request.entity_types))
        relation_types = schema_request.relation_types or []

        # entity_type_details 해석 (요청 또는 템플릿에서)
        entity_type_details = await _resolve_entity_type_details(
            schema_request, entity_types
        )

        # seed_entities 처리 (요청에 있으면 사용, 없으면 기존 유지)
        seed_entities = schema_request.seed_entities
        if seed_entities is None:
            seed_entities = schema_meta.get("seed_entities")

        # 이전 entity_types 저장
        old_entity_types = schema_meta.get("entity_types") or get_default_entity_types()
        old_relation_types = schema_meta.get("relation_types") or []

        # 타임스탬프
        from datetime import datetime
        applied_at = datetime.now().isoformat()

        # DB에 영구 저장
        db_saved = await _save_workspace_schema_to_db(
            workspace=workspace,
            entity_types=entity_types,
            relation_types=relation_types,
            source=schema_request.source,
            applied_at=applied_at,
            entity_type_details=entity_type_details,
            seed_entities=seed_entities,
        )

        # 메모리 캐시 업데이트
        _update_schema_cache(
            workspace=workspace,
            entity_types=entity_types,
            relation_types=relation_types,
            source=schema_request.source,
            applied_at=applied_at,
            entity_type_details=entity_type_details,
            seed_entities=seed_entities,
        )

        # 워크스페이스별 RAG 인스턴스의 addon_params 업데이트
        if workspace_rag and hasattr(workspace_rag, "addon_params"):
            workspace_rag.addon_params["entity_types"] = entity_types
            if entity_type_details:
                workspace_rag.addon_params["entity_type_details"] = entity_type_details
            else:
                workspace_rag.addon_params.pop("entity_type_details", None)
            if seed_entities:
                workspace_rag.addon_params["seed_entities"] = seed_entities
            else:
                workspace_rag.addon_params.pop("seed_entities", None)

        logger.info(
            f"Schema applied for workspace '{workspace}': "
            f"{len(entity_types)} entity types, {len(relation_types)} relation types "
            f"(was: {len(old_entity_types)} entities, {len(old_relation_types)} relations, "
            f"source: {schema_request.source}, db_saved: {db_saved})"
        )

        return ApiResponse(
            success=True,
            data={
                "entity_types": entity_types,
                "relation_types": relation_types,
                "source": schema_request.source,
                "applied_at": applied_at,
                "previous_entity_count": len(old_entity_types),
                "previous_relation_count": len(old_relation_types),
                "workspace": workspace,
                "persisted": db_saved,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to apply schema: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset", summary="스키마 초기화")
async def reset_schema(request: Request):
    """
    현재 워크스페이스의 스키마를 기본값으로 초기화합니다.
    DB에서 스키마 설정도 삭제됩니다.
    """
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        workspace = _get_workspace_from_request(request)
        workspace_rag = await _get_workspace_rag(workspace)
        schema_meta = await _get_workspace_schema_meta(workspace)

        default_types = get_default_entity_types()
        old_entity_types = schema_meta.get("entity_types") or get_default_entity_types()
        old_relation_types = schema_meta.get("relation_types") or []

        # DB에서 스키마 삭제
        db_deleted = await _delete_workspace_schema_from_db(workspace)

        # 메모리 캐시 초기화
        _update_schema_cache(
            workspace=workspace,
            entity_types=None,  # None means use default
            relation_types=None,
            source=None,
            applied_at=None,
        )

        # 워크스페이스별 RAG 인스턴스의 addon_params 초기화
        if workspace_rag and hasattr(workspace_rag, "addon_params"):
            workspace_rag.addon_params["entity_types"] = list(default_types)
            workspace_rag.addon_params.pop("entity_type_details", None)
            workspace_rag.addon_params.pop("seed_entities", None)

        logger.info(
            f"Schema reset for workspace '{workspace}': {len(default_types)} entity types "
            f"(was: {len(old_entity_types)} entities, {len(old_relation_types)} relations, db_deleted: {db_deleted})"
        )

        return ApiResponse(
            success=True,
            data={
                "entity_types": default_types,
                "relation_types": [],
                "source": None,
                "applied_at": None,
                "previous_entity_count": len(old_entity_types),
                "previous_relation_count": len(old_relation_types),
                "workspace": workspace,
                "db_deleted": db_deleted,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reset schema: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Schema Merge API (스키마 병합)
# =============================================================================


@router.post("/merge/preview", summary="스키마 병합 미리보기")
async def merge_preview(request: Request, preview_request: MergePreviewRequest):
    """
    현재 워크스페이스의 스키마와 새 스키마의 병합 결과를 미리 봅니다.

    중복 항목, 새로 추가될 항목, 최종 병합 결과를 반환합니다.
    실제 적용은 /merge/apply 엔드포인트를 사용하세요.
    """
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        if not preview_request.new_entity_types:
            raise HTTPException(status_code=400, detail="new_entity_types cannot be empty")

        workspace = _get_workspace_from_request(request)
        schema_meta = await _get_workspace_schema_meta(workspace)

        # 현재 엔티티 타입 (워크스페이스별)
        if schema_meta.get("entity_types") is not None:
            current_types = list(schema_meta["entity_types"])
        else:
            current_types = list(get_default_entity_types())
        current_set = set(t.lower() for t in current_types)

        # 새 엔티티 타입 (중복 제거)
        new_types_raw = list(dict.fromkeys(preview_request.new_entity_types))

        # 중복 분류 (대소문자 무시)
        duplicates = []
        truly_new = []

        for t in new_types_raw:
            if t.lower() in current_set:
                # 중복: 기존에 이미 존재
                duplicates.append(t)
            else:
                truly_new.append(t)

        # 병합 결과 (현재 + 새로운 것만)
        merged_result = current_types + truly_new

        return ApiResponse(
            success=True,
            data={
                "current_types": current_types,
                "new_types": truly_new,
                "duplicates": duplicates,
                "merged_result": merged_result,
                "current_count": len(current_types),
                "new_count": len(truly_new),
                "duplicate_count": len(duplicates),
                "merged_count": len(merged_result),
                "source": preview_request.source,
                "workspace": workspace,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to preview merge: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merge/apply", summary="스키마 병합 적용")
async def merge_apply(request: Request, merge_request: MergeApplyRequest):
    """
    현재 워크스페이스의 스키마와 새 스키마를 병합하여 적용합니다.

    - confirmed: True여야 실제 적용됨 (미리보기 후 확인용)
    - exclude_duplicates: True면 중복 항목 제외, False면 중복도 포함 (덮어쓰기 효과)

    병합 결과는 PostgreSQL에 영구 저장되어 서버 재시작 후에도 유지됩니다.
    """
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        if not merge_request.confirmed:
            raise HTTPException(
                status_code=400,
                detail="Merge not confirmed. Set 'confirmed: true' to apply."
            )

        if not merge_request.new_entity_types:
            raise HTTPException(status_code=400, detail="new_entity_types cannot be empty")

        workspace = _get_workspace_from_request(request)
        workspace_rag = await _get_workspace_rag(workspace)
        schema_meta = await _get_workspace_schema_meta(workspace)

        # 현재 엔티티 타입 (워크스페이스별)
        if schema_meta.get("entity_types") is not None:
            current_types = list(schema_meta["entity_types"])
        else:
            current_types = list(get_default_entity_types())
        current_set = set(t.lower() for t in current_types)

        # 현재 관계 타입 유지
        current_relation_types = schema_meta.get("relation_types") or []

        # 새 엔티티 타입 (중복 제거)
        new_types_raw = list(dict.fromkeys(merge_request.new_entity_types))

        # 중복 분류
        duplicates = []
        truly_new = []

        for t in new_types_raw:
            if t.lower() in current_set:
                duplicates.append(t)
            else:
                truly_new.append(t)

        # 병합 (exclude_duplicates에 따라 중복 처리)
        if merge_request.exclude_duplicates:
            merged_result = current_types + truly_new
        else:
            # 중복 포함 (기존 것 유지, 새것 추가)
            merged_result = current_types + truly_new

        # 기존 seed_entities 유지
        current_seed_entities = schema_meta.get("seed_entities")

        # 타임스탬프
        from datetime import datetime
        applied_at = datetime.now().isoformat()
        merge_source = f"merged:{merge_request.source}" if merge_request.source else "merged:custom"

        # DB에 영구 저장
        db_saved = await _save_workspace_schema_to_db(
            workspace=workspace,
            entity_types=merged_result,
            relation_types=current_relation_types,  # 기존 관계 타입 유지
            source=merge_source,
            applied_at=applied_at,
            seed_entities=current_seed_entities,
        )

        # 메모리 캐시 업데이트
        _update_schema_cache(
            workspace=workspace,
            entity_types=merged_result,
            relation_types=current_relation_types,
            source=merge_source,
            applied_at=applied_at,
            seed_entities=current_seed_entities,
        )

        # 워크스페이스별 RAG 인스턴스 업데이트
        old_count = len(current_types)
        if workspace_rag and hasattr(workspace_rag, "addon_params"):
            workspace_rag.addon_params["entity_types"] = merged_result

        logger.info(
            f"Schema merged for workspace '{workspace}': {len(merged_result)} entity types "
            f"(was: {old_count}, added: {len(truly_new)}, duplicates: {len(duplicates)}, db_saved: {db_saved})"
        )

        return ApiResponse(
            success=True,
            data={
                "entity_types": merged_result,
                "relation_types": current_relation_types,
                "source": merge_source,
                "applied_at": applied_at,
                "previous_count": old_count,
                "added_count": len(truly_new),
                "duplicate_count": len(duplicates),
                "duplicates_excluded": duplicates if merge_request.exclude_duplicates else [],
                "workspace": workspace,
                "persisted": db_saved,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to apply merge: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Seed Entities CRUD API
# =============================================================================


@router.get("/seed-entities", summary="시드 엔티티 조회")
async def get_seed_entities(request: Request):
    """현재 워크스페이스의 시드 엔티티를 조회합니다."""
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        workspace = _get_workspace_from_request(request)
        schema_meta = await _get_workspace_schema_meta(workspace)

        seed_entities = schema_meta.get("seed_entities") or []

        return ApiResponse(
            success=True,
            data={
                "seed_entities": seed_entities,
                "count": len(seed_entities),
                "workspace": workspace,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get seed entities: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/seed-entities", summary="시드 엔티티 저장")
async def save_seed_entities(request: Request, seed_request: SeedEntitiesRequest):
    """시드 엔티티를 저장합니다 (전체 교체)."""
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        workspace = _get_workspace_from_request(request)
        workspace_rag = await _get_workspace_rag(workspace)
        schema_meta = await _get_workspace_schema_meta(workspace)

        # Convert to dict list
        seed_entities = [item.model_dump() for item in seed_request.seed_entities]

        # 기존 스키마 필드 유지하면서 seed_entities만 업데이트
        entity_types = schema_meta.get("entity_types") or get_default_entity_types()
        relation_types = schema_meta.get("relation_types") or []
        entity_type_details = schema_meta.get("entity_type_details")
        source = schema_meta.get("source")
        applied_at = schema_meta.get("applied_at")

        # DB에 저장
        db_saved = await _save_workspace_schema_to_db(
            workspace=workspace,
            entity_types=entity_types,
            relation_types=relation_types,
            source=source,
            applied_at=applied_at,
            entity_type_details=entity_type_details,
            seed_entities=seed_entities,
        )

        # 캐시 업데이트
        _update_schema_cache(
            workspace=workspace,
            entity_types=entity_types,
            relation_types=relation_types,
            source=source,
            applied_at=applied_at,
            entity_type_details=entity_type_details,
            seed_entities=seed_entities,
        )

        # addon_params 업데이트
        if workspace_rag and hasattr(workspace_rag, "addon_params"):
            if seed_entities:
                workspace_rag.addon_params["seed_entities"] = seed_entities
            else:
                workspace_rag.addon_params.pop("seed_entities", None)

        logger.info(
            f"Seed entities saved for workspace '{workspace}': {len(seed_entities)} entities"
        )

        return ApiResponse(
            success=True,
            data={
                "seed_entities": seed_entities,
                "count": len(seed_entities),
                "workspace": workspace,
                "persisted": db_saved,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save seed entities: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/seed-entities", summary="시드 엔티티 초기화")
async def delete_seed_entities(request: Request):
    """현재 워크스페이스의 시드 엔티티를 모두 삭제합니다."""
    try:
        if get_rag_instance() is None:
            raise HTTPException(status_code=503, detail="RAG instance not available")

        workspace = _get_workspace_from_request(request)
        workspace_rag = await _get_workspace_rag(workspace)
        schema_meta = await _get_workspace_schema_meta(workspace)

        # 기존 스키마 필드 유지하면서 seed_entities만 초기화
        entity_types = schema_meta.get("entity_types") or get_default_entity_types()
        relation_types = schema_meta.get("relation_types") or []
        entity_type_details = schema_meta.get("entity_type_details")
        source = schema_meta.get("source")
        applied_at = schema_meta.get("applied_at")

        # DB에 저장 (seed_entities=None)
        db_saved = await _save_workspace_schema_to_db(
            workspace=workspace,
            entity_types=entity_types,
            relation_types=relation_types,
            source=source,
            applied_at=applied_at,
            entity_type_details=entity_type_details,
            seed_entities=None,
        )

        # 캐시 업데이트
        _update_schema_cache(
            workspace=workspace,
            entity_types=entity_types,
            relation_types=relation_types,
            source=source,
            applied_at=applied_at,
            entity_type_details=entity_type_details,
            seed_entities=None,
        )

        # addon_params에서 제거
        if workspace_rag and hasattr(workspace_rag, "addon_params"):
            workspace_rag.addon_params.pop("seed_entities", None)

        logger.info(f"Seed entities cleared for workspace '{workspace}'")

        return ApiResponse(
            success=True,
            data={
                "cleared": True,
                "workspace": workspace,
                "persisted": db_saved,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to clear seed entities: {e}")
        raise HTTPException(status_code=500, detail=str(e))
