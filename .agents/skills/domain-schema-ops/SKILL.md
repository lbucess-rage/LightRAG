---
name: domain-schema-ops
description: LightRAG Schema 탭, 도메인 스키마 발견, 템플릿 관리, 현재 스키마 적용/초기화, 병합 미리보기/적용, 시드 엔티티 CRUD를 분석하거나 운영 점검할 때 사용한다.
---

# Domain Schema Ops

## 목적

지식화 전에 사용할 도메인 스키마를 발견, 비교, 적용, 병합하고 workspace별 적용 상태를 점검한다. 스키마 적용/초기화/병합은 이후 문서 처리 결과에 영향을 주므로 신중하게 다룬다.

## 핵심 파일

| 영역 | 파일 |
|------|------|
| UI | `lightrag_webui/src/features/SchemaManager.tsx` |
| Discovery | `lightrag_webui/src/components/schema/SchemaDiscovery.tsx` |
| Current schema | `lightrag_webui/src/components/schema/CurrentSchema.tsx` |
| Template library | `TemplateLibrary.tsx`, `TemplateEditor.tsx` |
| API client | `lightrag_webui/src/api/schema.ts` |
| Backend | `lightrag/api/routers/schema_routes.py` |
| Templates | `lightrag/schema/templates/` |

## 읽기 API

```bash
curl -s http://127.0.0.1:9422/api/schema/current -H 'LIGHTRAG-WORKSPACE: kevcs'
curl -s 'http://127.0.0.1:9422/api/schema/templates?limit=100&offset=0'
curl -s http://127.0.0.1:9422/api/schema/seed-entities -H 'LIGHTRAG-WORKSPACE: kevcs'
```

## 주요 작업

### 스키마 발견

- 파일 기반: `POST /api/schema/discover/from-files`
- 문서 텍스트 기반: `POST /api/schema/discover/from-document`
- 도메인 키워드 기반: `POST /api/schema/discover/from-domain`
- 하이브리드: `POST /api/schema/discover/hybrid`

발견 결과는 바로 적용하지 말고 현재 스키마와 비교한다.

### 현재 스키마 점검

확인할 항목:

- `entity_types`
- `relation_types`
- `entity_type_details`
- `seed_entities`
- `source`
- `applied_at`
- `is_default`
- `workspace`

### 적용/초기화/병합

쓰기 API:

- `POST /api/schema/apply`
- `POST /api/schema/reset`
- `POST /api/schema/merge/preview`
- `POST /api/schema/merge/apply`
- `POST/DELETE /api/schema/seed-entities`

실행 전 workspace와 기존 스키마 백업을 리포트에 남긴다.

## 주의사항

- 스키마 변경은 기존 지식그래프 데이터를 자동 재분류하지 않는다.
- 적용 후 새로 처리되는 문서에 영향을 준다.
- relation type 필드는 존재하지만 환경에 따라 비어 있을 수 있다.
- 시드 엔티티는 도메인 핵심 용어 보강에 유용하지만, 과하면 추출 편향이 생긴다.
