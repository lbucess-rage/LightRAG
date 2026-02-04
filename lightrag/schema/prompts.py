"""
Schema Discovery Prompts

스키마 발견을 위한 LLM 프롬프트 정의입니다.
"""

# =============================================================================
# Schema Discovery Prompts
# =============================================================================

SCHEMA_DISCOVERY_SYSTEM_PROMPT = """당신은 지식 그래프 스키마 설계 전문가입니다.
주어진 문서를 분석하여 해당 도메인에 적합한 엔티티 타입과 관계 타입을 추출합니다.

## 추출 원칙

1. **도메인 특화**: 범용적인 타입(Person, Organization) 대신 도메인에 맞는 구체적인 타입을 사용합니다.
   - 나쁜 예: Person → 좋은 예: Customer, Agent, Courier

2. **일관성**: 동일한 개념에 대해 일관된 이름을 사용합니다.
   - 고객, 구매자, 회원 → Customer로 통일

3. **계층 구분**: 상위/하위 개념을 구분합니다.
   - 문의 유형(InquiryType)과 개별 문의(오배송 문의)를 구분

4. **관계 방향성**: 관계는 명확한 방향을 가집니다.
   - Customer -[SUBMITTED]-> InquiryType (O)
   - Customer -[INQUIRY]-> InquiryType (X, 모호함)

5. **실용성**: 실제로 추출 가능한 수준의 타입만 정의합니다.

## 이름 규칙

- 엔티티 타입: PascalCase (예: Customer, InquiryType, DeliveryInfo)
- 관계 타입: UPPER_SNAKE_CASE (예: SUBMITTED, HANDLED_BY, DELIVERED_TO)

## 출력 형식

반드시 아래 JSON 형식으로 출력하세요:

```json
{
  "entity_types": [
    {
      "name": "EnglishName",
      "display_name": "한글표시명",
      "description": "이 엔티티 타입에 대한 설명",
      "examples": ["예시1", "예시2", "예시3"]
    }
  ],
  "relation_types": [
    {
      "name": "RELATION_NAME",
      "display_name": "관계표시명",
      "description": "이 관계에 대한 설명",
      "source_types": ["SourceEntityType"],
      "target_types": ["TargetEntityType"]
    }
  ],
  "domain_summary": "이 문서 도메인에 대한 간략한 요약"
}
```"""

SCHEMA_DISCOVERY_USER_PROMPT = """다음 문서들을 분석하여 이 도메인에 적합한 엔티티 타입과 관계 타입을 추출해주세요.

## 문서 샘플

{document_samples}

## 요청 사항

1. 이 도메인의 핵심 엔티티 타입을 {max_entity_types}개 이내로 추출
2. 엔티티 간의 관계 타입을 {max_relation_types}개 이내로 추출
3. 각 타입에 대해 한글 표시명과 설명, 예시를 포함
4. 관계 타입은 소스/타겟 엔티티 타입을 명시

## 추가 컨텍스트

- 언어: {language}
- 도메인 힌트: {domain_hints}

JSON 형식으로 결과를 출력해주세요."""

# =============================================================================
# Schema Refinement Prompts
# =============================================================================

SCHEMA_REFINEMENT_SYSTEM_PROMPT = """당신은 지식 그래프 스키마 개선 전문가입니다.
초기 발견된 스키마를 검토하고 개선합니다.

## 개선 원칙

1. **중복 제거**: 유사한 타입을 통합
2. **누락 보완**: 빠진 중요 타입 추가
3. **명확화**: 모호한 정의를 구체화
4. **정규화**: 이름 규칙 통일 (PascalCase, UPPER_SNAKE_CASE)

## 출력 형식

개선된 스키마와 변경 사항을 함께 JSON으로 출력하세요:

```json
{
  "refined_schema": {
    "entity_types": [...],
    "relation_types": [...]
  },
  "changes": [
    {
      "type": "merge",
      "description": "변경 설명",
      "original": ["원본1", "원본2"],
      "result": "결과"
    }
  ]
}
```"""

SCHEMA_REFINEMENT_USER_PROMPT = """다음 초기 스키마를 검토하고 개선해주세요.

## 초기 스키마

{initial_schema}

## 원본 문서 샘플

{document_samples}

## 개선 요청

1. 유사하거나 중복된 타입 통합
2. 누락된 중요 타입 추가
3. 모호한 설명 구체화
4. 이름 규칙 정규화

개선된 스키마와 변경 내역을 JSON 형식으로 출력해주세요."""

# =============================================================================
# Domain-specific Hints
# =============================================================================

