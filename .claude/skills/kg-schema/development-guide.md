# Knowledge Graph Schema - 개발 가이드

## 1. 개발 환경

### 1.1 프로젝트 구조

```
/home/kms-rag/LightRAG/
├── lightrag/
│   ├── api/
│   │   ├── routers/
│   │   │   ├── schema_routes.py      # [신규] Schema API
│   │   │   └── ...
│   │   └── lightrag_server.py        # 라우터 등록
│   ├── schema/                        # [신규] Schema 모듈
│   │   ├── __init__.py
│   │   ├── models.py                  # 데이터 모델
│   │   ├── discovery.py               # 스키마 발견 엔진
│   │   ├── templates.py               # 템플릿 관리
│   │   ├── prompts.py                 # LLM 프롬프트
│   │   └── applier.py                 # 스키마 적용
│   ├── prompt.py                      # 기존 프롬프트
│   └── lightrag.py                    # 메인 클래스
│
├── lightrag_webui/
│   └── src/
│       ├── features/
│       │   └── SchemaManager.tsx      # [신규]
│       ├── components/
│       │   └── schema/                # [신규]
│       ├── api/
│       │   └── schema.ts              # [신규]
│       └── stores/
│           └── schema.ts              # [신규]
│
└── .claude/skills/kg-schema/          # 이 스킬
```

### 1.2 기술 스택

**Backend:**
- Python 3.11+
- FastAPI
- Pydantic v2
- asyncio

**Frontend:**
- React 18
- TypeScript
- Zustand (상태 관리)
- Tailwind CSS
- shadcn/ui

---

## 2. Phase 1: 기반 구축

### 2.1 데이터 모델 구현

**파일**: `lightrag/schema/models.py`

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

@dataclass
class EntityType:
    """엔티티 타입 정의"""
    name: str
    display_name: str
    description: str
    examples: list[str] = field(default_factory=list)
    color: Optional[str] = None
    icon: Optional[str] = None
    extraction_hints: Optional[list[str]] = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "examples": self.examples,
            "color": self.color,
            "icon": self.icon,
        }

@dataclass
class RelationType:
    """관계 타입 정의"""
    name: str
    display_name: str
    description: str
    source_types: list[str]
    target_types: list[str]
    is_directional: bool = True
    cardinality: str = "N:M"
    examples: Optional[list[str]] = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "source_types": self.source_types,
            "target_types": self.target_types,
        }

@dataclass
class DomainSchema:
    """도메인 스키마"""
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

    def get_entity_type_names(self) -> list[str]:
        return [et.name for et in self.entity_types]

    def to_dict(self) -> dict:
        return {
            "domain": self.domain,
            "display_name": self.display_name,
            "description": self.description,
            "entity_types": [et.to_dict() for et in self.entity_types],
            "relation_types": [rt.to_dict() for rt in self.relation_types],
            "version": self.version,
            "tags": self.tags,
        }
```

### 2.2 템플릿 저장소 구현

**파일**: `lightrag/schema/templates.py`

```python
import json
from pathlib import Path
from typing import Optional
from .models import DomainSchema, EntityType, RelationType

