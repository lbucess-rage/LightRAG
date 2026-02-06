---
name: url-knowledge-ingestion
description: URL에서 콘텐츠를 추출하여 지식그래프로 변환하는 기능을 LightRAG에 통합
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Task
  - WebSearch
  - AskUserQuestion
---

# URL Knowledge Ingestion 스킬

RAG-Anything의 URL 지식화 기능을 LightRAG에 직접 통합합니다.

## 핵심 미션

> 웹 URL에서 콘텐츠를 크롤링/파싱하여
> 텍스트, 이미지, 테이블을 추출하고 지식그래프로 변환한다.

---

## 소스 코드 참조 (RAG-Anything)

### 핵심 파일 위치

| 컴포넌트 | 파일 경로 | 설명 |
|----------|----------|------|
| **URL Detector** | `/home/kms-rag/RAG-Anything/raganything/url/detector.py` | URL 검증, 정규화 |
| **Web Fetcher** | `/home/kms-rag/RAG-Anything/raganything/url/fetcher.py` | 웹 콘텐츠 가져오기 |
| **HTML Parser** | `/home/kms-rag/RAG-Anything/raganything/url/parser.py` | HTML→마크다운 변환 |
| **Content Converter** | `/home/kms-rag/RAG-Anything/raganything/url/converter.py` | content_list 변환 |
| **URL Crawler** | `/home/kms-rag/RAG-Anything/raganything/url/crawler.py` | 재귀 크롤링 |
| **URL Service** | `/home/kms-rag/RAG-Anything/raganything/url/service.py` | 메인 오케스트레이터 |
| **Package Init** | `/home/kms-rag/RAG-Anything/raganything/url/__init__.py` | Export 정의 |

### Backend 서비스

| 컴포넌트 | 파일 경로 | 설명 |
|----------|----------|------|
| **URL Service (Backend)** | `/home/kms-rag/RAG-Anything/server/backend/app/services/url_service.py` | 비동기 태스크 관리 |
| **URL API** | `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/url.py` | REST API 엔드포인트 |

---

## 주요 기능

### 1. URL 검증 및 정규화

**URLDetector** (`detector.py`)
- URL 유효성 검사
- 프로토콜 정규화 (http→https)
- 도메인 추출
- doc_id 생성 (URL 해시)

### 2. 웹 콘텐츠 가져오기

**WebFetcher** (`fetcher.py`)
- 다중 프로바이더: `requests`, `jina`
- 타임아웃/재시도 설정
- 응답 캐싱
- User-Agent 관리

### 3. HTML 파싱

**HTMLParser** (`parser.py`)
- HTML → 마크다운 변환
- 텍스트 구조 보존 (헤더 계층)
- 이미지 URL 추출
- 테이블 마크다운 변환
- 링크 추출 (크롤링용)

### 4. Content 변환

**ContentConverter** (`converter.py`)
- 파싱 결과 → content_list 변환
- 이미지 다운로드 (크기 제한)
- 임시 파일 관리
- RAG-Anything 호환 형식

### 5. 크롤링

**URLCrawler** (`crawler.py`)
- 재귀 크롤링 (depth 제한)
- 도메인 제한
- URL 패턴 필터링
- Rate limiting
- 크롤링 통계

---

## 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  URL Knowledge Pipeline                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Stages: VALIDATE → CRAWL → FETCH → PARSE → CONVERT → INGEST → COMPLETE    │
│                                                                              │
│  ┌────────────────┐                                                         │
│  │  URLDetector   │  1. URL 검증, 정규화, doc_id 생성                       │
│  └───────┬────────┘                                                         │
│          ▼                                                                   │
│  ┌────────────────┐                                                         │
│  │  URLCrawler    │  2. (선택) 링크된 페이지 재귀 크롤링                    │
│  │  (Optional)    │     - depth 제한, 도메인 제한                           │
│  └───────┬────────┘                                                         │
│          ▼                                                                   │
│  ┌────────────────┐                                                         │
│  │  WebFetcher    │  3. HTTP 요청으로 콘텐츠 가져오기                       │
│  │                │     - 프로바이더: requests, jina                        │
│  └───────┬────────┘                                                         │
│          ▼                                                                   │
│  ┌────────────────┐                                                         │
│  │  HTMLParser    │  4. HTML → 마크다운 변환                                │
│  │                │     - 텍스트, 이미지, 테이블, 링크 추출                 │
│  └───────┬────────┘                                                         │
│          ▼                                                                   │
│  ┌────────────────┐                                                         │
│  │ContentConverter│  5. → content_list 형식 변환                            │
│  │                │     - 이미지 다운로드, 임시 파일 관리                   │
│  └───────┬────────┘                                                         │
│          ▼                                                                   │
│  ┌────────────────┐                                                         │
│  │  LightRAG     │  6. content_list → 지식그래프                           │
│  │  .ainsert()    │     - 텍스트 + 멀티모달 처리                            │
│  └────────────────┘                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 명령어

| 명령어 | 설명 |
|--------|------|
| `status` | 구현 상태 확인 |
| `analyze <component>` | 특정 컴포넌트 분석 |
| `implement <phase>` | 단계별 구현 |
| `test <url>` | URL 처리 테스트 |

---

## 개발 로드맵

### Phase 1: 기반 컴포넌트
- [ ] URLDetector 이식
- [ ] WebFetcher 이식
- [ ] HTMLParser 이식

### Phase 2: 변환 로직
- [ ] ContentConverter 이식
- [ ] 임시 파일 관리

### Phase 3: 크롤링
- [ ] URLCrawler 이식
- [ ] Rate limiting

### Phase 4: API 통합
- [ ] ainsert_url() 메서드 추가
- [ ] REST API 엔드포인트

---

## 참고 문서

| 문서 | 설명 |
|------|------|
| `source-mapping.md` | 소스 코드 매핑 상세 |
| `components.md` | 컴포넌트 상세 설계 |
| `crawler.md` | 크롤링 로직 상세 |
| `api-design.md` | API 설계 |