DOMAIN_HINTS = {
    "contact_center": """## 컨택센터/고객상담 도메인 특성

이 도메인에서 주로 다루는 개념:

### 주요 행위자
- 고객/이용자: 서비스를 이용하고 문의를 제기하는 사람
- 상담원/담당자: 문의를 처리하는 직원
- 관리자/팀장: 이관된 건을 처리하는 상위 담당자

### 주요 객체
- 문의/요청: 고객이 제기하는 다양한 유형의 문의
- 주문/거래: 문의와 관련된 주문 정보
- 상품/서비스: 거래 대상
- 정책/약관: 처리 기준이 되는 규정

### 주요 프로세스
- 접수 → 확인 → 처리 → 해결
- 이관/에스컬레이션
- 알림/통보

### 주요 채널
- 전화, 채팅, 이메일, 알림톡, 홈페이지""",

    "delivery_service": """## 배송/물류 도메인 특성

이 도메인에서 주로 다루는 개념:

### 주요 행위자
- 발송인: 물품을 보내는 사람/업체
- 수령인: 물품을 받는 사람
- 배송기사: 실제 배송을 담당하는 사람

### 주요 객체
- 택배/소포: 배송 대상 물품
- 운송장: 배송 추적을 위한 식별 정보
- 차량: 배송 수단

### 주요 장소
- 물류센터/허브: 물품이 집하되고 분류되는 곳
- 배송지: 최종 도착지
- 픽업포인트: 수령 장소 (편의점, 무인함 등)

### 주요 상태
- 집하 → 이동 → 배송중 → 배송완료
- 반송, 분실, 파손 등 예외 상태""",

    "ev_charging": """## 전기차 충전 도메인 특성

이 도메인에서 주로 다루는 개념:

### 주요 행위자
- EV 소유자: 전기차를 소유하고 충전하는 사람
- 운영사: 충전소를 운영하는 업체

### 주요 객체
- 전기차: 충전 대상 차량
- 충전소: 충전 시설
- 충전기: 개별 충전 장치
- 커넥터: 충전 연결 장치 (DC콤보, AC3상 등)

### 주요 정보
- 충전 세션: 충전 시작/종료 기록
- 요금제: 충전 요금 정책
- 결제 수단: 카드, 앱 등

### 주요 상태
- 대기 → 충전중 → 충전완료
- 에러, 점검중 등 예외 상태""",

    "ecommerce": """## 이커머스 도메인 특성

이 도메인에서 주로 다루는 개념:

### 주요 행위자
- 고객: 상품을 구매하는 사람
- 판매자: 상품을 판매하는 사람/업체

### 주요 객체
- 상품: 판매 대상
- 주문: 구매 거래
- 장바구니: 구매 예정 목록
- 위시리스트: 관심 상품 목록
- 리뷰: 상품 평가

### 주요 속성 (패션)
- 브랜드: 상품 브랜드
- 카테고리: 상품 분류
- 사이즈: 의류 사이즈
- 색상: 상품 색상

### 주요 프로세스
- 검색 → 장바구니 → 주문 → 결제 → 배송
- 반품, 교환, 환불""",
}

# =============================================================================
# Few-shot Examples
# =============================================================================

SCHEMA_DISCOVERY_EXAMPLES = """## 예시 입력

문서: "고객이 오배송 문의를 했습니다. 상담원이 운송장번호 123456을 확인하고,
GS25신도림역점으로 재배송 처리했습니다."

## 예시 출력

```json
{
  "entity_types": [
    {
      "name": "Customer",
      "display_name": "고객",
      "description": "서비스를 이용하고 문의를 제기하는 고객",
      "examples": ["고객", "구매자", "회원"]
    },
    {
      "name": "Agent",
      "display_name": "상담원",
      "description": "고객 문의를 처리하는 상담 직원",
      "examples": ["상담원", "담당자", "상담사"]
    },
    {
      "name": "InquiryType",
      "display_name": "문의 유형",
      "description": "고객이 제기하는 문의의 유형/카테고리",
      "examples": ["오배송 문의", "환불 요청", "배송 지연 문의"]
    },
    {
      "name": "DeliveryInfo",
      "display_name": "배송 정보",
      "description": "배송과 관련된 식별 정보",
      "examples": ["운송장번호", "송장번호", "배송추적번호"]
    },
    {
      "name": "Store",
      "display_name": "매장",
      "description": "배송 목적지인 매장/지점",
      "examples": ["GS25신도림역점", "편의점", "픽업지점"]
    },
    {
      "name": "Resolution",
      "display_name": "해결 방안",
      "description": "문의에 대한 처리 결과/해결 방법",
      "examples": ["재배송 처리", "환불 완료", "교환 처리"]
    }
  ],
  "relation_types": [
    {
      "name": "SUBMITTED",
      "display_name": "접수함",
      "description": "고객이 문의를 접수하는 관계",
      "source_types": ["Customer"],
      "target_types": ["InquiryType"]
    },
    {
      "name": "HANDLED",
      "display_name": "처리함",
      "description": "상담원이 문의를 처리하는 관계",
      "source_types": ["Agent"],
      "target_types": ["InquiryType"]
    },
    {
      "name": "VERIFIED",
      "display_name": "확인함",
      "description": "상담원이 배송 정보를 확인하는 관계",
      "source_types": ["Agent"],
      "target_types": ["DeliveryInfo"]
    },
    {
      "name": "RESOLVED_WITH",
      "display_name": "해결됨",
      "description": "문의가 특정 방안으로 해결되는 관계",
      "source_types": ["InquiryType"],
      "target_types": ["Resolution"]
    },
    {
      "name": "DELIVERED_TO",
      "display_name": "배송됨",
      "description": "상품이 매장으로 배송되는 관계",
      "source_types": ["Resolution"],
      "target_types": ["Store"]
    }
  ],
  "domain_summary": "고객 상담 센터에서의 배송 관련 문의 처리 도메인"
}
```"""
