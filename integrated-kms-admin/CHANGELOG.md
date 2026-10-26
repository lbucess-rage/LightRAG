# 작업 이력 (CHANGELOG)

통합 지식 어드민(KMS) · 상담 TA 분류 관련 작업 이력. 인수/후속 작업 시 참고용.

> 참고: 초기 일부 작업은 커밋이 `9~10월 묶음`(727f8e9e)으로 한 번에 들어가 커밋 로그만으로는
> 세부 이력·날짜가 흐립니다. 이 파일이 그 공백을 메우는 기준 기록입니다. 이후 작업은 여기에 한 줄씩 추가해 주세요.

**영역 표기**
- `[admin]` — 통합 지식 어드민 (이 repo 코드: backend/kms_admin, web/src)
- `[data]` — LightRAG 지식·테넌트 데이터 (코드 아님: FAQ/카테고리/벡터/원장)
- `[classifier]` — 상담 분류기 (별도 시스템, 운영 16050 / 개발 16070)
- `[webhook]` — 게시판 웹훅 (`/home/kms-webhook`, 이 repo 밖·파일 보존)
- 작성자: DS지원팀 hs.kim

---

## 2026-10

- **10-26** `[admin]` 지식화 방식 UI 정리 — 11종을 '자주 쓰는 방식/고급 방식' 2단으로 분리, 설명 예시형 보강, 라벨 통일('FAQ 방식'·'텍스트 묶음'). 백엔드/제출로직 불변(무중단). `f48101c1`
- **10-26** `[admin]` FAQ publish/archive가 팀별 검색노출(enabled)을 덮던 버그 수정 — answer 공유 복제(LG 3팀) 구조에서 status만 갱신, enabled는 팀별 보존. `8c88945f`
- **10-26** `[webhook]` 게시판 웹훅 A안 운영 배포 — 상담AP 게시글→어드민 수집 엔드포인트→원장+LightRAG 동시 생성(게시글이 제목으로 원장에 바로 뜸). 동기화 크론 설치. (repo 밖, `02_KMS구축/webhook_app_A.py`)
- **10-26** `[data]` KEVCS 상담AP KMS 운영 전환 — 운영 통합어드민에 KEVCS(default) 외부 API 클라이언트(search+recommend) 발급(그간 개발 85:9522를 보던 원인 해소).
- **10-26** `[data]` LG 상담 링크 새창 전환 — 배송조회/제품문의 URL을 `<a target="_blank" rel="noopener">`로 감쌈(상담AP 같은창 전환 시 CTI 끊김 방지).
- **10-23** `[admin]` 시각 KST 표기 · 지식목록 정렬 · backfill 중복 테넌트 방지. `4e6ba817`
- **10-23** `[admin]` 작업버튼 간격·표 헤더 정렬·API/지식관리 정리 + FAQ 유효기간 삭제 반영(valid_from/until 직접대입). `6d4f2c9a`
- **10-23** `[admin]` 작업버튼·토글 일관화, 통계 가로배치, 도움말 관리/읽기 정리, 통합검색 FAQ HTML 렌더링. `a0cd51eb`
- **10-23** `[admin]` 본부장님 `feature/faq-content-format` 병합 — FAQ content_format(html/markdown)·display_policy + 운영 시크릿 `.env.production` 외부화. `01cf813d`
- **10-23** `[admin]` 고객센터·사용자·작업이력 관리 UI 개선 묶음(9~10월 미커밋분 기록용 커밋). `727f8e9e`
- **10-15** `[data]` LG 검색 힌트(guidance) 보강 — 구어체/동의어 추가. 173건 frozen 대규모 벤치로 회귀 0 확인(구어체 매칭 22→88%). 범용 구어체는 이웃 가로채기로 제외(규율 확립).
- **10-13~14** `[data]` LG 카테고리 연결 근본 해결 — 39유형 category NULL → 3팀(뷰티/외부몰/직영몰)×방향 복제 117건, FAQ 본문 HTML 포맷, 운영84 재현 구축(재시작 0), 식별자 lghh→lghnh 통일. 재발방지 감사도구(kms_category_audit.py).
- **10-13** `[classifier]` LG 분류 taxonomy 운영 이관(재시작 0) — 5계층 119노드 + 벡터, reload API.
- **10-13** `[admin]` FAQ content_format/display_policy를 admin API에 추가(POST /faq 기본 html) — LightRAG 직접수정 대신 통합어드민 경유. `84053480` (본부장님)
- **10-13~20** `[doc]` LG 시연 대본 2종(배송 중 파손 교환 / 단순 변심 반품) 작성 — 실측 기반, VOC 반영.
- **10-02** `[admin][data]` 추천(/api/external/recommend) 통합어드민 운영 배포 + LG 요약(젠데스크식)·브랜드 21·실스크립트 6개 반영, 명세서 external 통일.

