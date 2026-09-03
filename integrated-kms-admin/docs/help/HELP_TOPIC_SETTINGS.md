# 도움말 항목별 노출 설정 초안

작성일: 2026-06-22

이 문서는 도움말 원고를 기준으로 한 초기 노출 설정표입니다. 실제 구현 시 시스템 관리자가 이 값을 화면에서 변경할 수 있어야 합니다.

## 상태값

| 상태 | 의미 |
| --- | --- |
| draft | 작성중 |
| review | 검수중 |
| published | 게시 |
| hidden | 숨김 |

## 권한별 노출 기준

| 값 | 의미 |
| --- | --- |
| Y | 해당 권한에 도움말 표시 |
| N | 해당 권한에 도움말 숨김 |

## 초기 설정표

| 도움말 ID | 메뉴 | 제목 | 상태 | 일반 사용자 | 지식 관리자 | 시스템 관리자 | 스크린샷 경로 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HELP-SEARCH-001 | 통합 검색 | 통합 검색 사용하기 | published | Y | Y | Y | `/help/screenshots/search/search-basic.png` | 전체 사용자 기본 도움말 |
| HELP-SEARCH-002 | 통합 검색 | 카테고리로 검색 범위 좁히기 | published | Y | Y | Y | `/help/screenshots/search/search-category-filter.png` | 카테고리 사용 방식 설명 |
| HELP-SEARCH-003 | 통합 검색 | 근거 지식 확인하기 | published | Y | Y | Y | `/help/screenshots/search/search-evidence.png` | 답변 번호와 근거 연결 설명 |
| HELP-SEARCH-004 | 통합 검색 | 검색 후보 적용 내역 이해하기 | review | N | Y | Y | `/help/screenshots/search/search-eligibility.png` | 일반 사용자에게는 기본 숨김 |
| HELP-SEARCH-005 | 통합 검색 | FAQ 하이브리드 검색과 공통 용어 이해하기 | published | N | Y | Y | `/help/screenshots/search/search-faq-hybrid.png` | 키워드, 벡터, 공통 용어 확장 설명 |
| HELP-KNOWLEDGE-001 | 지식 관리 | 지식 관리 화면 이해하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-overview.png` | 지식 관리자 시작 도움말 |
| HELP-KNOWLEDGE-002 | 지식 관리 | 지식 추가 전 필수 설정 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-common-settings.png` | 카테고리, 유효기간, 사용 여부 |
| HELP-KNOWLEDGE-003 | 지식 관리 | 파일 업로드로 지식 등록하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-upload-file.png` | PDF/문서 업로드 |
| HELP-KNOWLEDGE-004 | 지식 관리 | 텍스트 지식 등록하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-text.png` | 단일 텍스트 |
| HELP-KNOWLEDGE-005 | 지식 관리 | 여러 텍스트를 한 번에 등록하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-texts.png` | 복수 텍스트 |
| HELP-KNOWLEDGE-006 | 지식 관리 | URL 지식 등록하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-url.png` | 단일 URL |
| HELP-KNOWLEDGE-007 | 지식 관리 | URL 묶음 등록하기 | review | N | Y | Y | `/help/screenshots/knowledge/knowledge-url-batch.png` | 작업 실패 확인 설명 필요 |
| HELP-KNOWLEDGE-008 | 지식 관리 | 게시판 API로 지식 등록하기 | review | N | N | Y | `/help/screenshots/knowledge/knowledge-board-api.png` | 필드 매핑 검증 전 지식 관리자 숨김 권장 |
| HELP-KNOWLEDGE-009 | 지식 관리 | 멀티모달 문서 등록하기 | review | N | Y | Y | `/help/screenshots/knowledge/knowledge-multimodal.png` | 처리 지시 UI 보강 후 게시 권장 |
| HELP-KNOWLEDGE-010 | 지식 관리 | 이미지 지식 등록하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-image.png` | 이미지 근거 확인과 연결 |
| HELP-KNOWLEDGE-011 | 지식 관리 | FAQ 답변 등록하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-faq-answer.png` | 질문 후보, 태그 설명 |
| HELP-KNOWLEDGE-012 | 지식 관리 | FAQ 소스 초안 등록하기 | review | N | Y | Y | `/help/screenshots/knowledge/knowledge-faq-draft.png` | 초안 검수 주의 필요 |
| HELP-KNOWLEDGE-013 | 지식 관리 | 기존 LightRAG 지식 연결하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-link-existing.png` | 기존 워크스페이스 지식 연결 핵심 |
| HELP-KNOWLEDGE-014 | 지식 관리 | 지식화 진행률 확인하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-progress.png` | 진행률 정체 시 확인 방법 |
| HELP-KNOWLEDGE-015 | 지식 관리 | 지식 목록과 페이징 사용하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-list.png` | 목록 필터와 페이징 |
| HELP-KNOWLEDGE-016 | 지식 관리 | Excel과 DB 표에서 FAQ 일괄 생성하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-faq-bulk-create.png` | 시트 분석, 행별 매핑, ID 조회형 FAQ 설명 |
| HELP-KNOWLEDGE-017 | 지식 관리 | FAQ 공통 용어와 AI 후보 관리하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-faq-terminology.png` | 동의어 직접 등록과 AI 승인 흐름 |
| HELP-KNOWLEDGE-018 | 지식 관리 | FAQ 그래프 구성과 그래프 결합 검색 사용하기 | published | N | Y | Y | `/help/screenshots/knowledge/knowledge-faq-graph.png` | 스키마, 미리보기, 재구축과 검색 근거 설명 |
| HELP-CATEGORY-001 | 카테고리 | 카테고리와 하위 카테고리 관리하기 | published | N | Y | Y | `/help/screenshots/categories/category-tree.png` | 고객센터 기준 카테고리 |
| HELP-JOBS-001 | 작업 이력 | 작업 이력 확인하기 | published | N | Y | Y | `/help/screenshots/jobs/jobs-history.png` | 실패/롤백 확인 |
| HELP-STATS-001 | 현황 · 통계 | 현황과 통계 확인하기 | published | N | Y | Y | `/help/screenshots/stats/stats-dashboard.png` | 통계 새로고침 포함 |
| HELP-EXTERNAL-001 | API 관리 | 외부 시스템 API 연동하기 | published | N | N | Y | `/help/screenshots/external/external-api.png` | API Key와 샘플 요청 |
| HELP-USERS-001 | 사용자 관리 | 사용자 계정 관리하기 | published | N | N | Y | `/help/screenshots/users/users-management.png` | 권한 설명 포함 |
| HELP-TENANTS-001 | 고객센터 관리 | 고객센터 관리하기 | published | N | N | Y | `/help/screenshots/tenants/tenants-management.png` | 테넌트/워크스페이스 매핑 |
| HELP-SYSTEM-001 | 시스템 | 시스템 상태 확인하기 | published | N | N | Y | `/help/screenshots/system/system-health.png` | 운영 상태 정보 |

## 구현 시 관리 화면 필드

| 필드 | 설명 | 필수 |
| --- | --- | --- |
| 도움말 ID | 항목을 식별하는 고유 ID | Y |
| 메뉴 | 연결되는 어드민 메뉴 | Y |
| 제목 | 도움말 목록과 본문 제목 | Y |
| 요약 | 한 줄 설명 | Y |
| 본문 | 실제 도움말 내용 | Y |
| 상태 | draft, review, published, hidden | Y |
| 일반 사용자 노출 | 일반 사용자에게 표시할지 여부 | Y |
| 지식 관리자 노출 | 지식 관리자에게 표시할지 여부 | Y |
| 시스템 관리자 노출 | 시스템 관리자에게 표시할지 여부 | Y |
| 스크린샷 | 현재 화면 캡처 이미지 | Y |
| 검색 키워드 | 도움말 검색에 사용할 보조 키워드 | N |
| 정렬 순서 | 목차 표시 순서 | Y |

## 스크린샷 촬영 기준

| 기준 | 설명 |
| --- | --- |
| 계정 | 테스트 계정 사용 |
| 고객센터 | 테스트 고객센터 또는 기본 고객센터 사용 |
| 워크스페이스 | 테스트 KMS/FAQ 워크스페이스 사용 |
| 화면 크기 | 기본 1440px 이상 데스크톱 화면 |
| 민감정보 | API Key, 비밀번호, 개인정보 마스킹 |
| 파일명 | 도움말 ID와 기능명을 알아볼 수 있게 작성 |
| 갱신 기준 | 화면 구조가 바뀌면 해당 스크린샷도 함께 교체 |
