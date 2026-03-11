# Knowledge Graph Schema - LLM 프롬프트 설계

## 1. 프롬프트 개요

### 1.1 목적
- 문서에서 도메인 특화 엔티티/관계 타입 발견
- 일관되고 구조화된 스키마 출력
- 높은 품질의 스키마 추출

### 1.2 프롬프트 유형

| 유형 | 용도 |
|------|------|
| Schema Discovery | 문서에서 스키마 발견 |
| Schema Refinement | 발견된 스키마 개선 |
| Schema Validation | 스키마 유효성 검증 |
| Entity Classification | 엔티티 분류 힌트 생성 |

---

## 2. Schema Discovery 프롬프트

### 2.1 System Prompt

```
당신은 지식 그래프 스키마 설계 전문가입니다.
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
```
```

### 2.2 User Prompt Template

```
다음 문서들을 분석하여 이 도메인에 적합한 엔티티 타입과 관계 타입을 추출해주세요.

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

JSON 형식으로 결과를 출력해주세요.
```

### 2.3 Few-shot Examples

```
## 예시 입력

문서: "고객이 오배송 문의를 했습니다. 상담원이 운송장번호 123456을 확인하고,
GS25신도림역점으로 재배송 처리했습니다."

## 예시 출력

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
```

---

## 3. Schema Refinement 프롬프트

### 3.1 System Prompt

```
당신은 지식 그래프 스키마 개선 전문가입니다.
초기 발견된 스키마를 검토하고 개선합니다.

## 개선 원칙

1. **중복 제거**: 유사한 타입을 통합
2. **누락 보완**: 빠진 중요 타입 추가
3. **명확화**: 모호한 정의를 구체화
4. **정규화**: 이름 규칙 통일 (PascalCase, UPPER_SNAKE_CASE)

## 출력 형식

개선된 스키마와 변경 사항을 함께 출력하세요:

```json
{
  "refined_schema": { ... },
  "changes": [
    {
      "type": "merge",
      "description": "Customer와 User를 Customer로 통합",
      "original": ["Customer", "User"],
      "result": "Customer"
    }
  ]
}
```
```

### 3.2 User Prompt Template

```
다음 초기 스키마를 검토하고 개선해주세요.

## 초기 스키마

{initial_schema}

## 원본 문서 샘플

{document_samples}

## 개선 요청

1. 유사하거나 중복된 타입 통합
2. 누락된 중요 타입 추가
3. 모호한 설명 구체화
4. 이름 규칙 정규화

개선된 스키마와 변경 내역을 JSON 형식으로 출력해주세요.
```

---

## 4. Domain-specific 프롬프트

### 4.1 컨택센터 도메인 힌트

```
## 컨택센터/고객상담 도메인 특성

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
- 전화, 채팅, 이메일, 알림톡, 홈페이지

이러한 특성을 고려하여 스키마를 설계하세요.
```

### 4.2 배송/물류 도메인 힌트

```
## 배송/물류 도메인 특성

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
- 반송, 분실, 파손 등 예외 상태

이러한 특성을 고려하여 스키마를 설계하세요.
```

---

## 5. 프롬프트 변수

### 5.1 공통 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `{language}` | 출력 언어 | Korean |
| `{max_entity_types}` | 최대 엔티티 타입 수 | 15 |
| `{max_relation_types}` | 최대 관계 타입 수 | 20 |
| `{document_samples}` | 문서 샘플 | - |
| `{domain_hints}` | 도메인 힌트 | 없음 |

### 5.2 문서 샘플 형식

```
--- 문서 1 ---
{document_1_content}

--- 문서 2 ---
{document_2_content}

...
```

---

## 6. 출력 파싱

### 6.1 JSON 추출 정규식

```python
import re
import json

def extract_json_from_response(response: str) -> dict:
    """LLM 응답에서 JSON 추출"""
    # 코드 블록 내 JSON 찾기
    json_match = re.search(r'```json?\s*([\s\S]*?)\s*```', response)
    if json_match:
        return json.loads(json_match.group(1))

    # 직접 JSON 객체 찾기
    json_match = re.search(r'\{[\s\S]*\}', response)
    if json_match:
        return json.loads(json_match.group(0))

    raise ValueError("JSON not found in response")
```

### 6.2 스키마 유효성 검증

```python
def validate_schema_output(schema: dict) -> list[str]:
    """스키마 출력 유효성 검증"""
    errors = []

    # 필수 필드 확인
    if "entity_types" not in schema:
        errors.append("entity_types 필드 누락")
    if "relation_types" not in schema:
        errors.append("relation_types 필드 누락")

    # 엔티티 타입 검증
    for et in schema.get("entity_types", []):
        if "name" not in et:
            errors.append(f"엔티티 타입에 name 누락: {et}")
        elif not re.match(r'^[A-Z][a-zA-Z0-9]*$', et["name"]):
            errors.append(f"잘못된 엔티티 이름 형식: {et['name']}")

    # 관계 타입 검증
    entity_names = {et["name"] for et in schema.get("entity_types", [])}
    for rt in schema.get("relation_types", []):
        if "name" not in rt:
            errors.append(f"관계 타입에 name 누락: {rt}")
        elif not re.match(r'^[A-Z][A-Z0-9_]*$', rt["name"]):
            errors.append(f"잘못된 관계 이름 형식: {rt['name']}")

        # 소스/타겟 타입 검증
        for st in rt.get("source_types", []):
            if st not in entity_names:
                errors.append(f"알 수 없는 소스 타입: {st} in {rt['name']}")
        for tt in rt.get("target_types", []):
            if tt not in entity_names:
                errors.append(f"알 수 없는 타겟 타입: {tt} in {rt['name']}")

    return errors
```

---

## 7. 프롬프트 최적화 팁

### 7.1 문서 샘플링 전략

1. **다양성**: 다양한 유형의 문서 포함
2. **대표성**: 도메인의 핵심 개념이 포함된 문서 선택
3. **적정량**: 3-5개 문서 샘플 (너무 많으면 노이즈)

### 7.2 반복 개선

```
초기 발견 → 검토 → 개선 요청 → 최종 스키마
```

1차 발견 결과의 신뢰도가 낮으면 추가 문서로 2차 발견 수행

### 7.3 도메인 힌트 활용

- 도메인을 알고 있으면 힌트 제공
- 복합 도메인인 경우 관련 도메인 모두 명시
- 특수 용어나 약어가 있으면 미리 설명
