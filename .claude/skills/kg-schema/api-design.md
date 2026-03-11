# Knowledge Graph Schema - API 설계

## 1. API 개요

### 1.1 기본 정보
- **Base Path**: `/api/schema`
- **인증**: Bearer Token (기존 LightRAG 인증 체계 사용)
- **Content-Type**: `application/json`

### 1.2 API 구조

```
/api/schema
├── /discover              # 스키마 발견
│   ├── POST /from-document   # 문서 기반 발견
│   ├── POST /from-domain     # 도메인 기반 추천
│   └── POST /hybrid          # 하이브리드 발견
│
├── /templates             # 템플릿 관리
│   ├── GET /                 # 목록 조회
│   ├── GET /{domain}         # 상세 조회
│   ├── POST /                # 생성
│   ├── PUT /{domain}         # 수정
│   ├── DELETE /{domain}      # 삭제
│   └── POST /merge           # 병합
│
├── /apply                 # 스키마 적용
│   ├── POST /current         # 현재 세션에 적용
│   └── GET /current          # 현재 적용된 스키마 조회
│
└── /analyze               # 분석
    ├── POST /validate        # 스키마 유효성 검증
    └── POST /compare         # 스키마 비교
```

---

## 2. Schema Discovery API

### 2.1 문서 기반 스키마 발견

```http
POST /api/schema/discover/from-document
```

**Request:**
```json
{
  "documents": [
    {
      "content": "고객이 오배송 문의를 했습니다...",
      "file_path": "inquiry_001.txt"
    }
  ],
  "options": {
    "sample_size": 5,
    "include_relations": true,
    "language": "Korean",
    "max_entity_types": 15,
    "max_relation_types": 20
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "entity_types": [
      {
        "name": "Customer",
        "display_name": "고객",
        "description": "서비스를 이용하는 고객",
        "examples": ["구매자", "회원", "이용자"],
        "confidence": 0.95
      },
      {
        "name": "InquiryType",
        "display_name": "문의 유형",
        "description": "고객 문의의 분류",
        "examples": ["오배송 문의", "환불 요청"],
        "confidence": 0.92
      }
    ],
    "relation_types": [
      {
        "name": "SUBMITTED",
        "display_name": "접수함",
        "description": "고객이 문의를 접수",
        "source_types": ["Customer"],
        "target_types": ["InquiryType"],
        "confidence": 0.88
      }
    ],
    "sample_extractions": [
      {
        "text": "고객이 오배송 문의를 했습니다",
        "entities": [
          {"name": "고객", "type": "Customer"},
          {"name": "오배송 문의", "type": "InquiryType"}
        ],
        "relations": [
          {"source": "고객", "relation": "SUBMITTED", "target": "오배송 문의"}
        ]
      }
    ],
    "similar_templates": ["contact_center", "customer_service"],
    "overall_confidence": 0.89
  }
}
```

### 2.2 도메인 기반 스키마 추천

```http
POST /api/schema/discover/from-domain
```

**Request:**
```json
{
  "domains": ["contact_center", "delivery_service"],
  "options": {
    "merge_strategy": "union",
    "resolve_conflicts": "first"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "merged_schema": {
      "entity_types": [...],
      "relation_types": [...]
    },
    "source_templates": [
      {
        "domain": "contact_center",
        "contributed_entities": ["Customer", "Agent", "InquiryType"],
        "contributed_relations": ["SUBMITTED", "HANDLED"]
      },
      {
        "domain": "delivery_service",
        "contributed_entities": ["DeliveryInfo", "Store"],
        "contributed_relations": ["DELIVERED_TO"]
      }
    ],
    "conflicts_resolved": [
      {
        "type": "entity",
        "name": "Customer",
        "resolution": "merged from both templates"
      }
    ]
  }
}
```

### 2.3 하이브리드 발견 (문서 + 도메인)

```http
POST /api/schema/discover/hybrid
```

**Request:**
```json
{
  "documents": [...],
  "domain_hints": ["contact_center"],
  "options": {
    "template_weight": 0.3,
    "discovery_weight": 0.7
  }
}
```

---

## 3. Schema Templates API

### 3.1 템플릿 목록 조회

```http
GET /api/schema/templates?tags=customer,service&limit=10
```

**Response:**
```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "domain": "contact_center",
        "display_name": "컨택센터 상담",
        "description": "고객 상담 및 문의 처리",
        "entity_count": 12,
        "relation_count": 15,
        "tags": ["customer", "service", "support"],
        "version": "1.0.0"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 10
  }
}
```

### 3.2 템플릿 상세 조회

```http
GET /api/schema/templates/contact_center
```

**Response:**
```json
{
  "success": true,
  "data": {
    "domain": "contact_center",
    "display_name": "컨택센터 상담",
    "description": "고객 상담 및 문의 처리를 위한 스키마",
    "entity_types": [
      {
        "name": "Customer",
        "display_name": "고객",
        "description": "서비스를 이용하는 고객",
        "examples": ["구매자", "회원"],
        "color": "#4CAF50",
        "icon": "person"
      }
    ],
    "relation_types": [
      {
        "name": "SUBMITTED",
        "display_name": "접수함",
        "description": "고객이 문의를 접수",
        "source_types": ["Customer"],
        "target_types": ["InquiryType"]
      }
    ],
    "version": "1.0.0",
    "tags": ["customer", "service"],
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-20T15:30:00Z"
  }
}
```

