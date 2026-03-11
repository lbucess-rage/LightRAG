# Knowledge Graph Schema - 아키텍처 설계

## 1. 시스템 개요

### 1.1 목표
- 도메인 특화 엔티티/관계 타입을 통한 지식 그래프 품질 향상
- 자동화된 스키마 발견으로 사용자 부담 감소
- 유연한 스키마 관리로 다양한 도메인 지원

### 1.2 핵심 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                     Schema Management System                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Schema    │    │   Schema    │    │   Schema            │  │
│  │  Discovery  │───>│  Templates  │───>│  Application        │  │
│  │             │    │             │    │                     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│        │                  │                      │               │
│        ▼                  ▼                      ▼               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ LLM-based   │    │  Domain     │    │  LightRAG           │  │
│  │ Extraction  │    │  Library    │    │  addon_params       │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 데이터 모델

### 2.1 EntityType (엔티티 타입)

```python
@dataclass
class EntityType:
    name: str                    # 타입 이름 (예: "Customer")
    display_name: str            # 표시 이름 (예: "고객")
    description: str             # 설명
    examples: list[str]          # 예시 (예: ["구매자", "회원", "이용자"])
    color: str | None = None     # UI 표시 색상
    icon: str | None = None      # UI 아이콘

    # 추출 힌트
    extraction_hints: list[str] | None = None  # LLM 추출 힌트
    regex_patterns: list[str] | None = None    # 정규식 패턴 (선택)
```

### 2.2 RelationType (관계 타입)

```python
@dataclass
class RelationType:
    name: str                    # 관계 이름 (예: "SUBMITTED")
    display_name: str            # 표시 이름 (예: "접수함")
    description: str             # 설명

    # 방향성 정보
    source_types: list[str]      # 소스 엔티티 타입 (예: ["Customer"])
    target_types: list[str]      # 타겟 엔티티 타입 (예: ["InquiryType"])

    # 관계 특성
    is_directional: bool = True  # 방향성 여부
    cardinality: str = "N:M"     # 카디널리티 (1:1, 1:N, N:M)

    examples: list[str] | None = None  # 예시 문장
```

### 2.3 DomainSchema (도메인 스키마)

```python
@dataclass
class DomainSchema:
    domain: str                  # 도메인 식별자 (예: "contact_center")
    display_name: str            # 표시 이름 (예: "컨택센터 상담")
    description: str             # 도메인 설명

    entity_types: list[EntityType]
    relation_types: list[RelationType]

    # 메타데이터
    version: str = "1.0.0"
    created_at: datetime | None = None
    updated_at: datetime | None = None
    author: str | None = None

    # 부모 스키마 (상속)
    extends: list[str] | None = None  # 확장할 도메인 목록

    # 태그
    tags: list[str] | None = None  # 검색용 태그
```

### 2.4 SchemaDiscoveryResult (스키마 발견 결과)

```python
@dataclass
class SchemaDiscoveryResult:
    # 발견된 스키마
    entity_types: list[EntityType]
    relation_types: list[RelationType]

    # 분석 정보
    source_type: str             # "document" | "domain_keyword" | "hybrid"
    confidence: float            # 신뢰도 (0.0 ~ 1.0)

    # 샘플 추출 결과
    sample_entities: list[dict]  # 예시 엔티티
    sample_relations: list[dict] # 예시 관계

    # 추천 정보
    similar_templates: list[str] # 유사 도메인 템플릿
    suggestions: list[str]       # 개선 제안
```

---

## 3. 컴포넌트 설계

### 3.1 Schema Discovery Engine

```
┌─────────────────────────────────────────────────────────────┐
│                  Schema Discovery Engine                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Input                    Processing              Output     │
│  ─────                    ──────────              ──────     │
│                                                              │
│  ┌──────────┐      ┌─────────────────┐      ┌──────────┐   │
│  │Documents │─────>│  Text Sampling  │─────>│ Sampled  │   │
│  └──────────┘      └─────────────────┘      │ Chunks   │   │
│                                              └────┬─────┘   │
│  ┌──────────┐      ┌─────────────────┐           │         │
│  │ Domain   │─────>│ Template Lookup │───────────┤         │
│  │ Keywords │      └─────────────────┘           │         │
│  └──────────┘                                    ▼         │
│                    ┌─────────────────┐      ┌──────────┐   │
│                    │  LLM Analysis   │<─────│ Combined │   │
│                    │  (Prompts)      │      │ Context  │   │
│                    └────────┬────────┘      └──────────┘   │
│                             │                              │
│                             ▼                              │
│                    ┌─────────────────┐                     │
│                    │ Post-processing │                     │
│                    │ & Validation    │                     │
│                    └────────┬────────┘                     │
│                             │                              │
│                             ▼                              │
│                    ┌─────────────────┐                     │
│                    │ Discovery       │                     │
│                    │ Result          │                     │
│                    └─────────────────┘                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 처리 단계

1. **Text Sampling**: 대용량 문서에서 대표 청크 샘플링
2. **Template Lookup**: 키워드 기반 유사 템플릿 검색
3. **LLM Analysis**: 프롬프트 기반 스키마 추출
4. **Post-processing**: 정규화, 중복 제거, 검증

### 3.2 Schema Template Manager

```python
class SchemaTemplateManager:
    """도메인 스키마 템플릿 관리자"""

    def __init__(self, storage_path: str):
        self.storage_path = storage_path
        self.templates: dict[str, DomainSchema] = {}

    # CRUD 작업
    async def get_template(self, domain: str) -> DomainSchema | None
    async def list_templates(self, tags: list[str] = None) -> list[DomainSchema]
    async def create_template(self, schema: DomainSchema) -> bool
    async def update_template(self, domain: str, schema: DomainSchema) -> bool
    async def delete_template(self, domain: str) -> bool

    # 검색 및 추천
    async def search_templates(self, keywords: list[str]) -> list[DomainSchema]
    async def recommend_templates(self, text_sample: str) -> list[DomainSchema]

    # 병합 및 확장
    async def merge_schemas(self, domains: list[str]) -> DomainSchema
    async def extend_schema(self, base: str, extension: DomainSchema) -> DomainSchema
