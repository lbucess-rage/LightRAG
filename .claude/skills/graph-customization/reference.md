# 지식 그래프 커스터마이징 참고 자료

## 디렉토리 구조

```
/home/kms-rag/LightRAG/
├── lightrag_webui/                    # 프론트엔드 (React + Vite)
│   ├── src/
│   │   ├── features/                  # 주요 화면 컴포넌트
│   │   │   ├── GraphViewer.tsx        # 메인 지식 그래프
│   │   │   └── EntityManagement.tsx   # 엔티티 관리 센터
│   │   ├── components/
│   │   │   ├── graph/                 # 그래프 UI 컴포넌트
│   │   │   ├── entity-management/     # 엔티티 관리 컴포넌트
│   │   │   └── ui/                    # 공통 UI 컴포넌트
│   │   ├── stores/                    # Zustand 상태 관리
│   │   │   ├── graph.ts               # 그래프 상태
│   │   │   ├── entityManagement.ts    # 엔티티 관리 상태
│   │   │   └── settings.ts            # 설정 상태
│   │   ├── api/
│   │   │   └── lightrag.ts            # API 함수
│   │   ├── locales/                   # 다국어 번역
│   │   │   ├── ko.json
│   │   │   └── en.json
│   │   └── lib/
│   │       ├── utils.ts               # 유틸리티 (createSelectors 등)
│   │       └── constants.ts           # 상수
│   └── package.json
├── lightrag/                          # 백엔드 (Python)
│   ├── api/
│   │   ├── lightrag_server.py         # 메인 서버
│   │   └── routers/
│   │       ├── graph_routes.py        # 그래프 API
│   │       └── entity_management_routes.py  # 엔티티 관리 API
│   └── kg/
│       └── neo4j_impl.py              # Neo4j 구현
└── scripts/
    └── server.sh                      # 서버 관리 스크립트
```

## 빌드 및 배포

### 프론트엔드 빌드
```bash
cd /home/kms-rag/LightRAG/lightrag_webui
bun run build
# 결과물: lightrag/api/webui/
```

### 서버 재시작
```bash
cd /home/kms-rag/LightRAG
./scripts/server.sh restart
```

## 주요 타입 정의

### 엔티티 응답
```typescript
interface EntityResponse {
  entity_id: string
  entity_type: string
  description?: string
  source_id?: string
  file_path?: string
  degree: number
}
```

### 관계 응답
```typescript
interface RelationResponse {
  source_id: string
  target_id: string
  keywords?: string
  weight?: number
  description?: string
  source_chunk_id?: string
}
```

### 페이지네이션
```typescript
interface PaginationInfo {
  page: number
  page_size: number
  total_count: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}
```

### 그래프 선택 Edge
```typescript
interface GraphSelectedEdge {
  source: string
  target: string
  label?: string
  keywords?: string
  weight?: number
  description?: string
}
```

## 자주 사용하는 패턴

### 1. Store에서 selector 사용
```typescript
// stores/entityManagement.ts에서 createSelectors로 감싸진 store
const entities = useEntityManagementStore.use.entities()
const fetchEntities = useEntityManagementStore.use.fetchEntities()
```

### 2. 그래프에서 노드/엣지 정보 가져오기
```typescript
const sigma = useSigma()
const graph = sigma.getGraph()

// 노드 속성
const nodeAttrs = graph.getNodeAttributes(nodeId)

// 엣지 속성
const edgeAttrs = graph.getEdgeAttributes(edgeId)

// 엣지의 양 끝 노드
const [source, target] = graph.extremities(edgeId)

// 노드 존재 여부
if (graph.hasNode(nodeId)) { ... }
```

### 3. API 에러 처리
```typescript
try {
  await deleteEntity(entityId)
  toast.success(t('entityManagement.deleteSuccess'))
} catch (error) {
  console.error('Failed to delete entity:', error)
  toast.error(t('entityManagement.deleteFailed'))
}
```

### 4. 조건부 표시 모드
```typescript
const displayMode = useMemo(() => {
  if (graphSelectedEdge) return 'edge'
  if (graphSelectedNode || selectedEntityId) return 'entity'
  return 'none'
}, [graphSelectedEdge, graphSelectedNode, selectedEntityId])
```

## Neo4j Cypher 쿼리 참고

### 페이지네이션 엔티티 조회
```cypher
MATCH (n:base)
WHERE n.entity_id CONTAINS $search
WITH n, size((n)--()) as degree
RETURN n.entity_id, n.entity_type, n.description, n.source_id, n.file_path, degree
ORDER BY n.entity_id ASC
SKIP $skip LIMIT $limit
```

### 페이지네이션 관계 조회
```cypher
MATCH (s:base)-[r:RELATED]->(t:base)
WHERE s.entity_id CONTAINS $search OR t.entity_id CONTAINS $search
RETURN s.entity_id as source_id, t.entity_id as target_id,
       r.keywords, r.weight, r.description
ORDER BY s.entity_id ASC
SKIP $skip LIMIT $limit
```

### 엔티티 타입별 개수
```cypher
MATCH (n:base)
RETURN n.entity_type as type, count(*) as count
ORDER BY count DESC
```

### 엔티티 삭제
```cypher
MATCH (n:base {entity_id: $entity_id})
DETACH DELETE n
```

### 관계 삭제
```cypher
MATCH (s:base {entity_id: $source_id})-[r:RELATED]->(t:base {entity_id: $target_id})
DELETE r
```

## 트러블슈팅

### Edge 클릭이 작동하지 않을 때
1. Sigma settings에 `enableEdgeEvents: true` 확인
2. `registerEvents`에 `clickEdge` 핸들러 등록 확인
3. Edge 클릭 후 Node 클릭 이벤트 충돌 여부 확인

### 선택 상태가 즉시 사라질 때
1. Store의 상호 배타적 선택 로직 확인
2. Auto-select useEffect에서 edge 상태 체크 여부 확인
3. 콘솔에서 상태 변화 로그 확인

### 그래프가 표시되지 않을 때
1. `sigmaGraph.order > 0` 체크 (노드가 있는지)
2. SigmaContainer에 적절한 크기 지정 확인
3. 콘솔에서 API 응답 확인

### 번역이 표시되지 않을 때
1. `ko.json`, `en.json` 모두에 키 추가 확인
2. 키 경로 오타 확인 (예: `entityManagement.detailPanel.edgeTitle`)

## 유용한 디버그 코드

```typescript
// Store 상태 로그
console.log('State:', {
  graphSelectedEdge,
  graphSelectedNode,
  selectedEntityId
})

// Sigma 그래프 정보
console.log('Graph:', {
  nodes: graph.order,
  edges: graph.size
})

// 이벤트 발생 확인
console.log('Event fired:', eventName, eventData)
```
