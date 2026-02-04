"""
Schema Template Manager

도메인 스키마 템플릿을 관리하는 모듈입니다.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from .models import DomainSchema, EntityType, RelationType

logger = logging.getLogger(__name__)


class SchemaTemplateManager:
    """스키마 템플릿 관리자

    도메인별 스키마 템플릿을 파일 시스템에서 관리합니다.

    Attributes:
        templates_dir: 템플릿 저장 디렉토리 경로
    """

    def __init__(self, templates_dir: Optional[str] = None):
        """초기화

        Args:
            templates_dir: 템플릿 저장 디렉토리 경로
                          None이면 기본 경로 (lightrag/schema/templates/) 사용
        """
        if templates_dir is None:
            self.templates_dir = Path(__file__).parent / "templates"
        else:
            self.templates_dir = Path(templates_dir)

        self.templates_dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, DomainSchema] = {}
        logger.info(f"SchemaTemplateManager initialized: {self.templates_dir}")

    async def get_template(self, domain: str) -> Optional[DomainSchema]:
        """템플릿 조회

        Args:
            domain: 도메인 식별자

        Returns:
            DomainSchema 또는 None (존재하지 않는 경우)
        """
        # 캐시 확인
        if domain in self._cache:
            return self._cache[domain]

        # 파일에서 로드
        template_path = self.templates_dir / f"{domain}.json"
        if not template_path.exists():
            logger.warning(f"Template not found: {domain}")
            return None

        try:
            with open(template_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            schema = DomainSchema.from_dict(data)
            self._cache[domain] = schema
            logger.info(f"Template loaded: {domain}")
            return schema

        except Exception as e:
            logger.error(f"Failed to load template {domain}: {e}")
            return None

    async def list_templates(
        self,
        tags: Optional[list[str]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[DomainSchema], int]:
        """템플릿 목록 조회

        Args:
            tags: 필터링할 태그 목록 (None이면 전체)
            limit: 최대 반환 개수
            offset: 시작 위치

        Returns:
            (템플릿 목록, 전체 개수) 튜플
        """
        templates = []

        for path in sorted(self.templates_dir.glob("*.json")):
            try:
                schema = await self.get_template(path.stem)
                if schema:
                    # 태그 필터링
                    if tags is None or any(t in schema.tags for t in tags):
                        templates.append(schema)
            except Exception as e:
                logger.error(f"Failed to load template {path.stem}: {e}")
                continue

        total = len(templates)
        return templates[offset : offset + limit], total

    async def save_template(
        self,
        schema: DomainSchema,
        overwrite: bool = False,
    ) -> bool:
        """템플릿 저장

        Args:
            schema: 저장할 스키마
            overwrite: 기존 파일 덮어쓰기 여부

        Returns:
            성공 여부
        """
        template_path = self.templates_dir / f"{schema.domain}.json"

        if template_path.exists() and not overwrite:
            logger.warning(f"Template already exists: {schema.domain}")
            return False

        try:
            # 유효성 검증
            errors = schema.validate()
            if errors:
                logger.error(f"Schema validation failed: {errors}")
                return False

            # 타임스탬프 업데이트
            now = datetime.now()
            if schema.created_at is None:
                schema.created_at = now
            schema.updated_at = now

            # 저장
            with open(template_path, "w", encoding="utf-8") as f:
                json.dump(schema.to_dict(), f, ensure_ascii=False, indent=2)

            # 캐시 업데이트
            self._cache[schema.domain] = schema
            logger.info(f"Template saved: {schema.domain}")
            return True

        except Exception as e:
            logger.error(f"Failed to save template {schema.domain}: {e}")
            return False

    async def delete_template(self, domain: str) -> bool:
        """템플릿 삭제

        Args:
            domain: 도메인 식별자

        Returns:
            성공 여부
        """
        template_path = self.templates_dir / f"{domain}.json"

        if not template_path.exists():
            logger.warning(f"Template not found: {domain}")
            return False

        try:
            template_path.unlink()
            self._cache.pop(domain, None)
            logger.info(f"Template deleted: {domain}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete template {domain}: {e}")
            return False

    async def search_templates(
        self,
        keywords: list[str],
        limit: int = 10,
    ) -> list[DomainSchema]:
        """템플릿 검색

        키워드를 태그, 이름, 설명에서 검색합니다.

        Args:
            keywords: 검색 키워드 목록
            limit: 최대 반환 개수

        Returns:
            매칭된 템플릿 목록
        """
        templates, _ = await self.list_templates()
        results = []

        for schema in templates:
            score = 0
            search_text = " ".join(
                [
                    schema.domain,
                    schema.display_name,
                    schema.description,
                    " ".join(schema.tags),
                ]
            ).lower()

            for keyword in keywords:
                if keyword.lower() in search_text:
                    score += 1

            if score > 0:
                results.append((score, schema))

        # 점수 기준 정렬
        results.sort(key=lambda x: x[0], reverse=True)
        return [schema for _, schema in results[:limit]]

    async def merge_schemas(
        self,
        domains: list[str],
        merge_strategy: str = "union",
    ) -> Optional[DomainSchema]:
        """스키마 병합

        여러 도메인 스키마를 하나로 병합합니다.

        Args:
            domains: 병합할 도메인 목록
            merge_strategy: 병합 전략 (union, intersection)

        Returns:
            병합된 스키마 또는 None
        """
        schemas = []
        for domain in domains:
            schema = await self.get_template(domain)
            if schema:
                schemas.append(schema)

        if not schemas:
            return None

        if len(schemas) == 1:
            return schemas[0]

        # 병합
        merged_entity_types: dict[str, EntityType] = {}
        merged_relation_types: dict[str, RelationType] = {}
        all_tags: set[str] = set()

        for schema in schemas:
            all_tags.update(schema.tags)

            for et in schema.entity_types:
                if et.name not in merged_entity_types:
                    merged_entity_types[et.name] = et
                else:
                    # 기존 것과 예시 병합
                    existing = merged_entity_types[et.name]
                    merged_examples = list(
                        set(existing.examples + et.examples)
                    )
                    merged_entity_types[et.name] = EntityType(
                        name=et.name,
                        display_name=existing.display_name,
                        description=existing.description,
                        examples=merged_examples,
                        color=existing.color or et.color,
                        icon=existing.icon or et.icon,
                    )

            for rt in schema.relation_types:
                if rt.name not in merged_relation_types:
                    merged_relation_types[rt.name] = rt
                else:
                    # 소스/타겟 타입 병합
                    existing = merged_relation_types[rt.name]
                    merged_source = list(
                        set(existing.source_types + rt.source_types)
                    )
                    merged_target = list(
                        set(existing.target_types + rt.target_types)
                    )
                    merged_relation_types[rt.name] = RelationType(
                        name=rt.name,
                        display_name=existing.display_name,
                        description=existing.description,
                        source_types=merged_source,
                        target_types=merged_target,
                    )

        return DomainSchema(
            domain="_".join(domains),
            display_name=" + ".join(s.display_name for s in schemas),
            description=f"Merged schema from: {', '.join(domains)}",
            entity_types=list(merged_entity_types.values()),
            relation_types=list(merged_relation_types.values()),
            tags=list(all_tags),
            extends=domains,
            created_at=datetime.now(),
        )

    def clear_cache(self):
        """캐시 초기화"""
        self._cache.clear()
        logger.info("Template cache cleared")
