# Integrated KMS Admin

LightRAG의 생성형 KMS와 FAQ KMS를 함께 관리하고, 타시스템이 사용할 통합 검색 API를 제공하는 별도 하위 프로젝트입니다.

## Backend

```bash
cd integrated-kms-admin/backend
python -m venv .venv
source .venv/bin/activate
pip install -e .[test]
kms-admin-server
```

기본 포트는 `LIGHTRAG_BASE_URL` 포트 + 100입니다. 예를 들어 LightRAG가 `9422`이면 어드민은 `9522`에서 실행됩니다.

필수/주요 환경변수:

- `KMS_ADMIN_DATABASE_URL` 또는 기존 `POSTGRES_*`
- `LIGHTRAG_BASE_URL`
- `LIGHTRAG_API_KEY` 또는 `LIGHTRAG_BEARER_TOKEN`
- `KMS_ADMIN_JWT_SECRET`
- `ADMIN_PASSWORD_PEPPER`
- `KMS_ADMIN_API_KEY_PEPPER`
- `ADMIN_BOOTSTRAP_ID`, `ADMIN_BOOTSTRAP_PASSWORD`
- `KMS_ADMIN_ENV`: 운영에서는 `production` 권장
- `KMS_ADMIN_LOG_BACKUP_DAYS`: 일 단위 파일 로그 보존 일수, 기본 `30`

`KMS_ADMIN_ENV=production` 또는 `KMS_ADMIN_REQUIRE_SECRETS=true`이면 서버 시작 시 다음 값을 강제 검증합니다.

- `KMS_ADMIN_JWT_SECRET`: 개발 기본값이 아니고 32자 이상
- `ADMIN_PASSWORD_PEPPER`, `KMS_ADMIN_API_KEY_PEPPER`: 각각 16자 이상
- `ADMIN_BOOTSTRAP_PASSWORD`: `admin123`이 아니고 12자 이상

## External Search API

타시스템은 `X-KMS-ADMIN-API-Key` 헤더로 인증합니다.

```bash
curl -s -X POST http://127.0.0.1:9522/api/external/search \
  -H 'Content-Type: application/json' \
  -H 'X-KMS-ADMIN-API-Key: kmsadm_xxx' \
  -d '{"query":"환불 방법은?","include_generative":true,"include_faq":true}'
```

스트리밍은 NDJSON입니다.

```bash
curl -N -X POST http://127.0.0.1:9522/api/external/search/stream \
  -H 'Content-Type: application/json' \
  -H 'X-KMS-ADMIN-API-Key: kmsadm_xxx' \
  -d '{"query":"환불 방법은?"}'
```

## Web

```bash
cd integrated-kms-admin/web
bun install
bun run dev
```

운영 빌드는 `bun run build` 후 FastAPI가 `/admin` 경로에서 정적 파일을 서빙합니다.

프로토타입 디자인 시스템은 `user-admin-prototype/assets`를 기준으로 하며, 웹 빌드에서도 같은 파일을 사용하도록 다음 public 경로에 동기화되어 있습니다.

- `web/public/prototype/assets`
- `web/public/admin/prototype/assets`

운영 HTML은 `/admin/prototype/assets/tokens.css`, `/admin/prototype/assets/app.css`를 로드합니다.

## Target Workspace Verification

현재 테스트 기준 워크스페이스는 다음 값입니다.

- KMS: `kevcs`
- FAQ: `kevcs_faq_pair_20260609_145749`

실행 중인 어드민 서버와 LightRAG 연동을 반복 검증하려면 다음 스크립트를 사용합니다.

```bash
cd /Users/rage/project/LightRAG
integrated-kms-admin/backend/.venv/bin/python \
  integrated-kms-admin/scripts/verify_target_workspaces.py
```

기본 검증은 health, 로그인, 워크스페이스 조회, 카테고리/사용자 목록, KMS 문서·청크·엔티티·관계 조회, FAQ 답변/후보 검색, 통합 검색, 통계, 작업 스트림을 확인합니다.

관리 쓰기 기능과 실제 텍스트 지식화/롤백까지 확인하려면 다음처럼 실행합니다.

```bash
integrated-kms-admin/backend/.venv/bin/python \
  integrated-kms-admin/scripts/verify_target_workspaces.py \
  --mutating \
  --ingest-text
```

`--mutating`은 임시 카테고리, 사용자, 외부 API client를 생성한 뒤 비활성화 또는 폐기합니다. `--ingest-text`는 임시 텍스트 문서를 지식화하고 작업 롤백이 `completed`로 끝나는지 확인합니다.

## PM2 운영

```bash
cd integrated-kms-admin
export KMS_ADMIN_ENV=production
export LIGHTRAG_BASE_URL=http://127.0.0.1:9422
export KMS_ADMIN_DATABASE_URL=postgresql://user:password@host:5432/lightrag
export KMS_ADMIN_JWT_SECRET='change-this-to-a-long-random-secret'
export ADMIN_PASSWORD_PEPPER='change-this-password-pepper'
export KMS_ADMIN_API_KEY_PEPPER='change-this-api-key-pepper'
export ADMIN_BOOTSTRAP_ID=admin
export ADMIN_BOOTSTRAP_PASSWORD='change-this-bootstrap-password'

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

파일 로그는 `KMS_ADMIN_LOG_DIR` 또는 `LOG_DIR` 아래 `kms-admin.log`로 생성되며, 매일 자정 회전됩니다. 보존 기간은 `KMS_ADMIN_LOG_BACKUP_DAYS`로 조정합니다. 주요 사용자 행위, 외부 API 호출, 다운로드, 작업 이벤트는 DB에도 남습니다.
