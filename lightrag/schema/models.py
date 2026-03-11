"""
Schema Data Models

지식 그래프 스키마를 위한 데이터 모델 정의입니다.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


@dataclass
class EntityType:
    """엔티티 타입 정의

    Attributes:
        name: 엔티티 타입 이름 (PascalCase, 예: Customer, InquiryType)
        display_name: 표시 이름 (한글, 예: 고객, 문의 유형)
        description: 엔티티 타입에 대한 설명
        examples: 이 타입에 해당하는 예시 목록
        color: UI 표시용 색상 (hex, 예: #4CAF50)
        icon: UI 표시용 아이콘 이름
        extraction_hints: LLM 추출 시 힌트 목록
        confidence: 발견된 스키마의 경우 신뢰도 (0.0 ~ 1.0)
    """

    name: str
    display_name: str
    description: str
    examples: list[str] = field(default_factory=list)
    color: Optional[str] = None
    icon: Optional[str] = None
    extraction_hints: Optional[list[str]] = None
    confidence: Optional[float] = None

    def __post_init__(self):
        """이름 형식 검증"""
        if not self.name:
            raise ValueError("EntityType name cannot be empty")
        if not self.name[0].isupper():
            raise ValueError(f"EntityType name must be PascalCase: {self.name}")

    def to_dict(self) -> dict[str, Any]:
        """딕셔너리로 변환"""
        result = {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "examples": self.examples,
        }
        if self.color:
            result["color"] = self.color
        if self.icon:
            result["icon"] = self.icon
        if self.extraction_hints:
            result["extraction_hints"] = self.extraction_hints
        if self.confidence is not None:
            result["confidence"] = self.confidence
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EntityType":
        """딕셔너리에서 생성"""
        return cls(
            name=data["name"],
            display_name=data.get("display_name", data["name"]),
            description=data.get("description", ""),
            examples=data.get("examples", []),
            color=data.get("color"),
            icon=data.get("icon"),
            extraction_hints=data.get("extraction_hints"),
            confidence=data.get("confidence"),
        )


@dataclass
class RelationType:
    """관계 타입 정의

    Attributes:
        name: 관계 타입 이름 (UPPER_SNAKE_CASE, 예: SUBMITTED, HANDLED_BY)
        display_name: 표시 이름 (한글, 예: 접수함, 처리됨)
        description: 관계 타입에 대한 설명
        source_types: 소스가 될 수 있는 엔티티 타입 목록
        target_types: 타겟이 될 수 있는 엔티티 타입 목록
        is_directional: 방향성 여부 (기본: True)
        cardinality: 카디널리티 (1:1, 1:N, N:M 등, 기본: N:M)
        examples: 예시 문장 목록
        confidence: 발견된 스키마의 경우 신뢰도 (0.0 ~ 1.0)
    """

    name: str
    display_name: str
    description: str
    source_types: list[str]
    target_types: list[str]
    is_directional: bool = True
    cardinality: str = "N:M"
    examples: Optional[list[str]] = None
    confidence: Optional[float] = None

    def __post_init__(self):
        """이름 형식 검증"""
        if not self.name:
            raise ValueError("RelationType name cannot be empty")
        if not self.name.isupper():
            raise ValueError(f"RelationType name must be UPPER_SNAKE_CASE: {self.name}")

    def to_dict(self) -> dict[str, Any]:
        """딕셔너리로 변환"""
        result = {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "source_types": self.source_types,
            "target_types": self.target_types,
            "is_directional": self.is_directional,
            "cardinality": self.cardinality,
        }
        if self.examples:
            result["examples"] = self.examples
        if self.confidence is not None:
            result["confidence"] = self.confidence
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RelationType":
        """딕셔너리에서 생성"""
        return cls(
            name=data["name"],
            display_name=data.get("display_name", data["name"]),
            description=data.get("description", ""),
            source_types=data.get("source_types", []),
            target_types=data.get("target_types", []),
            is_directional=data.get("is_directional", True),
            cardinality=data.get("cardinality", "N:M"),
            examples=data.get("examples"),
            confidence=data.get("confidence"),
        )


@dataclass
class DomainSchema:
    """도메인 스키마

    특정 도메인에 대한 엔티티 타입과 관계 타입의 집합입니다.

    Attributes:
        domain: 도메인 식별자 (snake_case, 예: contact_center)
        display_name: 표시 이름 (예: 컨택센터 상담)
        description: 도메인 스키마에 대한 설명
        entity_types: 엔티티 타입 목록
        relation_types: 관계 타입 목록
        version: 스키마 버전 (SemVer)
        tags: 검색용 태그 목록
        extends: 확장할 부모 도메인 목록
        created_at: 생성 시각
        updated_at: 수정 시각
        author: 작성자
    """

    domain: str
    display_name: str
    description: str
    entity_types: list[EntityType]
    relation_types: list[RelationType]
    version: str = "1.0.0"
    tags: list[str] = field(default_factory=list)
    extends: Optional[list[str]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    author: Optional[str] = None

    def __post_init__(self):
        """도메인 이름 형식 검증"""
        if not self.domain:
            raise ValueError("Domain name cannot be empty")
        if not self.domain.islower() and "_" not in self.domain:
            # snake_case 허용
            pass

    def get_entity_type_names(self) -> list[str]:
        """엔티티 타입 이름 목록 반환"""
        return [et.name for et in self.entity_types]

    def get_relation_type_names(self) -> list[str]:
        """관계 타입 이름 목록 반환"""
        return [rt.name for rt in self.relation_types]

    def get_entity_type(self, name: str) -> Optional[EntityType]:
        """이름으로 엔티티 타입 조회"""
        for et in self.entity_types:
            if et.name == name:
                return et
        return None

    def get_relation_type(self, name: str) -> Optional[RelationType]:
        """이름으로 관계 타입 조회"""
        for rt in self.relation_types:
            if rt.name == name:
                return rt
        return None

    def validate(self) -> list[str]:
        """스키마 유효성 검증

        Returns:
            오류 메시지 목록 (비어있으면 유효)
        """
        errors = []
        entity_names = set(self.get_entity_type_names())

        # 관계 타입의 소스/타겟 검증
        for rt in self.relation_types:
            for st in rt.source_types:
                if st not in entity_names:
                    errors.append(
                        f"RelationType '{rt.name}': unknown source_type '{st}'"
                    )
            for tt in rt.target_types:
                if tt not in entity_names:
                    errors.append(
                        f"RelationType '{rt.name}': unknown target_type '{tt}'"
                    )

        # 중복 이름 검증
        if len(entity_names) != len(self.entity_types):
            errors.append("Duplicate entity type names found")

        relation_names = self.get_relation_type_names()
        if len(set(relation_names)) != len(relation_names):
            errors.append("Duplicate relation type names found")

        return errors

    def to_dict(self) -> dict[str, Any]:
        """딕셔너리로 변환"""
        result = {
            "domain": self.domain,
            "display_name": self.display_name,
            "description": self.description,
            "entity_types": [et.to_dict() for et in self.entity_types],
            "relation_types": [rt.to_dict() for rt in self.relation_types],
            "version": self.version,
            "tags": self.tags,
        }
        if self.extends:
            result["extends"] = self.extends
        if self.created_at:
            result["created_at"] = self.created_at.isoformat()
        if self.updated_at:
            result["updated_at"] = self.updated_at.isoformat()
        if self.author:
            result["author"] = self.author
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DomainSchema":
        """딕셔너리에서 생성"""
        entity_types = [
            EntityType.from_dict(et) for et in data.get("entity_types", [])
        ]
        relation_types = [
            RelationType.from_dict(rt) for rt in data.get("relation_types", [])
        ]

        created_at = None
        if data.get("created_at"):
            created_at = datetime.fromisoformat(data["created_at"])

        updated_at = None
        if data.get("updated_at"):
            updated_at = datetime.fromisoformat(data["updated_at"])

        return cls(
            domain=data["domain"],
            display_name=data.get("display_name", data["domain"]),
            description=data.get("description", ""),
            entity_types=entity_types,
            relation_types=relation_types,
            version=data.get("version", "1.0.0"),
            tags=data.get("tags", []),
            extends=data.get("extends"),
            created_at=created_at,
            updated_at=updated_at,
            author=data.get("author"),
        )

    def to_lightrag_entity_types(self) -> list[str]:
        """LightRAG addon_params용 엔티티 타입 목록 반환"""
        return self.get_entity_type_names()


@dataclass
class SchemaDiscoveryResult:
    """스키마 발견 결과

    Attributes:
        entity_types: 발견된 엔티티 타입 목록
        relation_types: 발견된 관계 타입 목록
        source_type: 발견 소스 유형 (document, domain_keyword, hybrid)
        confidence: 전체 신뢰도 (0.0 ~ 1.0)
        sample_extractions: 샘플 추출 결과
        similar_templates: 유사한 도메인 템플릿 목록
        suggestions: 개선 제안 목록
        domain_summary: 도메인 요약
    """

    entity_types: list[EntityType]
    relation_types: list[RelationType]
    source_type: str = "document"
    confidence: float = 0.0
    sample_extractions: Optional[list[dict[str, Any]]] = None
    similar_templates: Optional[list[str]] = None
    suggestions: Optional[list[str]] = None
    domain_summary: Optional[str] = None

    def to_domain_schema(
        self,
        domain: str,
        display_name: str,
        description: Optional[str] = None,
    ) -> DomainSchema:
        """발견 결과를 DomainSchema로 변환"""
        return DomainSchema(
            domain=domain,
            display_name=display_name,
            description=description or self.domain_summary or "",
            entity_types=self.entity_types,
            relation_types=self.relation_types,
            created_at=datetime.now(),
        )

    def to_dict(self) -> dict[str, Any]:
        """딕셔너리로 변환"""
        return {
            "entity_types": [et.to_dict() for et in self.entity_types],
            "relation_types": [rt.to_dict() for rt in self.relation_types],
            "source_type": self.source_type,
            "confidence": self.confidence,
            "sample_extractions": self.sample_extractions,
            "similar_templates": self.similar_templates,
            "suggestions": self.suggestions,
            "domain_summary": self.domain_summary,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SchemaDiscoveryResult":
        """딕셔너리에서 생성"""
        entity_types = [
            EntityType.from_dict(et) for et in data.get("entity_types", [])
        ]
        relation_types = [
            RelationType.from_dict(rt) for rt in data.get("relation_types", [])
        ]
        return cls(
            entity_types=entity_types,
            relation_types=relation_types,
            source_type=data.get("source_type", "document"),
            confidence=data.get("confidence", 0.0),
            sample_extractions=data.get("sample_extractions"),
            similar_templates=data.get("similar_templates"),
            suggestions=data.get("suggestions"),
            domain_summary=data.get("domain_summary"),
        )
