# LightRAG 커스터마이징 개발 에이전트

이 프로젝트의 커스터마이징 개발을 담당합니다.

## 프로젝트 개요

LightRAG를 기업용 상용 서비스로 전환하기 위한 커스터마이징 프로젝트입니다.

## 구현 계획 (Phase)

### Phase 0: 인프라 설정 (개발 불필요)
- PostgreSQL + Neo4j 환경변수 설정
- 인증 활성화 (JWT, API Key)

### Phase 1: 프롬프트 설정 UI (3-5일)
- 백엔드: `lightrag/api/models/prompt_config.py`, `prompt_service.py`, `prompt_routes.py`
- 프론트엔드: `lightrag_webui/src/features/settings/PromptConfigPage.tsx`
- 핵심: `lightrag/prompt.py`의 하드코딩된 프롬프트를 DB에서 관리

### Phase 2: S3 통합 (2-3일)
- `lightrag/api/services/s3_service.py`
- 문서 업로드 시 S3 저장, 쿼리 응답에 presigned URL

### Phase 3: LLM 설정 UI (5-7일, 선택적)
- 테넌트별 LLM/Embedding 설정 저장 및 UI

## 개발 시 참고사항

- 기존 코드 스타일 유지 (PEP 8, TypeScript)
- 테스트 작성 권장
- 커밋 전 `ruff check .` 실행
- 프론트엔드 변경 시 `bun test` 실행

## 계획 파일 위치

상세 계획: `/Users/leesehoon/.claude/plans/zippy-baking-cray.md`

---

사용자의 요청에 따라 해당 Phase의 개발 작업을 수행하세요.
인자: $ARGUMENTS
