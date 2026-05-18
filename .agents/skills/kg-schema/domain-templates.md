# Knowledge Graph Schema - 도메인 템플릿

## 1. 템플릿 개요

이 문서는 사전 정의된 도메인별 스키마 템플릿을 정의합니다.
각 템플릿은 해당 도메인의 일반적인 엔티티 타입과 관계 유형을 포함합니다.

---

## 2. 컨택센터 상담 (contact_center)

### 2.1 기본 정보

```json
{
  "domain": "contact_center",
  "display_name": "컨택센터 상담",
  "description": "고객 상담 및 문의 처리를 위한 스키마",
  "version": "1.0.0",
  "tags": ["customer", "service", "support", "inquiry"]
}
```

### 2.2 엔티티 타입

| 이름 | 표시명 | 설명 | 예시 |
|------|--------|------|------|
| Customer | 고객 | 서비스를 이용하는 고객 | 구매자, 회원, 이용자 |
| Agent | 상담원 | 고객 문의를 처리하는 직원 | 상담사, 담당자, 선임 |
| InquiryType | 문의 유형 | 고객 문의의 분류 | 오배송, 환불, 교환, 결제 문의 |
| Product | 상품 | 거래 대상 상품/서비스 | 택배 상품, 구독 서비스 |
| Order | 주문 | 주문 정보 | 주문번호, 주문 건 |
| DeliveryInfo | 배송 정보 | 배송 관련 정보 | 운송장번호, 배송상태 |
| Store | 매장 | 매장/지점 | GS25신도림역점, 강남점 |
| Channel | 채널 | 문의/알림 채널 | 알림톡, 이메일, 전화 |
| System | 시스템 | 내부 시스템/플랫폼 | 리테일 시스템, CRM |
| Policy | 정책 | 정책/규정/약관 | 환불 정책, 배송 규정 |
| Resolution | 해결 방안 | 문의 해결 방법 | 재배송, 환불 완료, 포인트 보상 |
| Issue | 이슈 | 문제/장애 상황 | 시스템 오류, 연동 실패 |

### 2.3 관계 타입

| 이름 | 표시명 | 소스 → 타겟 | 설명 |
|------|--------|-------------|------|
| SUBMITTED | 접수함 | Customer → InquiryType | 고객이 문의를 접수 |
| HANDLED | 처리함 | Agent → InquiryType | 상담원이 문의를 처리 |
| RESOLVED_WITH | 해결됨 | InquiryType → Resolution | 문의가 방안으로 해결 |
| ESCALATED_TO | 이관됨 | InquiryType → Agent | 상위 담당자로 이관 |
| EXPERIENCED | 경험함 | Customer → Issue | 고객이 문제 경험 |
| CAUSED_BY | 원인됨 | InquiryType → Issue | 문의의 원인 |
| RELATED_TO | 관련됨 | Order → Product | 주문에 상품 포함 |
| DELIVERED_TO | 배송됨 | DeliveryInfo → Store | 배송 목적지 |
| RECEIVED_VIA | 접수채널 | InquiryType → Channel | 문의 접수 채널 |
| GOVERNED_BY | 적용됨 | InquiryType → Policy | 정책 적용 |
| AFFECTED_BY | 영향받음 | System → Issue | 시스템이 이슈 영향 |

---

## 3. 택배/배송 서비스 (delivery_service)

### 3.1 기본 정보

```json
{
  "domain": "delivery_service",
  "display_name": "택배/배송 서비스",
  "description": "배송 및 물류 관리를 위한 스키마",
  "version": "1.0.0",
  "tags": ["delivery", "logistics", "shipping", "parcel"]
}
```

### 3.2 엔티티 타입

| 이름 | 표시명 | 설명 | 예시 |
|------|--------|------|------|
| Sender | 발송인 | 택배를 보내는 사람/업체 | 판매자, 발송 업체 |
| Recipient | 수령인 | 택배를 받는 사람 | 구매자, 수취인 |
| Courier | 배송기사 | 배송을 담당하는 기사 | 택배기사, 배달원 |
| Parcel | 택배 | 배송 물품 | 소포, 화물 |
| TrackingNumber | 운송장번호 | 배송 추적 번호 | 123456789 |
| DeliveryStatus | 배송상태 | 배송 진행 상태 | 집하, 배송중, 배송완료 |
| Hub | 물류센터 | 물류 허브/터미널 | 대전 허브, 용인 물류센터 |
| PickupPoint | 픽업포인트 | 수령 장소 | 편의점, 무인택배함 |
| Vehicle | 배송차량 | 배송 수단 | 화물차, 오토바이 |
| DeliveryTime | 배송시간 | 배송 시간대 | 오전배송, 새벽배송 |

