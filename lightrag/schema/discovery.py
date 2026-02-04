"""
Schema Discovery Engine

문서 또는 도메인 키워드에서 스키마를 발견하는 엔진입니다.
"""

import json
import logging
import re
from typing import Any, Callable, Optional

from .models import (
    DomainSchema,
    EntityType,
    RelationType,
    SchemaDiscoveryResult,
)
from .prompts import (
    DOMAIN_HINTS,
    SCHEMA_DISCOVERY_SYSTEM_PROMPT,
    SCHEMA_DISCOVERY_USER_PROMPT,
    SCHEMA_REFINEMENT_SYSTEM_PROMPT,
    SCHEMA_REFINEMENT_USER_PROMPT,
)
from .templates import SchemaTemplateManager

logger = logging.getLogger(__name__)


class SchemaDiscoveryEngine:
    """스키마 발견 엔진

    문서 또는 도메인 키워드를 분석하여 적합한 엔티티/관계 타입을 발견합니다.

    Attributes:
        llm_func: LLM 호출 함수
        template_manager: 템플릿 관리자
    """

    def __init__(
        self,
        llm_func: Callable,
        template_manager: Optional[SchemaTemplateManager] = None,
    ):
        """초기화

        Args:
            llm_func: LLM 호출 함수 (async def func(prompt, system_prompt=None) -> str)
            template_manager: 템플릿 관리자 (None이면 기본 생성)
        """
        self.llm_func = llm_func
        self.template_manager = template_manager or SchemaTemplateManager()

    async def discover_from_documents(
        self,
        documents: list[str],
        options: Optional[dict[str, Any]] = None,
    ) -> SchemaDiscoveryResult:
        """문서에서 스키마 발견

        Args:
            documents: 분석할 문서 목록
            options: 옵션
                - sample_size: 샘플 문서 수 (기본: 5)
                - max_entity_types: 최대 엔티티 타입 수 (기본: 15)
                - max_relation_types: 최대 관계 타입 수 (기본: 20)
                - language: 출력 언어 (기본: Korean)
                - domain_hints: 도메인 힌트 문자열

        Returns:
            SchemaDiscoveryResult
        """
        options = options or {}
        max_entity_types = options.get("max_entity_types", 15)
        max_relation_types = options.get("max_relation_types", 20)
        language = options.get("language", "Korean")
        domain_hints = options.get("domain_hints", "")

        # 문서 샘플 준비
        sample_size = min(options.get("sample_size", 5), len(documents))
        samples = documents[:sample_size]

        # 문서 텍스트 결합
        document_text = "\n\n--- 문서 ---\n".join(samples)

        # 프롬프트 생성
        user_prompt = SCHEMA_DISCOVERY_USER_PROMPT.format(
            document_samples=document_text,
            max_entity_types=max_entity_types,
            max_relation_types=max_relation_types,
            language=language,
            domain_hints=domain_hints or "없음",
        )

        logger.info(f"Discovering schema from {len(samples)} documents")

        # LLM 호출
        try:
            response = await self.llm_func(
                user_prompt,
                system_prompt=SCHEMA_DISCOVERY_SYSTEM_PROMPT,
            )
        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            raise RuntimeError(f"Schema discovery failed: {e}")

        # 결과 파싱
        result = self._parse_llm_response(response)
        result.source_type = "document"

        # 유사 템플릿 검색
        try:
            similar = await self._find_similar_templates(result)
            result.similar_templates = similar
        except Exception as e:
            logger.warning(f"Failed to find similar templates: {e}")

        logger.info(
            f"Discovered {len(result.entity_types)} entity types, "
            f"{len(result.relation_types)} relation types"
        )

        return result

    async def discover_from_domain(
        self,
        domains: list[str],
        options: Optional[dict[str, Any]] = None,
    ) -> SchemaDiscoveryResult:
        """도메인 키워드에서 스키마 추천

        등록된 템플릿을 기반으로 스키마를 추천합니다.

        Args:
            domains: 도메인 식별자 목록
            options: 옵션
                - merge_strategy: 병합 전략 (union, intersection)

        Returns:
            SchemaDiscoveryResult
        """
        options = options or {}
        merge_strategy = options.get("merge_strategy", "union")

        logger.info(f"Discovering schema from domains: {domains}")

        # 템플릿 병합
        merged = await self.template_manager.merge_schemas(
            domains, merge_strategy=merge_strategy
        )

        if merged is None:
            raise ValueError(f"No templates found for domains: {domains}")

        return SchemaDiscoveryResult(
            entity_types=merged.entity_types,
            relation_types=merged.relation_types,
            source_type="domain_keyword",
            confidence=1.0,  # 템플릿 기반이므로 신뢰도 높음
            similar_templates=domains,
            domain_summary=merged.description,
        )

    async def discover_hybrid(
        self,
        documents: list[str],
        domain_hints: list[str],
        options: Optional[dict[str, Any]] = None,
    ) -> SchemaDiscoveryResult:
        """하이브리드 스키마 발견

        문서 분석과 도메인 템플릿을 결합하여 스키마를 발견합니다.

        Args:
            documents: 분석할 문서 목록
            domain_hints: 도메인 힌트 목록
            options: 옵션
                - template_weight: 템플릿 가중치 (0.0 ~ 1.0, 기본: 0.3)
                - discovery_weight: 발견 가중치 (0.0 ~ 1.0, 기본: 0.7)

        Returns:
            SchemaDiscoveryResult
        """
        options = options or {}
        template_weight = options.get("template_weight", 0.3)
        discovery_weight = options.get("discovery_weight", 0.7)

        logger.info(
            f"Hybrid discovery with {len(documents)} docs and hints: {domain_hints}"
        )

        # 도메인 힌트 텍스트 생성
        hint_texts = []
        for hint in domain_hints:
            if hint in DOMAIN_HINTS:
                hint_texts.append(DOMAIN_HINTS[hint])

        # 문서 기반 발견
        doc_options = {
            **options,
            "domain_hints": "\n".join(hint_texts),
        }
        doc_result = await self.discover_from_documents(documents, doc_options)

        # 템플릿 기반 발견 (가능한 경우)
        template_result = None
        valid_domains = []
        for domain in domain_hints:
            template = await self.template_manager.get_template(domain)
            if template:
                valid_domains.append(domain)

        if valid_domains:
            try:
                template_result = await self.discover_from_domain(valid_domains, options)
            except Exception as e:
                logger.warning(f"Template discovery failed: {e}")

        # 결과 병합
        if template_result:
            merged_result = self._merge_results(
                doc_result,
                template_result,
                discovery_weight,
                template_weight,
            )
            merged_result.source_type = "hybrid"
            return merged_result

        doc_result.source_type = "hybrid"
        return doc_result

    async def refine_schema(
        self,
        initial_result: SchemaDiscoveryResult,
        documents: list[str],
        options: Optional[dict[str, Any]] = None,
    ) -> SchemaDiscoveryResult:
        """스키마 개선

        초기 발견된 스키마를 LLM으로 개선합니다.

        Args:
            initial_result: 초기 발견 결과
            documents: 원본 문서 목록
            options: 옵션

        Returns:
            개선된 SchemaDiscoveryResult
        """
        options = options or {}

        # 초기 스키마를 JSON으로 변환
        initial_schema_json = json.dumps(
            {
                "entity_types": [et.to_dict() for et in initial_result.entity_types],
                "relation_types": [rt.to_dict() for rt in initial_result.relation_types],
            },
            ensure_ascii=False,
            indent=2,
        )

        # 문서 샘플
        sample_size = min(options.get("sample_size", 3), len(documents))
        samples = documents[:sample_size]
        document_text = "\n\n--- 문서 ---\n".join(samples)

        # 프롬프트 생성
        user_prompt = SCHEMA_REFINEMENT_USER_PROMPT.format(
            initial_schema=initial_schema_json,
            document_samples=document_text,
        )

        logger.info("Refining schema with LLM")

        # LLM 호출
        try:
            response = await self.llm_func(
                user_prompt,
                system_prompt=SCHEMA_REFINEMENT_SYSTEM_PROMPT,
            )
        except Exception as e:
            logger.error(f"Schema refinement failed: {e}")
            return initial_result  # 실패 시 원본 반환

        # 결과 파싱
        try:
            refined = self._parse_refinement_response(response)
            refined.source_type = initial_result.source_type
            refined.suggestions = self._extract_changes(response)
            return refined
        except Exception as e:
            logger.warning(f"Failed to parse refinement result: {e}")
            return initial_result

    def _parse_llm_response(self, response: str) -> SchemaDiscoveryResult:
        """LLM 응답 파싱

        Args:
            response: LLM 응답 문자열

        Returns:
            SchemaDiscoveryResult
        """
        # JSON 추출
        data = self._extract_json(response)

        # 엔티티 타입 파싱
        entity_types = []
        for et_data in data.get("entity_types", []):
            try:
                et = EntityType.from_dict(et_data)
                entity_types.append(et)
            except Exception as e:
                logger.warning(f"Failed to parse entity type: {e}")

        # 관계 타입 파싱
        relation_types = []
        for rt_data in data.get("relation_types", []):
            try:
                rt = RelationType.from_dict(rt_data)
                relation_types.append(rt)
            except Exception as e:
                logger.warning(f"Failed to parse relation type: {e}")

        # 신뢰도 계산 (엔티티/관계 수 기반)
        confidence = min(
            1.0,
            (len(entity_types) * 0.05 + len(relation_types) * 0.03),
        )

        return SchemaDiscoveryResult(
            entity_types=entity_types,
            relation_types=relation_types,
            confidence=confidence,
            domain_summary=data.get("domain_summary"),
        )

    def _parse_refinement_response(self, response: str) -> SchemaDiscoveryResult:
        """개선 응답 파싱"""
        data = self._extract_json(response)

        # refined_schema 키가 있으면 사용
        schema_data = data.get("refined_schema", data)

        entity_types = [
            EntityType.from_dict(et) for et in schema_data.get("entity_types", [])
        ]
        relation_types = [
            RelationType.from_dict(rt) for rt in schema_data.get("relation_types", [])
        ]

        return SchemaDiscoveryResult(
            entity_types=entity_types,
            relation_types=relation_types,
            confidence=0.9,  # 개선된 스키마는 신뢰도 높음
        )

    def _extract_json(self, text: str) -> dict:
        """텍스트에서 JSON 추출"""
        # 코드 블록 내 JSON 찾기
        json_match = re.search(r"```json?\s*([\s\S]*?)\s*```", text)
        if json_match:
            return json.loads(json_match.group(1))

        # 직접 JSON 객체 찾기
        json_match = re.search(r"\{[\s\S]*\}", text)
        if json_match:
            return json.loads(json_match.group(0))

        raise ValueError("JSON not found in response")

    def _extract_changes(self, response: str) -> list[str]:
        """개선 응답에서 변경 사항 추출"""
        changes = []
        try:
            data = self._extract_json(response)
            for change in data.get("changes", []):
                if isinstance(change, dict):
                    changes.append(change.get("description", str(change)))
                else:
                    changes.append(str(change))
        except Exception:
            pass
        return changes

    async def _find_similar_templates(
        self,
        result: SchemaDiscoveryResult,
    ) -> list[str]:
        """유사 템플릿 검색"""
        # 엔티티 타입 이름을 키워드로 사용
        keywords = [et.name.lower() for et in result.entity_types[:5]]
        similar = await self.template_manager.search_templates(keywords, limit=3)
        return [s.domain for s in similar]

    def _merge_results(
        self,
        result1: SchemaDiscoveryResult,
        result2: SchemaDiscoveryResult,
        weight1: float,
        weight2: float,
    ) -> SchemaDiscoveryResult:
        """두 결과 병합"""
        # 엔티티 타입 병합 (중복 제거)
        entity_map: dict[str, EntityType] = {}
        for et in result1.entity_types:
            entity_map[et.name] = et
        for et in result2.entity_types:
            if et.name not in entity_map:
                entity_map[et.name] = et

        # 관계 타입 병합 (중복 제거)
        relation_map: dict[str, RelationType] = {}
        for rt in result1.relation_types:
            relation_map[rt.name] = rt
        for rt in result2.relation_types:
            if rt.name not in relation_map:
                relation_map[rt.name] = rt

        # 신뢰도 가중 평균
        confidence = (
            result1.confidence * weight1 + result2.confidence * weight2
        ) / (weight1 + weight2)

        return SchemaDiscoveryResult(
            entity_types=list(entity_map.values()),
            relation_types=list(relation_map.values()),
            confidence=confidence,
            similar_templates=(result1.similar_templates or [])
            + (result2.similar_templates or []),
            domain_summary=result1.domain_summary or result2.domain_summary,
        )
