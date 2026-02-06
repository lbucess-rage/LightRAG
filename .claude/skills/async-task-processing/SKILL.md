---
name: async-task-processing
description: 비동기 태스크 처리 및 실시간 진행상황 스트리밍 기능을 LightRAG에 통합
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

# Async Task Processing 스킬

RAG-Anything의 비동기 태스크 처리 기능을 LightRAG에 직접 통합합니다.

## 핵심 미션

> 장시간 실행되는 작업(문서 처리, URL 인제스트 등)을
> 백그라운드에서 비동기 처리하고 실시간 진행상황을 SSE로 스트리밍한다.

---

## 소스 코드 참조 (RAG-Anything)

### 핵심 파일 위치

| 컴포넌트 | 파일 경로 | 설명 |
|----------|----------|------|
| **Task Service** | `/home/kms-rag/RAG-Anything/server/backend/app/services/task_service.py` | 태스크 관리 핵심 |
| **Task Model** | `/home/kms-rag/RAG-Anything/server/backend/app/models/task.py` | 태스크 데이터 모델 |
| **Task Enums** | `/home/kms-rag/RAG-Anything/server/backend/app/models/enums.py` | 상태/타입 열거형 |
| **Task API** | `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/tasks.py` | REST API 엔드포인트 |
| **Main App** | `/home/kms-rag/RAG-Anything/server/backend/app/main.py` | 앱 라이프사이클 |

### 관련 서비스

| 컴포넌트 | 파일 경로 | 설명 |
|----------|----------|------|
| **Document API** | `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/documents.py` | 문서 업로드 (태스크 사용) |
| **URL API** | `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/url.py` | URL 인제스트 (태스크 사용) |
| **URL Service** | `/home/kms-rag/RAG-Anything/server/backend/app/services/url_service.py` | URL 태스크 관리 |

---

## 주요 기능

### 1. Task Registry

**TaskRegistry** (In-Memory)
- 태스크 생성 및 저장
- 상태 업데이트
- SSE 구독자 관리
- LRU 기반 오래된 태스크 정리

### 2. Task Service

**TaskService** (Singleton)
- 태스크 생명주기 관리
- 진행상황 업데이트
- 백그라운드 실행
- SSE 스트리밍
- 로그 파일 저장

### 3. SSE Streaming

**Server-Sent Events**
- 실시간 진행상황 전달
- 30초 타임아웃 with 하트비트
- 자동 재연결 지원

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Async Task Processing Architecture                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Client Request                                                              │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  API Endpoint (e.g., POST /documents/upload-async)                  │   │
│  │                                                                      │   │
│  │  1. Create Task (TaskService.create_task)                           │   │
│  │  2. Queue background work (asyncio.create_task)                     │   │
│  │  3. Return task_id + stream_url                                     │   │
│  └────────────────────────────────┬────────────────────────────────────┘   │
│                                   │                                         │
│       ┌───────────────────────────┴───────────────────────────┐            │
│       │                                                       │            │
│       ▼                                                       ▼            │
│  ┌─────────────────────────┐              ┌─────────────────────────┐     │
│  │  Background Task        │              │  Client SSE Connection   │     │
│  │                         │              │                          │     │
│  │  • Execute work         │   Progress   │  GET /tasks/{id}/stream  │     │
│  │  • Update progress      │─────────────>│                          │     │
│  │  • Complete/Fail        │    Events    │  • Receive events        │     │
│  │                         │              │  • Show progress bar     │     │
│  └─────────────────────────┘              └─────────────────────────┘     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  TaskRegistry (In-Memory)                                            │   │
│  │                                                                      │   │
│  │  tasks: Dict[task_id, Task]                                          │   │
│  │  subscribers: Dict[task_id, List[asyncio.Queue]]                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Task Log Files (JSON)                                               │   │
│  │                                                                      │   │
│  │  /logs/tasks/{task_id}.json                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
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
| `test` | 태스크 처리 테스트 |

---

## 개발 로드맵

### Phase 1: 데이터 모델
- [ ] Task, TaskType, TaskStatus 모델 정의
- [ ] TaskProgressEvent 모델 정의

### Phase 2: Task Service
- [ ] TaskRegistry 구현
- [ ] TaskService 구현
- [ ] 로그 파일 저장

### Phase 3: SSE Streaming
- [ ] SSE 엔드포인트 구현
- [ ] 하트비트 구현
- [ ] 구독자 관리

### Phase 4: API 통합
- [ ] 기존 API에 async 버전 추가
- [ ] 클라이언트 예제

---

## 참고 문서

| 문서 | 설명 |
|------|------|
| `source-mapping.md` | 소스 코드 매핑 상세 |
| `task-model.md` | 태스크 모델 상세 |
| `sse-streaming.md` | SSE 스트리밍 상세 |
| `api-design.md` | API 설계 |
