"""
Prompt templates for multimodal content processing.

Contains all prompt templates used by modal processors for analyzing
different content types (images, tables, equations, etc.)
"""

from __future__ import annotations
from typing import Any

PROMPTS: dict[str, Any] = {}

# =============================================================================
# System Prompts
# =============================================================================

PROMPTS["IMAGE_ANALYSIS_SYSTEM"] = (
    "당신은 전문 이미지 분석가입니다. 이미지의 내용을 정확하고 상세하게 분석하여 설명하세요. "
    "이미지에 포함된 텍스트, 도형, 기호, 색상 등 모든 시각적 요소를 빠짐없이 파악하세요. "
    "반드시 {response_language}로 응답하세요."
)

PROMPTS["TABLE_ANALYSIS_SYSTEM"] = (
    "당신은 표 데이터를 정확하게 읽고 분석하는 전문가입니다. "
    "표의 구조를 파악하고, 모든 셀의 텍스트와 숫자를 정확히 읽어서 기록하세요. "
    "표에서 직접 읽은 데이터를 기반으로 인사이트를 도출하세요. "
    "반드시 {response_language}로만 응답하세요."
)

PROMPTS["EQUATION_ANALYSIS_SYSTEM"] = (
    "You are an expert mathematician. Provide detailed mathematical analysis. "
    "IMPORTANT: You MUST respond in {response_language}."
)

PROMPTS["GENERIC_ANALYSIS_SYSTEM"] = (
    "You are an expert content analyst specializing in {content_type} content. "
    "IMPORTANT: You MUST respond in {response_language}."
)

# =============================================================================
# Image Analysis Prompts
# =============================================================================

PROMPTS["vision_prompt"] = """**중요: 반드시 {response_language}로 응답하세요.**

이 이미지를 상세하게 분석하고 아래 JSON 형식으로 응답하세요:

{{
    "detailed_description": "이미지에 대한 포괄적이고 상세한 시각적 설명을 다음 지침에 따라 작성:
    - 이미지의 전체적인 구성과 레이아웃 설명
    - 이미지에 포함된 모든 객체, 인물, 텍스트, 시각적 요소 식별 및 설명
    - 이미지 내 텍스트가 있다면 정확하게 읽어서 기록
    - 요소들 간의 관계와 배치 설명
    - 차트, 다이어그램, 도식 등 기술적 내용이 있다면 상세히 설명
    - 대명사 대신 구체적인 명칭을 사용하여 명확하게 기술",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "image",
        "summary": "이미지의 핵심 내용과 의미를 간결하게 요약 (최대 100단어)"
    }}
}}

추가 정보:
- 이미지 경로: {image_path}
- 캡션: {captions}
- 각주: {footnotes}

지식 검색에 유용하도록 정확하고 상세한 시각적 분석을 제공하는 데 집중하세요."""

PROMPTS["vision_prompt_with_context"] = """**중요: 반드시 {response_language}로 응답하세요.**

주변 문맥을 고려하여 이 이미지를 상세하게 분석하고 아래 JSON 형식으로 응답하세요:

{{
    "detailed_description": "이미지에 대한 포괄적이고 상세한 시각적 설명을 다음 지침에 따라 작성:
    - 이미지의 전체적인 구성과 레이아웃 설명
    - 이미지에 포함된 모든 객체, 인물, 텍스트, 시각적 요소 식별 및 설명
    - 이미지 내 텍스트가 있다면 정확하게 읽어서 기록
    - 요소들 간의 관계와 주변 문맥과의 연관성 설명
    - 차트, 다이어그램, 도식 등 기술적 내용이 있다면 상세히 설명
    - 주변 내용과의 연결점이 있다면 언급
    - 대명사 대신 구체적인 명칭을 사용하여 명확하게 기술",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "image",
        "summary": "이미지의 핵심 내용, 의미, 그리고 주변 문맥과의 관계를 간결하게 요약 (최대 100단어)"
    }}
}}

주변 문맥 정보:
{context}

이미지 상세 정보:
- 이미지 경로: {image_path}
- 캡션: {captions}
- 각주: {footnotes}

문맥을 반영하여 지식 검색에 유용하도록 정확하고 상세한 시각적 분석을 제공하는 데 집중하세요."""

# =============================================================================
# Table Analysis Prompts
# =============================================================================

PROMPTS["table_prompt"] = """**중요: 반드시 {response_language}로 응답하세요.**

이 표 데이터를 분석하고 아래 JSON 형식으로 응답하세요:

{{
    "detailed_description": "표에 대한 상세 분석 내용을 다음 항목을 포함하여 작성:
    - 표의 구조 분석 (행/열 개수, 헤더 등)
    - 표의 헤더(열 제목) 정확히 기록
    - 각 행의 데이터를 순서대로 정확히 기록
    - 데이터 간의 관계 및 패턴 분석
    - 표가 전달하고자 하는 핵심 정보와 시사점
    - 특이사항이나 주목할 만한 데이터 포인트
    표에서 직접 읽은 구체적인 텍스트와 수치를 사용하세요.",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "table",
        "summary": "표의 목적과 핵심 내용을 요약 (최대 100단어)"
    }}
}}

표 정보:
- 표 제목/캡션: {table_caption}
- 표 데이터:
{table_body}
- 각주: {table_footnote}"""

