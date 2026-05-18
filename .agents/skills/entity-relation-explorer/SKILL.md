---
name: entity-relation-explorer
description: LightRAG Entity-Relation Explorer 탭, 엔티티/관계 목록 API, 엔티티 타입 집계, 관련 엔티티 조회, 관계 탐색, 엔티티/관계 삭제 리스크를 분석하거나 점검할 때 사용한다.
---

# Entity Relation Explorer

## 목적

엔티티와 관계를 목록/필터/상세/부분 그래프로 검토하고, 데이터 품질과 삭제/정리 리스크를 판단한다.

## 핵심 파일

| 영역 | 파일 |
|------|------|
| UI shell | `lightrag_webui/src/features/EntityManagement.tsx` |
| Entity list | `lightrag_webui/src/components/entity-management/EntityExplorer.tsx` |
| Relation list | `lightrag_webui/src/components/entity-management/RelationExplorer.tsx` |
| Graph/detail | `EntityGraphView.tsx`, `EntityDetailPanel.tsx` |
| Store | `lightrag_webui/src/stores/entityManagement.ts` |
| Backend | `lightrag/api/routers/entity_management_routes.py` |

## 읽기 API

```bash
curl -s http://127.0.0.1:9422/entity-types -H 'LIGHTRAG-WORKSPACE: kevcs'

curl -s -X POST http://127.0.0.1:9422/entities \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{"page":1,"page_size":20,"sort_field":"entity_id","sort_direction":"asc"}'

curl -s -X POST http://127.0.0.1:9422/relations \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{"page":1,"page_size":20,"sort_field":"source_id","sort_direction":"asc"}'
```

## 점검 절차

1. `GET /entity-types`로 총 엔티티 수와 타입 분포를 확인한다.
2. `UNKNOWN`, 대소문자 혼재, 오탈자 타입, 지나치게 일반적인 타입을 표시한다.
3. 엔티티 목록은 search/entity_type/sort 조합을 바꿔가며 pagination을 확인한다.
4. 관계 목록은 source/target/keywords 검색이 동작하는지 확인한다.
5. 특정 엔티티는 `/entities/{entity_id}/related`로 유사 이름을 확인한다.
6. UI에서 좌측 목록 선택 시 우측 그래프와 하단 상세가 동기화되는지 확인한다.

## 삭제 API

삭제는 데이터 변경 작업이다.

- `DELETE /entities/{entity_id}?cascade=true`
- `POST /entities/batch-delete`
- `DELETE /relations?cascade=true`

실행 전 확인할 것:

- 대상 workspace
- cascade 여부
- Neo4j graph, vector DB, chunk mapping 동기화 영향
- 관련 문서/청크가 남는지 여부

## 삭제 검증 절차

1. 실제 업무 엔티티를 바로 지우지 말고 테스트 workspace에 임시 엔티티 2개와 관계 1개를 만든다.
2. `/entities`, `/relations`, `/graphs?label=<entity>`에서 생성 전후 목록과 edge를 확인한다.
3. 검색 컨텍스트까지 확인하려면 임시 엔티티/관계의 `source_id`를 존재하는 `chunk-*` ID로 지정한다. `manual_creation`만 있는 수동 데이터는 `/query`에서 원문 context가 없을 수 있다.
4. 관계를 먼저 `DELETE /relations?cascade=true`로 삭제하고, 관계 목록과 그래프 edge가 0건인지 확인한다. 이때 양쪽 엔티티는 degree 0으로 남는 것이 정상이다.
5. 엔티티를 `DELETE /entities/{entity_id}?cascade=true` 또는 batch-delete로 삭제하고, 엔티티 목록, 그래프 node, `/query` context에 삭제 marker가 남지 않는지 확인한다.
6. 테스트 중 만든 임시 문서가 있으면 `/documents/delete_document`로 정리하고 workspace stats가 원래 문서/엔티티/관계 수로 돌아왔는지 확인한다.

주의: 엔티티/관계를 지워도 원본 문서 chunk가 계속 남아 있으면 일반 RAG 검색은 동일 텍스트를 다시 찾을 수 있다. "검색에서 안 나옴"을 검증할 때는 그래프 context, 엔티티/관계 목록, 문서 chunk 검색을 구분해 보고한다.

## 보고 형식

- 타입 분포 상위 N개
- 검색/페이지네이션 동작 여부
- 데이터 품질 이슈
- 삭제/정리 후보와 위험도