### 3.3 템플릿 생성

```http
POST /api/schema/templates
```

**Request:**
```json
{
  "domain": "my_custom_domain",
  "display_name": "내 커스텀 도메인",
  "description": "커스텀 스키마 설명",
  "entity_types": [
    {
      "name": "CustomEntity",
      "display_name": "커스텀 엔티티",
      "description": "설명",
      "examples": ["예시1", "예시2"]
    }
  ],
  "relation_types": [...],
  "tags": ["custom"]
}
```

### 3.4 템플릿 병합

```http
POST /api/schema/templates/merge
```

**Request:**
```json
{
  "domains": ["contact_center", "delivery_service", "ecommerce"],
  "new_domain": "unified_retail",
  "options": {
    "merge_strategy": "union",
    "conflict_resolution": "manual",
    "save_as_template": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "merged_schema": {...},
    "conflicts": [
      {
        "type": "entity",
        "name": "Product",
        "sources": ["delivery_service", "ecommerce"],
        "descriptions": [
          "배송 상품",
          "판매 상품"
        ],
        "resolution_options": ["keep_first", "keep_second", "merge", "custom"]
      }
    ],
    "requires_manual_resolution": true
  }
}
```

---

## 4. Schema Apply API

### 4.1 현재 세션에 스키마 적용

```http
POST /api/schema/apply/current
```

**Request:**
```json
{
  "source": "template",
  "domain": "contact_center"
}
```

또는:

```json
{
  "source": "custom",
  "entity_types": ["Customer", "Agent", "InquiryType"],
  "relation_types": ["SUBMITTED", "HANDLED"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "applied_schema": {
      "entity_types": ["Customer", "Agent", "InquiryType", ...],
      "source": "template:contact_center"
    },
    "previous_schema": {
      "entity_types": ["Person", "Organization", ...]
    }
  }
}
```

### 4.2 현재 적용된 스키마 조회

```http
GET /api/schema/apply/current
```

**Response:**
```json
{
  "success": true,
  "data": {
    "entity_types": ["Customer", "Agent", "InquiryType"],
    "source": "template:contact_center",
    "applied_at": "2024-01-20T15:30:00Z"
  }
}
```

---

## 5. Schema Analysis API

### 5.1 스키마 유효성 검증

```http
POST /api/schema/analyze/validate
```

**Request:**
```json
{
  "schema": {
    "entity_types": [...],
    "relation_types": [...]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": false,
    "errors": [
      {
        "type": "relation",
        "name": "SUBMITTED",
        "error": "source_type 'InvalidEntity' not found in entity_types"
      }
    ],
    "warnings": [
      {
        "type": "entity",
        "name": "Customer",
        "warning": "No relations defined for this entity type"
      }
    ]
  }
}
```

### 5.2 스키마 비교

```http
POST /api/schema/analyze/compare
```

**Request:**
```json
{
  "schema_a": {
    "source": "template",
    "domain": "contact_center"
  },
  "schema_b": {
    "source": "custom",
    "entity_types": [...]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "entity_comparison": {
      "only_in_a": ["Agent", "Resolution"],
      "only_in_b": ["Operator"],
      "common": ["Customer", "InquiryType"],
      "different_definitions": [
        {
          "name": "Customer",
          "a_description": "서비스 이용 고객",
          "b_description": "구매 고객"
        }
      ]
    },
    "relation_comparison": {
      "only_in_a": ["ESCALATED_TO"],
      "only_in_b": [],
      "common": ["SUBMITTED", "HANDLED"]
    },
    "similarity_score": 0.72
  }
}
```

---

## 6. 에러 응답

### 6.1 에러 형식

```json
{
  "success": false,
  "error": {
    "code": "TEMPLATE_NOT_FOUND",
    "message": "Template 'unknown_domain' not found",
    "details": {
      "requested_domain": "unknown_domain",
      "available_domains": ["contact_center", "delivery_service"]
    }
  }
}
```

### 6.2 에러 코드

| 코드 | HTTP 상태 | 설명 |
|------|----------|------|
| `TEMPLATE_NOT_FOUND` | 404 | 템플릿을 찾을 수 없음 |
| `TEMPLATE_EXISTS` | 409 | 이미 존재하는 템플릿 |
| `INVALID_SCHEMA` | 400 | 스키마 형식 오류 |
| `DISCOVERY_FAILED` | 500 | 스키마 발견 실패 |
| `MERGE_CONFLICT` | 409 | 병합 충돌 (수동 해결 필요) |
| `LLM_ERROR` | 503 | LLM 서비스 오류 |

---

## 7. 라우터 구현 가이드

### 7.1 파일 위치

```
lightrag/api/routers/schema_routes.py
```

### 7.2 라우터 등록

```python
# lightrag/api/lightrag_server.py

from lightrag.api.routers.schema_routes import router as schema_router

app.include_router(schema_router, prefix="/api/schema", tags=["Schema"])
```

### 7.3 의존성

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lightrag.schema.discovery import SchemaDiscoveryEngine
from lightrag.schema.templates import SchemaTemplateManager
from lightrag.schema.models import DomainSchema, EntityType, RelationType
```
