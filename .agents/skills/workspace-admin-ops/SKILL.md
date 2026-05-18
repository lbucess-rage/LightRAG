---
name: workspace-admin-ops
description: LightRAG Workspaces 탭과 /workspaces API를 사용해 워크스페이스 생성, 수정, 삭제, default 설정, 통계 동기화, 설정 복사, 데이터 복사/이동 기능을 분석하거나 운영 점검할 때 사용한다.
---

# Workspace Admin Ops

## 목적

워크스페이스 관리 기능을 운영 관점에서 점검한다. 삭제, 데이터 이동, 기본값 변경은 시스템 영향이 큰 작업이므로 명시 요청과 사전 확인이 필요하다.

## 핵심 파일

| 영역 | 파일 |
|------|------|
| UI | `lightrag_webui/src/features/WorkspaceManagement.tsx` |
| Dialogs | `lightrag_webui/src/components/workspace/` |
| Store | `lightrag_webui/src/stores/workspace.ts` |
| API client | `lightrag_webui/src/api/lightrag.ts` |
| Backend | `lightrag/api/routers/workspace_routes.py` |

## 읽기 API

```bash
curl -s 'http://127.0.0.1:9422/workspaces?page=1&page_size=100'
curl -s http://127.0.0.1:9422/workspaces/default
curl -s http://127.0.0.1:9422/workspaces/kevcs
curl -s http://127.0.0.1:9422/workspaces/kevcs/stats
```

## 쓰기 API

- 생성: `POST /workspaces`
- 수정: `PATCH /workspaces/{workspace_id}`
- 삭제: `DELETE /workspaces/{workspace_id}?delete_data=true`
- 기본값 설정: `POST /workspaces/{workspace_id}/set-default`
- 통계 동기화: `POST /workspaces/{workspace_id}/sync-stats`
- 설정 복사: `POST /workspaces/{workspace_id}/copy-settings`
- 데이터 복사: `POST /workspaces/{workspace_id}/copy-data`
- 데이터 이동: `POST /workspaces/{workspace_id}/move-data`

## 점검 절차

1. 목록에서 `is_default`, `is_busy`, document/entity/relation count를 확인한다.
2. UI Workspaces 탭의 요약 카드 합계와 API 목록 합계를 비교한다.
3. 특정 workspace의 stats를 sync 전후로 비교한다.
4. 삭제 버튼이 default/busy workspace에서 비활성화되는지 확인한다.
5. copy/move는 대상 workspace가 존재하고 busy가 아닌지 확인한다.

## 운영 주의사항

- default workspace는 삭제할 수 없다.
- busy workspace는 삭제/이동하면 안 된다.
- `copy-data` 코드는 PostgreSQL 문서/벡터/매핑 테이블 중심이다. Neo4j 노드/엣지 복사 보장 여부는 별도 검증한다.
- `move-data`는 복사 후 원본 삭제 패턴이므로 실패 중간 상태를 고려한다.
- 운영 전에는 source/target workspace, 포함 옵션, rollback 계획을 명시한다.
