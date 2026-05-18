---
name: multimodal-processing
description: 멀티모달 콘텐츠(이미지, 테이블, 수식) 처리 기능을 LightRAG에 통합
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

# Multimodal Processing 스킬

RAG-Anything의 멀티모달 처리 기능을 LightRAG에 직접 통합합니다.

## 핵심 미션

> 문서 내 이미지, 테이블, 수식 등 멀티모달 콘텐츠를 분석하여
> 텍스트와 동일한 수준의 지식그래프 엔티티로 변환한다.

---

## 소스 코드 참조 (RAG-Anything)

### 핵심 파일 위치

| 컴포넌트 | 파일 경로 | 설명 |
|----------|----------|------|
| **Main Class** | `/home/kms-rag/RAG-Anything/raganything/raganything.py` | RAGAnything 메인 클래스 |
| **Config** | `/home/kms-rag/RAG-Anything/raganything/config.py` | RAGAnythingConfig 설정 |
| **Modal Processors** | `/home/kms-rag/RAG-Anything/raganything/modalprocessors.py` | Image/Table/Equation 프로세서 |
| **Prompts** | `/home/kms-rag/RAG-Anything/raganything/prompt.py` | VLM/LLM 프롬프트 템플릿 |
| **Parsers** | `/home/kms-rag/RAG-Anything/raganything/parser.py` | MinerU/Docling 파서 |
| **Processor Mixin** | `/home/kms-rag/RAG-Anything/raganything/processor.py` | 문서 처리 로직 |
| **Query Mixin** | `/home/kms-rag/RAG-Anything/raganything/query.py` | 쿼리 처리 |
| **Batch Mixin** | `/home/kms-rag/RAG-Anything/raganything/batch.py` | 배치 처리 |
| **Batch Parser** | `/home/kms-rag/RAG-Anything/raganything/batch_parser.py` | 배치 파싱 |
| **Utils** | `/home/kms-rag/RAG-Anything/raganything/utils.py` | 유틸리티 함수 |
| **Base** | `/home/kms-rag/RAG-Anything/raganything/base.py` | 기본 클래스/타입 |

### Backend 서비스

| 컴포넌트 | 파일 경로 | 설명 |
|----------|----------|------|
| **RAGAnything Service** | `/home/kms-rag/RAG-Anything/server/backend/app/services/raganything_service.py` | 서비스 래퍼 |
| **Document API** | `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/documents.py` | 문서 업로드 API |
| **Document Service** | `/home/kms-rag/RAG-Anything/server/backend/app/services/document_service.py` | 문서 관리 |

---

## 주요 기능

### 1. 문서 파싱

**MineruParser** (`parser.py:MineruParser`)
- PDF, Office 문서, 이미지 파싱
- 텍스트, 이미지, 테이블, 수식 추출
- VLM 백엔드 지원 (vlm-auto-engine)

**출력 형식 (content_list):**
```python
[
    {"type": "text", "text": "...", "text_level": 0, "page_idx": 0},
    {"type": "image", "img_path": "/path.jpg", "image_caption": [...], "page_idx": 1},
    {"type": "table", "table_body": "| ... |", "table_caption": [...], "page_idx": 2},
    {"type": "equation", "text": "E=mc^2", "text_format": "latex", "page_idx": 3}
]
```

### 2. Modal Processors

**BaseModalProcessor** (`modalprocessors.py:BaseModalProcessor`)
- LightRAG 스토리지 직접 접근
- 엔티티/청크 생성 공통 로직
- JSON 파싱 (다중 전략)

**ImageModalProcessor** (`modalprocessors.py:ImageModalProcessor`)
- VLM 기반 이미지 분석
- Base64 인코딩
- 시각적 요소 추출 (객체, 텍스트 OCR, 레이아웃)

**TableModalProcessor** (`modalprocessors.py:TableModalProcessor`)
- LLM 기반 테이블 분석
- 마크다운 형식 처리
- 헤더, 데이터 패턴, 인사이트 추출

**EquationModalProcessor** (`modalprocessors.py:EquationModalProcessor`)
- LLM 기반 수식 분석
- LaTeX 해석
- 수학적 의미 추출

### 3. Context Extraction

**ContextExtractor** (`modalprocessors.py:ContextExtractor`)
- 주변 텍스트 컨텍스트 추출
- Page/Chunk 모드 지원
- Token-aware 자르기

---

## 명령어

| 명령어 | 설명 |
|--------|------|
| `status` | 구현 상태 확인 |
| `analyze <component>` | 특정 컴포넌트 분석 |
| `implement <phase>` | 단계별 구현 |
| `test <component>` | 컴포넌트 테스트 |

---

## 개발 로드맵

### Phase 1: 기반 구축
- [ ] content_list 형식 정의
- [ ] BaseModalProcessor 이식
- [ ] ContextExtractor 이식

### Phase 2: 프로세서 구현
- [ ] ImageModalProcessor 구현
- [ ] TableModalProcessor 구현
- [ ] EquationModalProcessor 구현

### Phase 3: 파서 통합
- [ ] MineruParser 통합
- [ ] DoclingParser 통합 (선택)

### Phase 4: API 통합
- [ ] ainsert() 멀티모달 지원
- [ ] 문서 업로드 API

---

## 참고 문서

| 문서 | 설명 |
|------|------|
| `architecture.md` | 전체 아키텍처 |
| `processors.md` | 프로세서 상세 |
| `parsers.md` | 파서 상세 |
| `prompts.md` | 프롬프트 설계 |
| `context-extraction.md` | 컨텍스트 추출 |
| `source-mapping.md` | 소스 코드 매핑 상세 |
