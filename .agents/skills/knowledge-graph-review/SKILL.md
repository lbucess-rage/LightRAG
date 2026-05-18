---
name: knowledge-graph-review
description: LightRAG Knowledge Graph 탭, Sigma 그래프 렌더링, 그래프 라벨 검색, popular labels, 서브그래프 조회, 엔티티/관계 편집 API를 점검하거나 분석할 때 사용한다.
---

# Knowledge Graph Review

## 목적

지식 그래프가 워크스페이스별로 올바르게 조회되고 WebUI에서 렌더링되는지 확인한다. 그래프 편집 API는 쓰기 작업이므로 사용자가 명시적으로 요청하지 않으면 호출하지 않는다.

## 핵심 파일

| 영역 | 파일 |
|------|------|
| Graph UI | `lightrag_webui/src/features/GraphViewer.tsx` |
| Label/search | `lightrag_webui/src/components/graph/GraphLabels.tsx`, `GraphSearch.tsx` |
| Graph controls | `LayoutsControl.tsx`, `ZoomControl.tsx`, `PropertiesView.tsx` |
| API client | `lightrag_webui/src/api/lightrag.ts` |
| Backend | `lightrag/api/routers/graph_routes.py` |

## 읽기 API

```bash
curl -s http://127.0.0.1:9422/graph/label/list -H 'LIGHTRAG-WORKSPACE: kevcs'
curl -s 'http://127.0.0.1:9422/graph/label/popular?limit=20' -H 'LIGHTRAG-WORKSPACE: kevcs'
curl -s 'http://127.0.0.1:9422/graph/label/search?q=E-pit&limit=20' -H 'LIGHTRAG-WORKSPACE: kevcs'
curl -s 'http://127.0.0.1:9422/graphs?label=E-pit&max_depth=2&max_nodes=200' -H 'LIGHTRAG-WORKSPACE: kevcs'
```

## 점검 절차

1. `base`와 데이터 보유 workspace를 비교하여 빈 그래프인지 실제 장애인지 구분한다.
2. popular labels가 비어 있으면 문서/엔티티 카운트를 먼저 확인한다.
3. `/graphs` 응답의 nodes/edges 수와 truncation 여부를 확인한다.
4. WebUI Knowledge Graph 탭에서 라벨 선택, 검색, 레이아웃 변경, 속성 패널 표시를 확인한다.
5. 브라우저 콘솔에 graph data 관련 warning이 있으면 label과 응답 payload를 함께 확인한다.

## 조회 주의점

- `/graph/label/search`는 부분 문자열 검색 결과가 기대와 다를 수 있다. label search가 비어도 `/graphs?label=<exact-label>`와 `/graph/label/popular`로 실제 노드 존재 여부를 교차 확인한다.
- 삭제 검증 후에는 `/graphs?label=*`의 nodes/edges 수와 삭제 marker 포함 여부를 함께 확인한다.

## 편집 API

다음 API는 그래프를 변경한다.

- `POST /graph/entity/edit`
- `POST /graph/relation/edit`
- `POST /graph/entity/create`
- `POST /graph/relation/create`
- `POST /graph/entities/merge`

실행 전 사용자에게 대상 workspace, 엔티티/관계 이름, rollback 가능성, 벡터/청크 동기화 범위를 확인한다.

## 보고 형식

- workspace와 조회 label
- labels/popular/search 결과 요약
- nodes/edges/truncated 여부
- UI 렌더링 상태
- 발견한 데이터 품질 이슈