class SchemaTemplateManager:
    """스키마 템플릿 관리자"""

    def __init__(self, templates_dir: str = None):
        if templates_dir is None:
            # 기본 경로: lightrag/schema/templates/
            self.templates_dir = Path(__file__).parent / "templates"
        else:
            self.templates_dir = Path(templates_dir)

        self.templates_dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, DomainSchema] = {}

    async def get_template(self, domain: str) -> Optional[DomainSchema]:
        """템플릿 조회"""
        if domain in self._cache:
            return self._cache[domain]

        template_path = self.templates_dir / f"{domain}.json"
        if not template_path.exists():
            return None

        with open(template_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        schema = self._parse_schema(data)
        self._cache[domain] = schema
        return schema

    async def list_templates(self, tags: list[str] = None) -> list[DomainSchema]:
        """템플릿 목록 조회"""
        templates = []
        for path in self.templates_dir.glob("*.json"):
            schema = await self.get_template(path.stem)
            if schema:
                if tags is None or any(t in schema.tags for t in tags):
                    templates.append(schema)
        return templates

    async def save_template(self, schema: DomainSchema) -> bool:
        """템플릿 저장"""
        template_path = self.templates_dir / f"{schema.domain}.json"
        with open(template_path, "w", encoding="utf-8") as f:
            json.dump(schema.to_dict(), f, ensure_ascii=False, indent=2)

        self._cache[schema.domain] = schema
        return True

    def _parse_schema(self, data: dict) -> DomainSchema:
        """JSON을 DomainSchema로 파싱"""
        entity_types = [
            EntityType(**et) for et in data.get("entity_types", [])
        ]
        relation_types = [
            RelationType(**rt) for rt in data.get("relation_types", [])
        ]
        return DomainSchema(
            domain=data["domain"],
            display_name=data["display_name"],
            description=data["description"],
            entity_types=entity_types,
            relation_types=relation_types,
            version=data.get("version", "1.0.0"),
            tags=data.get("tags", []),
        )
```

---

## 3. Phase 2: Schema Discovery API

### 3.1 Discovery 엔진 구현

**파일**: `lightrag/schema/discovery.py`

```python
import json
import re
from typing import Callable, Optional
from .models import DomainSchema, EntityType, RelationType
from .prompts import SCHEMA_DISCOVERY_SYSTEM_PROMPT, SCHEMA_DISCOVERY_USER_PROMPT

class SchemaDiscoveryEngine:
    """스키마 발견 엔진"""

    def __init__(self, llm_func: Callable):
        self.llm_func = llm_func

    async def discover_from_documents(
        self,
        documents: list[str],
        options: dict = None
    ) -> dict:
        """문서에서 스키마 발견"""
        options = options or {}
        max_entity_types = options.get("max_entity_types", 15)
        max_relation_types = options.get("max_relation_types", 20)
        language = options.get("language", "Korean")
        domain_hints = options.get("domain_hints", "")

        # 문서 샘플 준비
        sample_size = min(options.get("sample_size", 5), len(documents))
        samples = documents[:sample_size]
        document_text = "\n\n--- 문서 ---\n".join(samples)

        # 프롬프트 생성
        user_prompt = SCHEMA_DISCOVERY_USER_PROMPT.format(
            document_samples=document_text,
            max_entity_types=max_entity_types,
            max_relation_types=max_relation_types,
            language=language,
            domain_hints=domain_hints,
        )

        # LLM 호출
        response = await self.llm_func(
            user_prompt,
            system_prompt=SCHEMA_DISCOVERY_SYSTEM_PROMPT,
        )

        # 결과 파싱
        result = self._parse_response(response)
        result["source_type"] = "document"

        return result

    def _parse_response(self, response: str) -> dict:
        """LLM 응답 파싱"""
        # JSON 추출
        json_match = re.search(r'```json?\s*([\s\S]*?)\s*```', response)
        if json_match:
            data = json.loads(json_match.group(1))
        else:
            json_match = re.search(r'\{[\s\S]*\}', response)
            if json_match:
                data = json.loads(json_match.group(0))
            else:
                raise ValueError("JSON not found in response")

        return data
```

### 3.2 API 라우터 구현

**파일**: `lightrag/api/routers/schema_routes.py`

```python
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

# Request/Response 모델
class DiscoverFromDocumentRequest(BaseModel):
    documents: list[dict]  # {"content": str, "file_path": str}
    options: Optional[dict] = None

class DiscoverResponse(BaseModel):
    success: bool
    data: dict

class TemplateResponse(BaseModel):
    success: bool
    data: dict

# 엔드포인트
@router.post("/discover/from-document", response_model=DiscoverResponse)
async def discover_from_document(request: DiscoverFromDocumentRequest):
    """문서 기반 스키마 발견"""
    try:
        # SchemaDiscoveryEngine 사용
        # ... 구현
        pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/templates", response_model=TemplateResponse)
async def list_templates(tags: Optional[str] = None):
    """템플릿 목록 조회"""
    try:
        # SchemaTemplateManager 사용
        # ... 구현
        pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/templates/{domain}", response_model=TemplateResponse)
async def get_template(domain: str):
    """템플릿 상세 조회"""
    try:
        # ... 구현
        pass
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Template not found: {domain}")
```

### 3.3 라우터 등록

**파일**: `lightrag/api/lightrag_server.py` (수정)

```python
# 기존 import에 추가
from lightrag.api.routers.schema_routes import router as schema_router

# 라우터 등록 부분에 추가
app.include_router(schema_router, prefix="/api/schema", tags=["Schema"])
```

---

## 4. Phase 3: WebUI 개발

### 4.1 API 클라이언트

**파일**: `lightrag_webui/src/api/schema.ts`

```typescript
import { api } from './base';

export interface EntityType {
  name: string;
  display_name: string;
  description: string;
  examples: string[];
  color?: string;
  icon?: string;
}

export interface RelationType {
  name: string;
  display_name: string;
  description: string;
  source_types: string[];
  target_types: string[];
}

export interface DomainSchema {
  domain: string;
  display_name: string;
  description: string;
  entity_types: EntityType[];
  relation_types: RelationType[];
  version: string;
  tags: string[];
}

export interface DiscoveryResult {
  entity_types: EntityType[];
  relation_types: RelationType[];
  sample_extractions?: any[];
  confidence: number;
}

// API 함수
export async function discoverSchema(
  documents: { content: string; file_path: string }[],
  options?: any
): Promise<DiscoveryResult> {
  const response = await api.post('/schema/discover/from-document', {
    documents,
    options,
  });
  return response.data.data;
}

export async function listTemplates(tags?: string[]): Promise<DomainSchema[]> {
  const params = tags ? { tags: tags.join(',') } : {};
  const response = await api.get('/schema/templates', { params });
  return response.data.data.templates;
}

export async function getTemplate(domain: string): Promise<DomainSchema> {
  const response = await api.get(`/schema/templates/${domain}`);
  return response.data.data;
}

export async function applySchema(schema: DomainSchema | string): Promise<void> {
  const body = typeof schema === 'string'
    ? { source: 'template', domain: schema }
    : { source: 'custom', ...schema };
  await api.post('/schema/apply/current', body);
}
```

### 4.2 상태 관리

**파일**: `lightrag_webui/src/stores/schema.ts`

```typescript
import { create } from 'zustand';
import { DomainSchema, DiscoveryResult } from '@/api/schema';

interface SchemaState {
  // 현재 스키마
  currentSchema: DomainSchema | null;
  currentSchemaSource: string | null;

  // 발견 결과
  discoveryResult: DiscoveryResult | null;
  isDiscovering: boolean;

  // 템플릿
  templates: DomainSchema[];
  isLoadingTemplates: boolean;

  // 액션
  setCurrentSchema: (schema: DomainSchema, source: string) => void;
  resetToDefault: () => void;
  setDiscoveryResult: (result: DiscoveryResult | null) => void;
  setIsDiscovering: (value: boolean) => void;
  setTemplates: (templates: DomainSchema[]) => void;
  setIsLoadingTemplates: (value: boolean) => void;
}

export const useSchemaStore = create<SchemaState>((set) => ({
  currentSchema: null,
  currentSchemaSource: null,
  discoveryResult: null,
  isDiscovering: false,
  templates: [],
  isLoadingTemplates: false,

  setCurrentSchema: (schema, source) =>
    set({ currentSchema: schema, currentSchemaSource: source }),

  resetToDefault: () =>
    set({ currentSchema: null, currentSchemaSource: null }),

  setDiscoveryResult: (result) =>
    set({ discoveryResult: result }),

  setIsDiscovering: (value) =>
    set({ isDiscovering: value }),

  setTemplates: (templates) =>
    set({ templates }),

  setIsLoadingTemplates: (value) =>
    set({ isLoadingTemplates: value }),
}));
```

### 4.3 메인 컴포넌트

**파일**: `lightrag_webui/src/features/SchemaManager.tsx`

```tsx
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SchemaDiscovery } from '@/components/schema/SchemaDiscovery';
import { TemplateLibrary } from '@/components/schema/TemplateLibrary';
import { SchemaEditor } from '@/components/schema/SchemaEditor';
import { CurrentSchema } from '@/components/schema/CurrentSchema';