PROMPTS["table_prompt_with_context"] = """**중요: 반드시 {response_language}로 응답하세요.**

주변 문맥을 고려하여 이 표 데이터를 분석하고 아래 JSON 형식으로 응답하세요:

{{
    "detailed_description": "표에 대한 상세 분석 내용을 다음 항목을 포함하여 작성:
    - 표의 구조 분석 (행/열 개수, 헤더 등)
    - 표의 헤더(열 제목) 정확히 기록
    - 각 행의 데이터를 순서대로 정확히 기록
    - 데이터 간의 관계 및 패턴 분석
    - 주변 문맥과의 연관성 및 표가 설명하는 내용
    - 표가 전달하고자 하는 핵심 정보와 시사점
    표에서 직접 읽은 구체적인 텍스트와 수치를 사용하세요.",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "table",
        "summary": "표의 목적, 핵심 내용, 그리고 주변 문맥과의 관계를 요약 (최대 100단어)"
    }}
}}

주변 문맥 정보:
{context}

표 정보:
- 표 제목/캡션: {table_caption}
- 표 데이터:
{table_body}
- 각주: {table_footnote}

주변 문맥을 참고하여 표의 의미를 정확하게 파악하세요."""

# =============================================================================
# Equation Analysis Prompts
# =============================================================================

PROMPTS["equation_prompt"] = """**IMPORTANT: Respond entirely in {response_language}.**

Please analyze this mathematical equation and provide a JSON response:

{{
    "detailed_description": "A comprehensive analysis including:
    - Mathematical meaning and interpretation
    - Variables and their definitions
    - Mathematical operations and functions used
    - Application domain and context
    - Physical or theoretical significance
    - Practical applications or use cases",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "equation",
        "summary": "concise summary of the equation's purpose and significance (max 100 words)"
    }}
}}

Equation: {equation_text}
Format: {equation_format}"""

PROMPTS["equation_prompt_with_context"] = """**IMPORTANT: Respond entirely in {response_language}.**

Please analyze this mathematical equation considering the surrounding context:

{{
    "detailed_description": "A comprehensive analysis including:
    - Mathematical meaning and interpretation
    - Variables and their definitions in context
    - Mathematical operations and functions used
    - Application domain based on surrounding material
    - Relationship to concepts mentioned in context
    - Practical applications or use cases",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "equation",
        "summary": "concise summary of the equation's purpose and role in context (max 100 words)"
    }}
}}

Context:
{context}

Equation: {equation_text}
Format: {equation_format}"""

# =============================================================================
# Generic Content Prompts
# =============================================================================

PROMPTS["generic_prompt"] = """**IMPORTANT: Respond entirely in {response_language}.**

Please analyze this {content_type} content and provide a JSON response:

{{
    "detailed_description": "A comprehensive analysis including:
    - Content structure and organization
    - Key information and elements
    - Relationships between components
    - Context and significance
    - Relevant details for knowledge retrieval",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "{content_type}",
        "summary": "concise summary of the content's purpose and key points (max 100 words)"
    }}
}}

Content: {content}"""

PROMPTS["generic_prompt_with_context"] = """**IMPORTANT: Respond entirely in {response_language}.**

Please analyze this {content_type} content considering the surrounding context:

{{
    "detailed_description": "A comprehensive analysis including:
    - Content structure and organization
    - Key information and elements
    - Relationships between components
    - Context and significance in relation to surrounding content
    - How this content connects to the broader discussion",
    "entity_info": {{
        "entity_name": "{entity_name}",
        "entity_type": "{content_type}",
        "summary": "concise summary of the content's purpose and relationship to context (max 100 words)"
    }}
}}

Context:
{context}

Content: {content}"""

# =============================================================================
# Modal Chunk Templates (stored in KG as text chunks)
# =============================================================================

PROMPTS["image_chunk"] = """이미지 분석 결과:
이미지 경로: {image_path}
캡션: {captions}
각주: {footnotes}

시각적 분석: {enhanced_caption}"""

PROMPTS["table_chunk"] = """표 분석 결과:
표 제목: {table_caption}
표 구조:
{table_body}
각주: {table_footnote}

분석 내용: {enhanced_caption}"""

PROMPTS["equation_chunk"] = """Mathematical Equation Analysis:
Equation: {equation_text}
Format: {equation_format}

Mathematical Analysis: {enhanced_caption}"""

PROMPTS["generic_chunk"] = """{content_type} Content Analysis:
Content: {content}

Analysis: {enhanced_caption}"""
