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
    DOMAIN_KEYWORD_DISCOVERY_SYSTEM_PROMPT,
    DOMAIN_KEYWORD_DISCOVERY_USER_PROMPT,
    DEFAULT_ENTITY_TYPES,
    DEFAULT_RELATION_TYPES,
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

        # LLM 호출 + 파싱 (파싱 실패 시 1회 재시도)
        result = await self._call_and_parse(
            user_prompt,
            SCHEMA_DISCOVERY_SYSTEM_PROMPT,
            context="documents",
        )
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

        # Merge with default common types if requested
        include_common_types = options.get("include_common_types", False)
        if include_common_types:
            result = self._merge_with_common_types(result)
            logger.info(
                f"After merging common types: {len(result.entity_types)} entity types, "
                f"{len(result.relation_types)} relation types"
            )

        return result

    async def discover_from_domain(
        self,
        domains: list[str],
        options: Optional[dict[str, Any]] = None,
    ) -> SchemaDiscoveryResult:
        """도메인 키워드에서 스키마 생성

        LLM을 사용하여 도메인 키워드 기반 스키마를 생성합니다.
        기존 템플릿이 있으면 참고하여 보완합니다.

        Args:
            domains: 도메인 키워드 목록
            options: 옵션
                - max_entity_types: 최대 엔티티 타입 수 (기본: 30)
                - max_relation_types: 최대 관계 타입 수 (기본: 25)
                - language: 출력 언어 (기본: Korean)
                - use_templates: 기존 템플릿 참조 여부 (기본: True)

        Returns:
            SchemaDiscoveryResult
        """
        options = options or {}
        max_entity_types = options.get("max_entity_types", 30)
        max_relation_types = options.get("max_relation_types", 25)
        language = options.get("language", "Korean")
        use_templates = options.get("use_templates", True)

        logger.info(f"Discovering schema from domain keywords: {domains}")

        # 기존 템플릿 확인 (참조용)
        similar_templates = []
        if use_templates:
            try:
                merged = await self.template_manager.merge_schemas(
                    domains, merge_strategy="union"
                )
                if merged:
                    similar_templates = domains
                    logger.info(f"Found existing templates for reference: {domains}")
            except Exception:
                pass

        # LLM을 사용하여 스키마 생성
        keywords_text = "\n".join([f"- {kw}" for kw in domains])

        user_prompt = DOMAIN_KEYWORD_DISCOVERY_USER_PROMPT.format(
            domain_keywords=keywords_text,
            max_entity_types=max_entity_types,
            max_relation_types=max_relation_types,
            language=language,
        )

        logger.debug(f"Calling LLM for domain keyword discovery...")

        # LLM 호출 + 파싱 (파싱 실패 시 1회 재시도)
        result = await self._call_and_parse(
            user_prompt,
            DOMAIN_KEYWORD_DISCOVERY_SYSTEM_PROMPT,
            context="domain keywords",
        )
        result.source_type = "domain_keyword"
        result.similar_templates = similar_templates

        logger.info(
            f"Generated {len(result.entity_types)} entity types, "
            f"{len(result.relation_types)} relation types from keywords: {domains}"
        )

        # Merge with default common types if requested
        include_common_types = options.get("include_common_types", False)
        if include_common_types:
            result = self._merge_with_common_types(result)
            logger.info(
                f"After merging common types: {len(result.entity_types)} entity types, "
                f"{len(result.relation_types)} relation types"
            )

        return result

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

    async def _call_and_parse(
        self,
        user_prompt: str,
        system_prompt: str,
        context: str,
    ) -> SchemaDiscoveryResult:
        """LLM 호출 후 응답을 파싱한다. 파싱 실패 시 1회 재시도.

        재시도 시에는 "유효한 JSON만 반환하라"는 강화 지시를 덧붙여 호출한다.
        """
        # 1차 호출
        try:
            response = await self.llm_func(user_prompt, system_prompt=system_prompt)
        except Exception as e:
            logger.error(f"LLM call failed ({context}): {e}")
            raise RuntimeError(f"Schema discovery failed: {e}")

        try:
            return self._parse_llm_response(response)
        except ValueError as parse_err:
            logger.warning(
                f"First parse attempt failed ({context}): {parse_err}. Retrying with stricter prompt..."
            )

        # 2차 호출 (강화 지시)
        retry_prompt = (
            user_prompt
            + "\n\n[매우 중요] 응답은 반드시 **유효한 JSON 객체만** 포함해야 합니다. "
            "앞뒤에 설명, 주석, 코드 블록 표기(```) 없이 순수 JSON만 출력하세요. "
            "모든 문자열은 쌍따옴표(\")를 사용하고, 마지막 항목 뒤에 쉼표를 넣지 마세요."
        )
        try:
            response = await self.llm_func(retry_prompt, system_prompt=system_prompt)
        except Exception as e:
            logger.error(f"LLM retry call failed ({context}): {e}")
            raise RuntimeError(f"Schema discovery retry failed: {e}")

        try:
            return self._parse_llm_response(response)
        except ValueError as parse_err:
            logger.error(
                f"Schema discovery failed after retry ({context}): {parse_err}"
            )
            raise ValueError(
                "LLM이 유효한 JSON 스키마를 반환하지 못했습니다. "
                "문서 양이 너무 많거나 형식이 복잡할 수 있습니다. "
                "문서를 분할하거나 다시 시도해 주세요."
            )

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

        # 관계 타입 유효성 검증 및 수정
        entity_types, relation_types = self._validate_and_fix_schema(
            entity_types, relation_types
        )

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

        # 관계 타입 유효성 검증 및 수정
        entity_types, relation_types = self._validate_and_fix_schema(
            entity_types, relation_types
        )

        return SchemaDiscoveryResult(
            entity_types=entity_types,
            relation_types=relation_types,
            confidence=0.9,  # 개선된 스키마는 신뢰도 높음
        )

    def _extract_json(self, text: str) -> dict:
        """텍스트에서 JSON 추출

        파싱 전략:
        1) ```json ... ``` 코드 블록 우선
        2) brace-counting으로 첫 균형 잡힌 {...} 블록 추출
        3) (1)/(2) 실패 시 공통 오류(trailing comma, 끝 누락, 홑따옴표 등) 복구 재시도
        """
        candidates: list[str] = []

        # 1) 코드 블록 내 JSON
        code_block_match = re.search(r"```json?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
        if code_block_match:
            candidates.append(code_block_match.group(1).strip())

        # 2) brace-counting으로 균형 잡힌 JSON 블록 추출
        balanced = self._find_balanced_json(text)
        if balanced:
            candidates.append(balanced)

        # 3) fallback: 탐욕적 매칭
        greedy_match = re.search(r"\{[\s\S]*\}", text)
        if greedy_match:
            candidates.append(greedy_match.group(0))

        last_error: Optional[Exception] = None
        for idx, candidate in enumerate(candidates):
            try:
                return json.loads(candidate)
            except json.JSONDecodeError as e:
                last_error = e
                # 공통 오류 복구 시도
                repaired = self._repair_json(candidate)
                if repaired is not None and repaired != candidate:
                    try:
                        result = json.loads(repaired)
                        logger.info(
                            f"JSON repaired successfully (candidate {idx}, error: {e.msg})"
                        )
                        return result
                    except json.JSONDecodeError as e2:
                        last_error = e2

        if last_error is not None:
            # 실패 시 응답 샘플을 로그에 남겨 디버깅에 사용
            preview_head = text[:500]
            preview_tail = text[-500:] if len(text) > 500 else ""
            logger.warning(
                f"Failed to parse JSON from LLM response ({len(text)} chars). "
                f"Error: {last_error}. Head: {preview_head!r} ... Tail: {preview_tail!r}"
            )
            raise ValueError(
                f"LLM 응답에서 유효한 JSON을 찾지 못했습니다 ({last_error})"
            )

        raise ValueError("LLM 응답에 JSON 구조가 포함되지 않았습니다")

    @staticmethod
    def _find_balanced_json(text: str) -> Optional[str]:
        """brace-counting으로 첫 번째 균형 잡힌 {...} 블록을 찾는다.

        문자열 리터럴 내부의 중괄호를 올바르게 건너뛰며,
        이스케이프 문자(`\\"`)도 처리한다.
        """
        start = text.find("{")
        if start == -1:
            return None

        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        return None

    @staticmethod
    def _repair_json(text: str) -> Optional[str]:
        """흔한 JSON 형식 오류를 자동 복구한다.

        - trailing comma 제거: `,}` / `,]`
        - 끝부분 누락된 닫는 괄호 보충
        - 홑따옴표로 감싼 문자열을 쌍따옴표로 변환 (제한적)
        """
        repaired = text

        # 1) trailing comma 제거
        repaired = re.sub(r",\s*([}\]])", r"\1", repaired)

        # 2) 끝 부분 닫는 괄호 보충 (open-count > close-count인 경우)
        open_curly = repaired.count("{")
        close_curly = repaired.count("}")
        open_square = repaired.count("[")
        close_square = repaired.count("]")

        # 문자열 내부 중괄호는 카운트에서 제외 (대략적 추정)
        # 단순 보정: 부족한 만큼 끝에 추가
        if open_curly > close_curly:
            repaired = repaired.rstrip().rstrip(",")
            repaired += "}" * (open_curly - close_curly)
        if open_square > close_square:
            repaired = repaired.rstrip().rstrip(",")
            repaired += "]" * (open_square - close_square)

        # 3) 홑따옴표 키/값을 쌍따옴표로 (키 패턴만 제한적으로)
        repaired = re.sub(r"(?<=[{,])\s*'([^']+)'\s*:", r'"\1":', repaired)

        return repaired if repaired != text else None

    def _validate_and_fix_schema(
        self,
        entity_types: list[EntityType],
        relation_types: list[RelationType],
    ) -> tuple[list[EntityType], list[RelationType]]:
        """스키마 유효성 검증 및 수정

        관계 타입의 source_types/target_types에서 참조하는 엔티티 타입이
        실제로 존재하는지 확인하고, 누락된 엔티티를 자동으로 추가합니다.

        Args:
            entity_types: 엔티티 타입 목록
            relation_types: 관계 타입 목록

        Returns:
            수정된 (엔티티 타입 목록, 관계 타입 목록)
        """
        # 기존 엔티티 타입 이름 집합
        entity_names = {et.name for et in entity_types}

        # 관계에서 참조하는 모든 엔티티 타입 수집
        referenced_types: set[str] = set()
        for rt in relation_types:
            referenced_types.update(rt.source_types)
            referenced_types.update(rt.target_types)

        # 누락된 엔티티 타입 찾기
        missing_types = referenced_types - entity_names

        if missing_types:
            logger.info(
                f"Found {len(missing_types)} missing entity types referenced in relations: "
                f"{missing_types}"
            )

            # 누락된 엔티티 타입을 자동으로 추가
            for missing_name in missing_types:
                new_entity = EntityType(
                    name=missing_name,
                    display_name=missing_name,
                    description=f"Auto-generated entity type referenced in relations",
                    examples=[],
                )
                entity_types.append(new_entity)
                logger.debug(f"Auto-added missing entity type: {missing_name}")

        # 관계 타입의 source_types/target_types 정리 (빈 값 제거)
        valid_relation_types = []
        for rt in relation_types:
            # 빈 source_types나 target_types가 있는 관계는 제외
            if rt.source_types and rt.target_types:
                valid_relation_types.append(rt)
            else:
                logger.warning(
                    f"Removed relation type '{rt.name}' due to empty source or target types"
                )

        return entity_types, valid_relation_types

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

    def _merge_with_common_types(
        self,
        result: SchemaDiscoveryResult,
    ) -> SchemaDiscoveryResult:
        """Merge discovery result with default common entity/relation types.

        This adds common contact center entity types and relation types
        that may not have been discovered from the documents but are
        generally useful in the domain.

        Args:
            result: Original discovery result

        Returns:
            SchemaDiscoveryResult with merged common types
        """
        # Get existing type names (case-insensitive)
        existing_entity_names = {et.name.lower() for et in result.entity_types}
        existing_relation_names = {rt.name.lower() for rt in result.relation_types}

        # Add default entity types that don't already exist
        merged_entity_types = list(result.entity_types)
        for default_et in DEFAULT_ENTITY_TYPES:
            if default_et["name"].lower() not in existing_entity_names:
                merged_entity_types.append(
                    EntityType(
                        name=default_et["name"],
                        display_name=default_et["display_name"],
                        description=default_et["description"],
                        examples=default_et.get("examples", []),
                    )
                )

        # Add default relation types that don't already exist
        merged_relation_types = list(result.relation_types)
        for default_rt in DEFAULT_RELATION_TYPES:
            if default_rt["name"].lower() not in existing_relation_names:
                merged_relation_types.append(
                    RelationType(
                        name=default_rt["name"],
                        display_name=default_rt["display_name"],
                        description=default_rt["description"],
                        source_types=default_rt["source_types"],
                        target_types=default_rt["target_types"],
                    )
                )

        return SchemaDiscoveryResult(
            entity_types=merged_entity_types,
            relation_types=merged_relation_types,
            source_type=result.source_type,
            confidence=result.confidence,
            similar_templates=result.similar_templates,
            suggestions=result.suggestions,
            domain_summary=result.domain_summary,
        )

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
