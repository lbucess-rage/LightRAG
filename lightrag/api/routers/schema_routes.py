"""
Schema Management API Routes

지식 그래프 스키마 관리를 위한 API 엔드포인트입니다.
"""

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lightrag.schema import (
    DomainSchema,
    SchemaDiscoveryResult,
    SchemaTemplateManager,
)
from lightrag.schema.discovery import SchemaDiscoveryEngine
from lightrag.utils import logger

router = APIRouter(tags=["Schema"])

# 전역 템플릿 매니저 (서버 시작 시 초기화됨)
_template_manager: Optional[SchemaTemplateManager] = None
_discovery_engine: Optional[SchemaDiscoveryEngine] = None


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
        description="옵션: sample_size, max_entity_types, max_relation_types, language, domain_hints",
    )


class DiscoverFromDomainRequest(BaseModel):
    """도메인 기반 스키마 추천 요청"""

    domains: list[str] = Field(..., description="도메인 식별자 목록")
    options: Optional[dict[str, Any]] = Field(
        None,
        description="옵션: merge_strategy",
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
# Discovery Endpoints
# =============================================================================


@router.post("/discover/from-document", response_model=ApiResponse)
async def discover_from_document(request: DiscoverFromDocumentRequest):
    """문서 기반 스키마 발견

    업로드된 문서를 분석하여 도메인에 적합한 엔티티/관계 타입을 발견합니다.
    """
    engine = get_discovery_engine()
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

        # 스키마 발견
        result = await engine.discover_from_documents(
            documents=documents,
            options=request.options,
        )

        return ApiResponse(success=True, data=result.to_dict())

    except ValueError as e:
        logger.warning(f"Schema discovery validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Schema discovery failed: {e}")
        raise HTTPException(status_code=500, detail=f"Discovery failed: {str(e)}")


@router.post("/discover/from-domain", response_model=ApiResponse)
async def discover_from_domain(request: DiscoverFromDomainRequest):
    """도메인 기반 스키마 추천

    등록된 도메인 템플릿을 기반으로 스키마를 추천합니다.
    """
    manager = get_template_manager()

    try:
        if not request.domains:
            raise HTTPException(status_code=400, detail="No domains provided")

        # 단일 도메인
        if len(request.domains) == 1:
            template = await manager.get_template(request.domains[0])
            if template is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Template not found: {request.domains[0]}",
                )

            result = SchemaDiscoveryResult(
                entity_types=template.entity_types,
                relation_types=template.relation_types,
                source_type="domain_keyword",
                confidence=1.0,
                similar_templates=[template.domain],
                domain_summary=template.description,
            )
            return ApiResponse(success=True, data=result.to_dict())

        # 다중 도메인 병합
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

        result = SchemaDiscoveryResult(
            entity_types=merged.entity_types,
            relation_types=merged.relation_types,
            source_type="domain_keyword",
            confidence=1.0,
            similar_templates=request.domains,
            domain_summary=merged.description,
        )
        return ApiResponse(success=True, data=result.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Domain discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/discover/hybrid", response_model=ApiResponse)
async def discover_hybrid(request: HybridDiscoverRequest):
    """하이브리드 스키마 발견

    문서 분석과 도메인 템플릿을 결합하여 스키마를 발견합니다.
    """
    engine = get_discovery_engine()
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
