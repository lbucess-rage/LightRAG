"""
LightRAG Schema Module

도메인 특화 지식 그래프 스키마 관리를 위한 모듈입니다.

주요 컴포넌트:
- models: 데이터 모델 (EntityType, RelationType, DomainSchema)
- templates: 스키마 템플릿 관리자
- prompts: LLM 프롬프트 정의
- discovery: 스키마 발견 엔진 (Phase 2)
- applier: 스키마 적용 (Phase 3)
"""

from .models import EntityType, RelationType, DomainSchema, SchemaDiscoveryResult
from .templates import SchemaTemplateManager
from .prompts import (
    SCHEMA_DISCOVERY_SYSTEM_PROMPT,
    SCHEMA_DISCOVERY_USER_PROMPT,
    SCHEMA_REFINEMENT_SYSTEM_PROMPT,
    DOMAIN_HINTS,
)

__all__ = [
    # Models
    "EntityType",
    "RelationType",
    "DomainSchema",
    "SchemaDiscoveryResult",
    # Templates
    "SchemaTemplateManager",
    # Prompts
    "SCHEMA_DISCOVERY_SYSTEM_PROMPT",
    "SCHEMA_DISCOVERY_USER_PROMPT",
    "SCHEMA_REFINEMENT_SYSTEM_PROMPT",
    "DOMAIN_HINTS",
]
