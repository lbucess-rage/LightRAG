---
name: knowledge-ingestion-ops
description: LightRAG의 문서 업로드, input directory scan, URL ingest, Board API ingest, quick image, multimodal process, async task 진행률 등 데이터 소스별 지식화 기능을 분석하거나 운영 점검할 때 사용한다.
---

# Knowledge Ingestion Ops

## 목적

다양한 데이터 소스가 LightRAG 지식그래프와 벡터 저장소로 들어가는 흐름을 점검한다. 기본은 읽기 전용이며, 실제 ingest/삭제/재처리는 사용자가 요청한 경우에만 실행한다.

## 기능 지도

| 소스 | UI | API |
|------|----|-----|
| 파일 업로드 | Documents > Upload | `POST /documents/upload` |
| input dir scan | Documents > Scan/Retry | `POST /documents/scan` |
| 텍스트 | API | `POST /documents/text`, `/documents/texts` |
| Quick image | Documents > Quick | `POST /documents/quick-image` |
| URL | Documents > URL | `/api/url/validate`, `/api/url/ingest`, `/api/url/ingest-batch` |
| Board API | Documents > Board API | `/api/board/explore`, `/api/board/ingest`, `/api/board/view` |
| Multimodal | Documents > Multimodal | `/api/multimodal/status`, `/api/multimodal/process` |
| Task progress | Active tasks panel | `/api/tasks`, `/api/tasks/{id}/stream` |

## 점검 절차

1. 현재 workspace를 확인한다.
   ```bash
   curl -s 'http://127.0.0.1:9422/workspaces?page=1&page_size=100'
   ```
2. 문서 목록과 상태 분포를 조회한다.
   ```bash
   curl -s -X POST http://127.0.0.1:9422/documents/paginated \
     -H 'Content-Type: application/json' \
     -H 'LIGHTRAG-WORKSPACE: kevcs' \
     -d '{"page":1,"page_size":10,"sort_field":"updated_at","sort_direction":"desc"}'
   ```
3. task 목록은 필요한 필드만 요약한다. raw metadata에는 외부 API header가 포함될 수 있으므로 그대로 공유하지 않는다.
4. 멀티모달 상태를 확인한다.
   ```bash
   curl -s http://127.0.0.1:9422/api/multimodal/status -H 'LIGHTRAG-WORKSPACE: kevcs'
   ```
5. URL/Board ingest는 먼저 validate/explore를 수행하고, 매핑과 중복 옵션을 확인한 뒤 ingest를 실행한다.

## 성공 기준

- ingest API가 즉시 `task_id`와 `stream_url`을 반환한다.
- `/api/tasks/{task_id}/stream`이 progress NDJSON을 반환한다.
- 완료 후 `/documents/paginated`의 status가 `processed`로 바뀐다.
- 그래프/엔티티 조회에서 새 엔티티 또는 문서 출처가 확인된다.

## 주의사항

- Board API task metadata에 인증 header가 저장될 수 있다. 토큰을 출력하거나 문서에 남기지 않는다.
- parser 상태가 `docling=false`, `pymupdf=false`이면 멀티모달 PDF/DOCX 처리가 실패할 수 있다.
- `reprocess_failed`, `clear`, `delete` 계열은 데이터 변경 작업이다. 실행 전 workspace와 범위를 반드시 확인한다.