### 3.3 관계 타입

| 이름 | 표시명 | 소스 → 타겟 | 설명 |
|------|--------|-------------|------|
| SENT_BY | 발송됨 | Parcel → Sender | 발송인이 보냄 |
| RECEIVED_BY | 수령됨 | Parcel → Recipient | 수령인이 받음 |
| DELIVERED_BY | 배송됨 | Parcel → Courier | 기사가 배송 |
| HAS_STATUS | 상태 | Parcel → DeliveryStatus | 배송 상태 |
| TRACKED_BY | 추적됨 | Parcel → TrackingNumber | 운송장으로 추적 |
| PASSED_THROUGH | 경유함 | Parcel → Hub | 물류센터 경유 |
| PICKED_UP_AT | 수령처 | Parcel → PickupPoint | 픽업 장소 |
| TRANSPORTED_BY | 운송됨 | Parcel → Vehicle | 차량으로 운송 |
| SCHEDULED_FOR | 예정됨 | Parcel → DeliveryTime | 배송 시간대 |

---

## 4. 전기차 충전 서비스 (ev_charging)

### 4.1 기본 정보

```json
{
  "domain": "ev_charging",
  "display_name": "전기차 충전 서비스",
  "description": "EV 충전 인프라 관리를 위한 스키마",
  "version": "1.0.0",
  "tags": ["ev", "charging", "energy", "electric_vehicle"]
}
```

### 4.2 엔티티 타입

| 이름 | 표시명 | 설명 | 예시 |
|------|--------|------|------|
| EVOwner | EV 소유자 | 전기차 소유자/이용자 | 회원, 비회원 |
| ElectricVehicle | 전기차 | 전기 자동차 | 아이오닉5, 테슬라 Model 3 |
| ChargingStation | 충전소 | 충전 시설 | 강남역 충전소, 이마트 충전소 |
| Charger | 충전기 | 개별 충전기 | 급속충전기, 완속충전기 |
| ChargingSession | 충전 세션 | 충전 이용 기록 | 충전 시작/종료 |
| ChargingPlan | 요금제 | 충전 요금제 | 월정액, 종량제 |
| PaymentMethod | 결제수단 | 결제 방식 | 신용카드, 회원카드, 앱결제 |
| ChargingSpeed | 충전속도 | 충전 속도 유형 | 급속(50kW), 초급속(350kW) |
| Connector | 커넥터 | 충전 커넥터 타입 | DC콤보, AC3상, 차데모 |
| ErrorCode | 에러코드 | 충전 오류 코드 | E001, E002 |
| Operator | 운영사 | 충전소 운영 업체 | 한국전력, 에버온 |

### 4.3 관계 타입

| 이름 | 표시명 | 소스 → 타겟 | 설명 |
|------|--------|-------------|------|
| OWNS | 소유함 | EVOwner → ElectricVehicle | 차량 소유 |
| CHARGED_AT | 충전함 | ElectricVehicle → ChargingStation | 충전 장소 |
| USED | 사용함 | ChargingSession → Charger | 충전기 사용 |
| SUBSCRIBED_TO | 가입됨 | EVOwner → ChargingPlan | 요금제 가입 |
| PAID_WITH | 결제됨 | ChargingSession → PaymentMethod | 결제 수단 |
| SUPPORTS | 지원함 | Charger → ChargingSpeed | 지원 속도 |
| HAS_CONNECTOR | 커넥터 | Charger → Connector | 커넥터 타입 |
| REPORTED | 발생함 | Charger → ErrorCode | 에러 발생 |
| OPERATED_BY | 운영됨 | ChargingStation → Operator | 운영 업체 |
| LOCATED_AT | 위치함 | Charger → ChargingStation | 충전기 위치 |

---

## 5. 의류 이커머스 (fashion_ecommerce)

### 5.1 기본 정보

```json
{
  "domain": "fashion_ecommerce",
  "display_name": "의류 이커머스",
  "description": "패션/의류 온라인 쇼핑몰을 위한 스키마",
  "version": "1.0.0",
  "tags": ["fashion", "ecommerce", "clothing", "retail"]
}
```

### 5.2 엔티티 타입