export function SchemaManager() {
  const [activeTab, setActiveTab] = useState('discovery');

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Schema Manager</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="discovery">Discovery</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="current">Current</TabsTrigger>
        </TabsList>

        <TabsContent value="discovery">
          <SchemaDiscovery />
        </TabsContent>

        <TabsContent value="templates">
          <TemplateLibrary />
        </TabsContent>

        <TabsContent value="editor">
          <SchemaEditor />
        </TabsContent>

        <TabsContent value="current">
          <CurrentSchema />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

---

## 5. 테스트

### 5.1 단위 테스트

**파일**: `tests/test_schema_discovery.py`

```python
import pytest
from lightrag.schema.discovery import SchemaDiscoveryEngine
from lightrag.schema.models import DomainSchema

@pytest.fixture
def mock_llm_func():
    async def _mock(prompt, system_prompt=None):
        return '''```json
{
  "entity_types": [
    {"name": "Customer", "display_name": "고객", "description": "테스트", "examples": []}
  ],
  "relation_types": []
}
```'''
    return _mock

@pytest.mark.asyncio
async def test_discover_from_documents(mock_llm_func):
    engine = SchemaDiscoveryEngine(mock_llm_func)
    result = await engine.discover_from_documents(["테스트 문서"])

    assert "entity_types" in result
    assert len(result["entity_types"]) > 0
    assert result["entity_types"][0]["name"] == "Customer"
```

### 5.2 API 테스트

```bash
# 템플릿 목록 조회
curl http://localhost:9621/api/schema/templates

# 스키마 발견
curl -X POST http://localhost:9621/api/schema/discover/from-document \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [{"content": "고객이 오배송 문의를 했습니다.", "file_path": "test.txt"}],
    "options": {"max_entity_types": 10}
  }'
```

---

## 6. 체크리스트

### Phase 1
- [ ] `lightrag/schema/` 디렉토리 생성
- [ ] `models.py` 구현
- [ ] `templates.py` 구현
- [ ] 기본 템플릿 JSON 파일 생성 (contact_center.json 등)

### Phase 2
- [ ] `discovery.py` 구현
- [ ] `prompts.py` 구현
- [ ] `schema_routes.py` 구현
- [ ] `lightrag_server.py`에 라우터 등록
- [ ] API 테스트

### Phase 3
- [ ] `schema.ts` API 클라이언트 구현
- [ ] `schema.ts` 상태 관리 구현
- [ ] `SchemaManager.tsx` 구현
- [ ] 하위 컴포넌트 구현
- [ ] 라우팅 추가

### Phase 4
- [ ] `ainsert()` 확장
- [ ] 문서별 스키마 기록
- [ ] 통계 기능

---

## 7. 참고 명령어

```bash
# 백엔드 서버 시작
cd /home/kms-rag/LightRAG
source .venv/bin/activate
python -m lightrag.api.lightrag_server

# 프론트엔드 개발 서버
cd /home/kms-rag/LightRAG/lightrag_webui
npm run dev

# 테스트 실행
pytest tests/test_schema_*.py -v
```