```

### 3.3 Schema Applier

```python
class SchemaApplier:
    """스키마를 LightRAG에 적용"""

    def __init__(self, lightrag: LightRAG):
        self.lightrag = lightrag

    async def apply_schema(self, schema: DomainSchema) -> bool:
        """스키마를 addon_params에 적용"""
        entity_types = [et.name for et in schema.entity_types]
        self.lightrag.addon_params["entity_types"] = entity_types
        return True

    async def apply_for_document(
        self,
        schema: DomainSchema,
        document: str
    ) -> str:
        """특정 문서에 스키마를 적용하여 삽입"""
        original_types = self.lightrag.addon_params.get("entity_types", [])
        try:
            await self.apply_schema(schema)
            track_id = await self.lightrag.ainsert(document)
            return track_id
        finally:
            self.lightrag.addon_params["entity_types"] = original_types
```

---

## 4. 데이터 흐름

### 4.1 스키마 발견 흐름

```
사용자 요청
    │
    ├─── 문서 업로드 ───┐
    │                   │
    └─── 도메인 선택 ───┼───> Schema Discovery Engine
                        │            │
                        │            ▼
                        │     ┌──────────────┐
                        │     │ LLM 분석     │
                        │     └──────┬───────┘
                        │            │
                        │            ▼
                        │     ┌──────────────┐
                        └────>│ 결과 생성    │
                              └──────┬───────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ 사용자 검토  │
                              │ & 수정       │
                              └──────┬───────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ 스키마 저장  │
                              │ (선택적)     │
                              └──────┬───────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ LightRAG     │
                              │ 적용         │
                              └──────────────┘
```

### 4.2 문서 삽입 시 스키마 적용 흐름

```
문서 삽입 요청
    │
    ├─── schema_id 지정됨? ───┐
    │         │               │
    │        YES             NO
    │         │               │
    │         ▼               ▼
    │  ┌─────────────┐  ┌─────────────┐
    │  │ 템플릿 로드 │  │ 기본 스키마 │
    │  └──────┬──────┘  │ 사용        │
    │         │         └──────┬──────┘
    │         ▼                │
    │  ┌─────────────┐         │
    │  │ addon_params│         │
    │  │ 임시 변경   │         │
    │  └──────┬──────┘         │
    │         │                │
    │         ▼                │
    │  ┌─────────────┐         │
    └─>│ ainsert()   │<────────┘
       │ 실행        │
       └──────┬──────┘
              │
              ▼
       ┌─────────────┐
       │ addon_params│
       │ 복원        │
       └─────────────┘
```

---

## 5. 저장소 설계

### 5.1 스키마 템플릿 저장

#### 옵션 A: 파일 시스템 (권장 - 초기)

```
lightrag/
└── schema/
    └── templates/
        ├── contact_center.json
        ├── delivery_service.json
        ├── ev_charging.json
        └── ecommerce.json
```

#### 옵션 B: PostgreSQL (확장 시)

```sql
CREATE TABLE lightrag_schema_templates (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200),
    description TEXT,
    schema_data JSONB NOT NULL,
    version VARCHAR(20) DEFAULT '1.0.0',
    tags TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schema_templates_tags ON lightrag_schema_templates USING GIN(tags);
```

### 5.2 스키마 사용 이력

```sql
CREATE TABLE lightrag_schema_usage (
    id SERIAL PRIMARY KEY,
    doc_id VARCHAR(100) NOT NULL,
    schema_domain VARCHAR(100),
    entity_types TEXT[],
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (doc_id) REFERENCES lightrag_doc_status(id)
);
```

---

## 6. 확장 포인트

### 6.1 ainsert() 확장 제안

```python
# 현재
async def ainsert(
    self,
    input: str | list[str],
    ...
) -> str:

# 확장 제안
async def ainsert(
    self,
    input: str | list[str],
    ...
    schema: str | DomainSchema | None = None,  # 스키마 지정
    auto_discover_schema: bool = False,         # 자동 스키마 발견
) -> str:
```

### 6.2 Query 확장 제안

```python
# 엔티티 타입 필터링 쿼리
async def aquery(
    self,
    query: str,
    ...
    entity_type_filter: list[str] | None = None,  # 특정 타입만 검색
) -> str:
```

---

## 7. 보안 고려사항

### 7.1 입력 검증
- 스키마 이름: 영문, 숫자, 언더스코어만 허용
- 설명 필드: XSS 방지를 위한 이스케이프
- 파일 업로드: 크기 제한, 타입 검증

### 7.2 접근 제어
- 스키마 생성/수정: 인증된 사용자만
- 스키마 조회: 공개/비공개 설정 가능
- 시스템 템플릿: 수정 불가 (읽기 전용)