| 이름 | 표시명 | 설명 | 예시 |
|------|--------|------|------|
| Customer | 고객 | 쇼핑몰 이용 고객 | 회원, 비회원 |
| Product | 상품 | 판매 상품 | 티셔츠, 청바지 |
| Brand | 브랜드 | 의류 브랜드 | 나이키, 자라 |
| Category | 카테고리 | 상품 분류 | 상의, 하의, 아우터 |
| Size | 사이즈 | 의류 사이즈 | S, M, L, XL |
| Color | 색상 | 상품 색상 | 블랙, 화이트, 네이비 |
| Order | 주문 | 주문 정보 | 주문번호 |
| Review | 리뷰 | 상품 리뷰 | 별점, 후기 |
| Coupon | 쿠폰 | 할인 쿠폰 | 10% 할인, 무료배송 |
| WishList | 위시리스트 | 찜 목록 | 관심상품 |
| Cart | 장바구니 | 장바구니 | 담긴 상품 |
| Promotion | 프로모션 | 이벤트/할인 | 시즌오프, 타임세일 |
| Seller | 판매자 | 상품 판매자 | 공식스토어, 입점업체 |

### 5.3 관계 타입

| 이름 | 표시명 | 소스 → 타겟 | 설명 |
|------|--------|-------------|------|
| PURCHASED | 구매함 | Customer → Product | 상품 구매 |
| REVIEWED | 리뷰함 | Customer → Product | 리뷰 작성 |
| WISHLISTED | 찜함 | Customer → Product | 위시리스트 추가 |
| BELONGS_TO | 소속됨 | Product → Category | 카테고리 분류 |
| MADE_BY | 제조됨 | Product → Brand | 브랜드 제조 |
| AVAILABLE_IN | 사이즈 | Product → Size | 사용 가능 사이즈 |
| HAS_COLOR | 색상 | Product → Color | 상품 색상 |
| APPLIED | 적용됨 | Coupon → Order | 쿠폰 적용 |
| SOLD_BY | 판매됨 | Product → Seller | 판매자 |
| INCLUDED_IN | 포함됨 | Product → Promotion | 프로모션 대상 |
| ADDED_TO_CART | 담김 | Product → Cart | 장바구니 담김 |

---

## 6. 복합 도메인 예시

### 6.1 컨택센터 + 택배 (contact_center_delivery)

**사용 시나리오**: 택배 서비스의 고객 상담 센터

```json
{
  "domain": "contact_center_delivery",
  "display_name": "택배 고객센터",
  "description": "택배 서비스 고객 상담을 위한 통합 스키마",
  "extends": ["contact_center", "delivery_service"],
  "version": "1.0.0"
}
```

**병합 시 엔티티 매핑**:
- `contact_center.Customer` = `delivery_service.Recipient` → `Customer`로 통합
- `contact_center.DeliveryInfo` ↔ `delivery_service.TrackingNumber` → 모두 유지

### 6.2 이커머스 + 컨택센터 (ecommerce_support)

**사용 시나리오**: 쇼핑몰 고객 지원 센터

```json
{
  "domain": "ecommerce_support",
  "display_name": "쇼핑몰 고객지원",
  "description": "이커머스 고객 지원을 위한 통합 스키마",
  "extends": ["fashion_ecommerce", "contact_center"],
  "version": "1.0.0"
}
```

---

## 7. 템플릿 JSON 형식

### 7.1 전체 형식

```json
{
  "domain": "template_id",
  "display_name": "표시 이름",
  "description": "상세 설명",
  "version": "1.0.0",
  "tags": ["tag1", "tag2"],
  "extends": [],
  "entity_types": [
    {
      "name": "EntityName",
      "display_name": "엔티티 표시명",
      "description": "엔티티 설명",
      "examples": ["예시1", "예시2"],
      "color": "#4CAF50",
      "icon": "icon_name",
      "extraction_hints": ["추출 힌트"]
    }
  ],
  "relation_types": [
    {
      "name": "RELATION_NAME",
      "display_name": "관계 표시명",
      "description": "관계 설명",
      "source_types": ["SourceEntity"],
      "target_types": ["TargetEntity"],
      "is_directional": true,
      "cardinality": "N:M",
      "examples": ["A가 B를 한다"]
    }
  ],
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-20T15:30:00Z",
  "author": "system"
}
```

---

## 8. 템플릿 추가 가이드

### 8.1 새 도메인 템플릿 생성 체크리스트

- [ ] 도메인 식별자 결정 (영문 소문자, 언더스코어)
- [ ] 핵심 엔티티 타입 정의 (5-15개 권장)
- [ ] 핵심 관계 타입 정의 (5-20개 권장)
- [ ] 각 엔티티에 대한 예시 추가
- [ ] 관계의 소스/타겟 타입 지정
- [ ] 태그 추가 (검색용)
- [ ] 버전 명시

### 8.2 좋은 템플릿의 특성

1. **포괄성**: 도메인의 주요 개념을 모두 커버
2. **명확성**: 엔티티/관계 간 구분이 명확
3. **실용성**: 실제 문서에서 추출 가능한 수준
4. **확장성**: 다른 도메인과 병합 가능