## 2026-09

- **09-30** `[data]` LG생활건강 11월 오픈 — KMS 우선 개발 선구축(테넌트 + 3팀 카테고리 + 스타터 FAQ). 벤치 keyword 81% / hybrid 94%.
- **09-21** `[classifier]` 더본 정답률 개선 운영 반영 — 검색 힌트 42 + HTML 오염 해소 + LLM 리랭크(설명 필수). 엄격 정확도 46→60% 실측. 추천 중계 API(dev 9860) 가동.
- **09-18** `[classifier]` 더본 실콜 341콜 2기간 정독 → 정답셋·신규 유형 제안서. 커버 22% / 유형 밖 78%, 부재중 필터 권고.
- **09-16~17** `[classifier][data]` LG생활건강 이관 — 상담유형·책임부서 5계층(119노드) taxonomy, 팀-거래선 21회선 매핑.
- **09-16** `[classifier]` 더본코리아 분류기 운영 가동 — 노드 229 + 벡터 169 복사 + reload API로 **재시작 0** 이관. 스모크·요약 정상.
- **09-16** `[classifier]` KEVCS 분류 오류 회귀 게이트 영구 구축 — 60건, 80%↑ 정상 / 75%↓ 의심 자동 판정(품질 가드).
- **09-04** `[classifier]` KEVCS 분류 오류 완결 실증 — 8/31 운영 반영분 검증, 오버라이드(재판정) 47→19%로 감소.
- **09-01~03** `[admin]` 검색 응답에 FAQ 표시 판정(faq_display: solo/list/none) + 테넌트 단위 기준값 3단 조절 API(GET/PUT/DELETE /api/tenants/{id}/faq-display, 감사로그) + 고객센터 표시기준 모달. `dc4d8511`, `0080ad83`
- **09-01~03** `[data]` 더본코리아 FAQ 설계·배포 및 온보딩 재구축 — 210건(99%), faq_display 서버 판정/조절.

---

## 상시 참고 (git 밖 자산 — pull로 오지 않음)

- `[classifier]` 분류기는 별도 시스템(운영 16050/개발 16070). taxonomy·벡터는 DB/qdrant. 절차서: `TA_history/*_classifier_migration/`
- `[webhook]` 게시판 웹훅은 `/home/kms-webhook`(이 repo 밖). A안 보존본·배포 스크립트: `TA_history/LG생활건강_준비/02_KMS구축/`
- `[data]` 테넌트/카테고리/FAQ/벡터는 데이터(코드 아님). 운영 테넌트: LG=tenant_dca4091cc9aa(lghnh), 더본=tenant_108868539a69(theborn), KEVCS=default. 온보딩/구축 스크립트: `TA_history/`
- `ecosystem.config.cjs`는 배포 보류로 개발 작업트리에서만 병합 전으로 되돌려 둠(origin에는 `.env.production` 외부화 버전). 배포 시 서버별 `.env.production` 선행 필요.
