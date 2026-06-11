# 통합 지식 어드민 기능 검토

## 즉시 보완 완료

- 카테고리
  - 상위 카테고리 선택 후 하위 카테고리 생성 가능
  - 트리 들여쓰기 표시
  - 카테고리 수정, 비활성 처리 가능
  - 부모 변경/이름 변경 시 하위 카테고리 path 재계산
  - 자기 자신 또는 하위 카테고리를 부모로 지정하는 순환 구조 차단

- 사용자 관리
  - 사용자 생성
  - 역할, 표시명, 사용 여부 수정
  - LightRAG 워크스페이스 목록 조회 후 KMS/FAQ mode 기준 매핑 선택
  - 비밀번호 변경
  - 사용자 이력 CSV 다운로드
  - 사용자 이력 CSV 다운로드 감사 로그 기록

- 통합 검색
  - 카테고리 필터 선택
  - AI 답변/FAQ 답변 선택 토글
  - 선택된 카테고리와 검색 옵션을 `/api/search/integrated`로 전달

- 지식 관리
  - FAQ, 단일 텍스트, 여러 텍스트, 파일 업로드, 멀티모달 문서, 이미지, URL, URL 묶음, 게시판 API, 입력 폴더 스캔 선택
  - 카테고리, 유효기간, 답변 후보 사용 여부 지정
  - LightRAG `/documents/text`, `/documents/texts`, `/documents/upload`, `/documents/quick-image`, `/documents/scan`, `/api/url/ingest`, `/api/url/ingest-batch`, `/api/board/ingest`, `/api/multimodal/process` 프록시
  - 지식화 source type별 어드민 원장과 작업 이력 생성
  - 지식 목록에서 상태, 사용 여부, 카테고리 표시
  - KMS 문서 탐색에서 문서, 청크, 엔티티·관계 기본 조회 제공
  - LightRAG `/chunks/by-document/{doc_id}`, `/chunks/{chunk_id}`, `PATCH /chunks/{chunk_id}`를 어드민 경유로 호출
  - 청크 상세에서 본문, structured content, 연결 엔티티, 연결 관계, 삭제 영향도 확인 및 청크 본문 수정 제공
  - LightRAG `/entity-types`, `/entities`, `/relations`, `/entities/{id}/related`를 어드민 경유로 호출
  - KMS 엔티티·관계 탐색에서 엔티티 검색, 타입 필터, 관계 검색, 페이지네이션, 관련 엔티티 조회 제공
  - `kevcs` 워크스페이스 기준 엔티티 4,326건, 관계 7,666건 목록 조회와 관련 엔티티 API 호출 검증
  - LightRAG `/deletions/preview`, `/deletions/execute`, `/deletions/jobs`, `/restore/preview`, `/restore/execute`를 어드민 경유로 호출
  - KMS 탐색 화면에서 청크, 엔티티, 관계 삭제 영향도 preview와 삭제 실행 제공
  - 삭제 스냅샷 목록 조회와 복구 preview/execute 제공
  - `kevcs` 임시 문서로 청크 삭제 실행, 404 확인, 삭제 스냅샷 복구, 청크 복원, 임시 문서 정리 검증
  - KMS 문서 본문 수정 후 새 문서로 재지식화하고, 성공 시 기존 문서를 정리하는 교체 흐름 제공
  - 작업 이력 상세 화면에서 단계, 진행률, LightRAG task, 이벤트, 롤백 상태 확인
  - LightRAG `/api/tasks/{id}/stream`을 어드민 `GET /api/jobs/{job_id}/stream`으로 프록시하고 작업 상세에서 NDJSON 실시간 로그 구독
  - 작업 스트림 구독 시 `persist_events` 옵션으로 DB 저장 여부 선택
  - DB 저장 시 시작/종료/오류와 진행률 5% 이상 변화만 `KMS_ADMIN_JOB_EVENTS`에 샘플링 저장
  - 취소/롤백 API와 화면 액션 제공
  - `verify_target_workspaces.py --ingest-text`로 임시 텍스트 지식화, 작업 sync, 롤백 `completed` 검증

