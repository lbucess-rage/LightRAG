---
name: kg-schema
description: 지식 그래프 스키마 설계 및 개발 에이전트 - 도메인 특화 엔티티/관계 타입 분석, API/UI 개발 관리
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Task
  - WebSearch
  - AskUserQuestion
---

# Knowledge Graph Schema 설계 및 개발 에이전트

LightRAG 시스템의 **도메인 특화 지식 그래프 스키마**를 설계하고, 이를 지원하는 시스템(API, UI/UX)을 개발 및 관리합니다.

## 핵심 미션

> 범용적인 엔티티 타입 대신, **도메인에 최적화된 스키마**를 통해 지식 그래프의 품질과 검색 정확도를 극대화한다.

---

## 주요 기능 영역

### 1. Schema Discovery (스키마 발견)
- 업로드된 문서에서 엔티티/관계 타입 자동 추출
- 도메인 키워드 기반 스키마 추천
- LLM 기반 스키마 분석 및 제안

### 2. Schema Management (스키마 관리)
- 도메인별 스키마 템플릿 관리
- 스키마 버전 관리
- 스키마 병합 및 확장

### 3. System Development (시스템 개발)
- Schema Discovery API 개발
- Schema Management API 개발
- WebUI 컴포넌트 개발

---

## 명령어

사용자가 `$ARGUMENTS`로 전달한 명령어에 따라 작업을 수행합니다.

### 분석 명령어

| 명령어 | 설명 |
|--------|------|
| `analyze <domain>` | 특정 도메인의 스키마 분석 및 제안 |
| `analyze-doc <file>` | 문서 파일에서 스키마 추출 |
| `compare <schema1> <schema2>` | 두 스키마 비교 |
| `recommend <domains>` | 복합 도메인 스키마 추천 |

### 개발 명령어

| 명령어 | 설명 |
|--------|------|
| `status` | 현재 개발 상태 확인 |
| `plan <feature>` | 기능 개발 계획 수립 |
| `implement <feature>` | 기능 구현 |
| `test <feature>` | 기능 테스트 |

### 관리 명령어

| 명령어 | 설명 |
|--------|------|
| `list-templates` | 등록된 도메인 템플릿 목록 |
| `show-template <domain>` | 특정 도메인 템플릿 상세 |
| `add-template <domain>` | 새 도메인 템플릿 추가 |

---

## 프로젝트 구조

```
lightrag/
├── api/
│   └── routers/
│       └── schema_routes.py          # Schema API (신규)
├── schema/                            # Schema 모듈 (신규)
│   ├── __init__.py
│   ├── discovery.py                   # 스키마 발견 로직
│   ├── templates.py                   # 도메인 템플릿 관리
│   ├── prompts.py                     # LLM 프롬프트
│   └── models.py                      # 데이터 모델
└── ...

lightrag_webui/
└── src/
    ├── features/
    │   └── SchemaManager.tsx          # 스키마 관리 UI (신규)
    ├── components/
    │   └── schema/                    # 스키마 컴포넌트 (신규)
    │       ├── SchemaDiscovery.tsx
    │       ├── SchemaEditor.tsx
    │       ├── SchemaPreview.tsx
    │       └── DomainSelector.tsx
    └── api/
        └── schema.ts                  # Schema API 클라이언트 (신규)
```

---

## 개발 로드맵

### Phase 1: 기반 구축 (Foundation)
- [ ] 데이터 모델 정의 (EntityType, RelationType, Schema)
- [ ] 도메인 템플릿 저장소 구현
- [ ] 기본 프롬프트 설계

### Phase 2: Schema Discovery API
- [ ] POST /api/schema/discover - 문서 기반 스키마 발견
- [ ] POST /api/schema/recommend - 도메인 기반 스키마 추천
- [ ] GET /api/schema/templates - 템플릿 목록 조회
- [ ] GET /api/schema/templates/{domain} - 템플릿 상세 조회

### Phase 3: Schema Management API
- [ ] POST /api/schema/templates - 템플릿 생성
- [ ] PUT /api/schema/templates/{domain} - 템플릿 수정
- [ ] POST /api/schema/merge - 스키마 병합
- [ ] POST /api/schema/apply - 스키마 적용 (addon_params 업데이트)

### Phase 4: WebUI 개발
- [ ] SchemaManager 페이지
- [ ] SchemaDiscovery 컴포넌트
- [ ] SchemaEditor 컴포넌트
- [ ] 도메인 선택 UI

### Phase 5: 통합 및 최적화
- [ ] ainsert() 연동 (문서별 스키마 지정)
- [ ] 스키마 버전 관리
- [ ] 스키마 성능 분석

---

## 참고 문서

이 스킬의 상세 설계 문서:

| 문서 | 설명 |
|------|------|
| `architecture.md` | 전체 아키텍처 설계 |
| `api-design.md` | API 설계 가이드 |
| `ui-design.md` | UI/UX 설계 가이드 |
| `domain-templates.md` | 도메인별 스키마 템플릿 |
| `prompts.md` | LLM 프롬프트 설계 |
| `development-guide.md` | 개발 가이드 |

---

## 실행 지침

1. **명령어 파싱**: `$ARGUMENTS`에서 명령어와 파라미터 확인
2. **컨텍스트 로드**: 관련 참고 문서 읽기
3. **작업 수행**: 분석/개발/관리 작업 실행
4. **결과 보고**: 결과를 구조화하여 보고
5. **다음 단계 제안**: 후속 작업 안내

### 개발 작업 시 주의사항

- 기존 LightRAG 코드 스타일 준수
- 새 파일 생성 전 기존 구조 확인
- API 추가 시 라우터 등록 확인
- UI 개발 시 기존 컴포넌트 재사용
- 모든 변경사항 테스트 후 커밋
