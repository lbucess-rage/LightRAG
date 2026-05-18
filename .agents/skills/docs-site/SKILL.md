---
name: docs-site
description: 기술 분석 문서 자동 분류 및 MkDocs Material 기반 문서 사이트 관리
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Grep
---

# 기술 문서 사이트 관리 에이전트

`project-analysis/` 디렉토리의 기술 분석 문서(MD)를 자동 분류하여 MkDocs Material 테마 기반 문서 사이트로 빌드·서빙합니다.

## 프로젝트 정보

- **프로젝트 경로**: `/home/kms-rag/LightRAG`
- **문서 소스**: `project-analysis/` (마크다운 파일)
- **사이트 설정**: `docs-site/` (스크립트, 생성물)
- **가상환경**: `.venv`
- **로컬 서빙 포트**: `9477`

## 사용 가능한 명령어

사용자가 `$ARGUMENTS`로 전달한 명령어에 따라 작업을 수행합니다.

### 사이트 관리

| 명령어 | 설명 |
|--------|------|
| `serve` | 문서 분류 → 설정 생성 → 로컬 서빙 (포트 9477) |
| `build` | 문서 분류 → 설정 생성 → 정적 사이트 빌드 |
| `stop` | 실행 중인 mkdocs 서버 중지 |
| `status` | 서버 실행 상태 및 문서 현황 확인 |
| `classify` | 문서 분류 결과만 확인 (--summary 옵션) |
| `deploy` | GitHub Pages로 배포 (gh-deploy) |

### 명령어 실행 방법

**serve (문서 사이트 로컬 서빙):**
```bash
cd /home/kms-rag/LightRAG
.venv/bin/python docs-site/scripts/generate_config.py
.venv/bin/mkdocs serve --config-file docs-site/mkdocs.yml --dev-addr 0.0.0.0:9477 &
```

**build (정적 사이트 빌드):**
```bash
cd /home/kms-rag/LightRAG
.venv/bin/python docs-site/scripts/generate_config.py
.venv/bin/mkdocs build --config-file docs-site/mkdocs.yml
```

**stop (서버 중지):**
```bash
pkill -f "mkdocs serve.*9477" 2>/dev/null || echo "서버가 실행 중이지 않습니다"
```

**status (상태 확인):**
```bash
# 서버 프로세스 확인
pgrep -fa "mkdocs serve.*9477" || echo "서버 미실행"
# 문서 현황
.venv/bin/python docs-site/scripts/classify.py --summary
```

**classify (분류 확인):**
```bash
cd /home/kms-rag/LightRAG
.venv/bin/python docs-site/scripts/classify.py
# 요약만: .venv/bin/python docs-site/scripts/classify.py --summary
```

**deploy (GitHub Pages 배포):**
```bash
cd /home/kms-rag/LightRAG
.venv/bin/python docs-site/scripts/generate_config.py
.venv/bin/mkdocs gh-deploy --config-file docs-site/mkdocs.yml --force
```

## 분류 카테고리

| 카테고리 | 폴더명 | 설명 |
|----------|--------|------|
| 코드분석 | code-analysis | 소스코드 분석, 파이프라인 분석, 아키텍처 분석 |
| 수정내용 | changes | 변경사항, 수정이력, 리팩토링 기록 |
| 설계문서 | design | 설계 제안, 아키텍처 설계, API 설계 |
| 기술지원 | troubleshooting | 에러 분석, 디버깅, 문제해결 |
| 운영가이드 | operations | 배포, 설정, 운영 절차 |
| 기타 | misc | 분류 기준 미달 문서 |

## 실행 지침

1. 사용자의 `$ARGUMENTS`를 확인하여 해당 명령어 실행
2. 명령어가 없으면 사용 가능한 명령어 목록 안내
3. `serve` 실행 시 generate_config.py를 먼저 실행하여 최신 분류 반영
4. `deploy` 실행 전 빌드가 정상인지 확인
5. 작업 결과를 명확하게 정리하여 보고

## 주의사항

- `docs-site/docs/`와 `docs-site/mkdocs.yml`은 자동 생성물이므로 직접 편집하지 않음
- `project-analysis/`에 새 파일이 추가되면 `serve` 또는 `build` 시 자동 반영
- 서버는 백그라운드로 실행되며, `stop` 명령어로 종료