- 외부 연동
  - 시스템별 API Key 발급
  - LightRAG 워크스페이스 목록 조회 후 KMS/FAQ mode 기준 매핑 선택
  - scope, 분당 호출 제한, 활성 여부 관리
  - API Key 재발급
  - 외부 호출 예제 curl 표시
  - client별 호출 이력 조회와 CSV 다운로드
  - client별 호출 이력 CSV 다운로드 감사 로그 기록
  - `verify_target_workspaces.py --mutating`으로 외부 API client 생성, JSON 검색, NDJSON 스트림, key rotate, revoke 검증

- 시스템
  - LightRAG `/workspaces` 목록을 어드민 API로 프록시
  - `workspace_mode` 컬럼과 조회 조건 제공
  - `user-admin-prototype/assets`를 웹 public 경로로 동기화해 dev/build/runtime에서 동일 디자인 자산 사용
  - 브라우저에서 `/admin/prototype/assets/tokens.css`, `/admin/prototype/assets/app.css` 로드 확인
  - 운영 모드에서 JWT secret, password pepper, API key pepper, bootstrap password 기본값 사용 차단
  - PM2 `ecosystem.config.cjs`에서 운영 환경변수 주입과 로그 파일 경로 제공
  - 파일 로그 일 단위 회전과 `KMS_ADMIN_LOG_BACKUP_DAYS` 기반 보존 기간 설정

- FAQ 관리
  - 답변 상세 설정 UI
  - publish/archive/guidance/vector rebuild 실행 버튼
  - FAQ 수정 저장 후 벡터 재생성 옵션 제공
  - LightRAG `/api/answers/source-draft` 기반 FAQ 소스 초안 생성
  - 소스 초안 생성 후 `PATCH /api/answers/{id}`로 유효기간 동기화
  - 소스 초안 생성 시 가이드 후보, 태그, 소스 스냅샷/링크 확인
  - FAQ 후보 검수 콘솔에서 선택 답변, 후보 점수, 매칭 가이드 비교
  - `kevcs_faq_pair_20260609_145749` 기준 source draft 생성, FAQ PATCH 설정 저장, guidance 생성/삭제, publish, vector rebuild, archive 검증
  - FAQ PATCH 유효기간 필드가 LightRAG JSON 요청에서 ISO 문자열로 직렬화되도록 회귀 테스트 추가

- 통계
  - 오늘/7일/30일 기간 필터
  - 카테고리별, 일자별, 시간대별, 조회 키워드별 집계
  - 일자별 검색량 Area 차트, 카테고리 비중 Donut 차트, 24시간 시간대별 분포, 내부/외부 호출자와 AI/FAQ 답변 유형 구성 표시
  - 통계 API에서 빈 일자·시간대 구간을 0으로 채우고 평균 지연, 이전 기간 대비, 내부/외부 호출, AI/FAQ 검색 수 제공
  - CSV 다운로드
  - 통계 CSV 다운로드 감사 로그 기록
  - 조회 키워드별 상세 drill-down과 최근 검색 로그 확인
  - `verify_target_workspaces.py`로 `kevcs / kevcs_faq_pair_20260609_145749` 대상 21개 읽기 검증 통과
  - `verify_target_workspaces.py --mutating`으로 25개 쓰기/API 관리/FAQ 변경 검증 통과
  - `verify_target_workspaces.py --mutating --ingest-text`로 26개 쓰기/FAQ 변경/KMS ingest 포함 검증 통과

## 아직 추가 구현이 필요한 범위

- 외부 연동
  - scope를 검색 외 기능까지 확장할 때의 권한 UI
  - rate limit을 다중 프로세스/분산 환경에서 강제하기 위한 Redis 등 공유 저장소 연동

- 운영
  - 운영 환경에서 PM2 로그와 어드민 파일 로그를 별도 수집 시스템으로 이관할지 결정
