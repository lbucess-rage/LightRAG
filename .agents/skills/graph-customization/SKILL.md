# LightRAG 지식 그래프 커스터마이징 개발 가이드

LightRAG WebUI의 지식 그래프 시각화 및 엔티티 관리 기능 개발을 위한 가이드입니다.

## 프로젝트 구조

```
lightrag_webui/src/
├── features/
│   ├── GraphViewer.tsx              # 메인 지식 그래프 뷰어
│   └── EntityManagement.tsx         # 엔티티 관리 센터
├── components/
│   ├── graph/                       # 그래프 관련 컴포넌트
│   │   ├── PropertiesView.tsx       # 노드 속성 표시
│   │   ├── EditablePropertyRow.tsx  # 편집 가능한 속성 행
│   │   ├── ZoomControl.tsx          # 줌 컨트롤
│   │   ├── LayoutsControl.tsx       # 레이아웃 컨트롤
│   │   └── FocusOnNode.tsx          # 노드 포커스
│   └── entity-management/           # 엔티티 관리 컴포넌트
│       ├── EntityExplorer.tsx       # 엔티티 테이블
│       ├── RelationExplorer.tsx     # 관계 테이블
│       ├── EntityGraphView.tsx      # 엔티티 그래프 뷰
│       └── EntityDetailPanel.tsx    # 상세 패널
├── stores/
│   ├── graph.ts                     # 그래프 상태 관리
│   ├── entityManagement.ts          # 엔티티 관리 상태
│   └── settings.ts                  # 설정 상태
└── api/
    └── lightrag.ts                  # API 함수
```

---

## 핵심 라이브러리

### 1. Sigma.js (그래프 시각화)

```typescript
// 필수 imports
import { SigmaContainer, useSigma, useRegisterEvents } from '@react-sigma/core'
import { Settings as SigmaSettings } from 'sigma/settings'
import { EdgeArrowProgram, NodePointProgram, NodeCircleProgram } from 'sigma/rendering'
import { NodeBorderProgram } from '@sigma/node-border'
import { EdgeCurvedArrowProgram, createEdgeCurveProgram } from '@sigma/edge-curve'
import { DirectedGraph } from 'graphology'

import '@react-sigma/core/lib/style.css'
```

### 2. Sigma 설정

```typescript
const createSigmaSettings = (isDarkTheme: boolean): Partial<SigmaSettings> => ({
  allowInvalidContainer: true,
  defaultNodeType: 'default',
  defaultEdgeType: 'curvedNoArrow',
  renderEdgeLabels: true,               // edge 라벨 표시
  enableEdgeEvents: true,               // ⚠️ edge 클릭 필수 설정
  edgeProgramClasses: {
    arrow: EdgeArrowProgram,
    curvedArrow: EdgeCurvedArrowProgram,
    curvedNoArrow: createEdgeCurveProgram()
  },
  nodeProgramClasses: {
    default: NodeBorderProgram,
    circel: NodeCircleProgram,
    point: NodePointProgram
  },
  labelGridCellSize: 60,
  labelRenderedSizeThreshold: 12,
  labelColor: {
    color: isDarkTheme ? '#ffffff' : '#000000',
    attribute: 'labelColor'
  },
  edgeLabelSize: 10,
  labelSize: 12
})
```

### 3. Graphology (그래프 데이터)

```typescript
import { DirectedGraph } from 'graphology'

// 그래프 생성
const graph = new DirectedGraph()

// 노드 추가
graph.addNode(nodeId, {
  label: entityId,
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius,
  size: 5 + (degree / maxDegree) * 15,  // degree 기반 크기
  color: nodeColor,
  originalColor: nodeColor,              // 하이라이트 복원용
  borderColor: isDarkTheme ? '#ffffff' : '#000000',
  borderSize: 0
})

// 엣지 추가
graph.addEdge(sourceId, targetId, {
  label: keywords,
  keywords: keywords,
  description: description,
  weight: weight,
  size: 1,
  color: isDarkTheme ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
  originalColor: originalColor           // 하이라이트 복원용
})
```

---

## Sigma 이벤트 처리

### ⚠️ 중요: Edge 클릭과 Node 클릭 충돌

**문제:** Edge를 클릭하면 `clickEdge`와 `clickNode` 이벤트가 모두 발생할 수 있음

**해결 방법 1: timestamp 기반**
```typescript
const lastEdgeClickTime = useRef(0)

const handleClickEdge = (e: { edge: string }) => {
  lastEdgeClickTime.current = Date.now()
  // edge 처리...
}

const handleClickNode = (e: { node: string }) => {
  // 200ms 이내면 무시
  if (Date.now() - lastEdgeClickTime.current < 200) return
  // node 처리...
}
```

**해결 방법 2: 상태 체크 (권장)**
```typescript
// Auto-select useEffect에서 edge 선택 시 건너뛰기
useEffect(() => {
  if (!sigma) return
  if (graphSelectedEdge) return  // ⚠️ edge 선택 시 노드 자동선택 방지

  const graph = sigma.getGraph()
  if (selectedEntityId && graph.hasNode(selectedEntityId)) {
    setGraphSelectedNode(selectedEntityId)
  }
}, [selectedEntityId, sigma, graphSelectedEdge, ...])
```

### 이벤트 등록 패턴

```typescript
function GraphEvents() {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()
  const [draggedNode, setDraggedNode] = useState<string | null>(null)

  useEffect(() => {
    registerEvents({
      clickNode: (e) => {
        // 노드 클릭 처리
      },
      clickEdge: (e) => {
        const graph = sigma.getGraph()
        const edgeAttrs = graph.getEdgeAttributes(e.edge)
        const [source, target] = graph.extremities(e.edge)
        // edge 정보: source, target, edgeAttrs.keywords, edgeAttrs.weight 등
      },
      enterEdge: (e) => {
        // hover 처리
      },
      leaveEdge: () => {
        // hover 해제
      },
      clickStage: () => {
        // 빈 공간 클릭 - 선택 해제
      },
      downNode: (e) => {
        setDraggedNode(e.node)
        sigma.getGraph().setNodeAttribute(e.node, 'highlighted', true)
      },
      mousemovebody: (e) => {
        if (!draggedNode) return
        const pos = sigma.viewportToGraph(e)
        sigma.getGraph().setNodeAttribute(draggedNode, 'x', pos.x)
        sigma.getGraph().setNodeAttribute(draggedNode, 'y', pos.y)
        e.preventSigmaDefault()
      },
      mouseup: () => {
        if (draggedNode) {
          setDraggedNode(null)
          sigma.getGraph().removeNodeAttribute(draggedNode, 'highlighted')
        }
      }
    })
  }, [registerEvents, sigma, draggedNode])

  return null
}
```

### 노드/엣지 하이라이트

```typescript
// 노드 하이라이트
const SELECTED_NODE_COLOR = '#ff6b6b'
graph.setNodeAttribute(nodeId, 'color', SELECTED_NODE_COLOR)
graph.setNodeAttribute(nodeId, 'borderSize', 3)

// 복원
const originalColor = graph.getNodeAttribute(nodeId, 'originalColor')
graph.setNodeAttribute(nodeId, 'color', originalColor)
graph.setNodeAttribute(nodeId, 'borderSize', 0)

// 엣지 하이라이트
const SELECTED_EDGE_COLOR = '#ff6b6b'
const HOVER_EDGE_COLOR = '#ffa500'
graph.setEdgeAttribute(edgeId, 'color', SELECTED_EDGE_COLOR)
graph.setEdgeAttribute(edgeId, 'size', 2)

// 변경사항 반영
sigma.refresh()
```

---

## 상태 관리 (Zustand)

### createSelectors 패턴

```typescript
import { create } from 'zustand'
import { createSelectors } from '@/lib/utils'

interface State {
  selectedEntityId: string | null
  graphSelectedNode: string | null
  graphSelectedEdge: EdgeData | null

  selectEntity: (id: string | null) => void
  setGraphSelectedNode: (id: string | null) => void
  setGraphSelectedEdge: (edge: EdgeData | null) => void
}

const useStoreBase = create<State>()((set) => ({
  selectedEntityId: null,
  graphSelectedNode: null,
  graphSelectedEdge: null,

  // ⚠️ 상호 배타적 선택: 하나 선택 시 다른 것 해제
  selectEntity: (id) => set({
    selectedEntityId: id,
    graphSelectedNode: null,
    graphSelectedEdge: null
  }),
  setGraphSelectedNode: (id) => set({
    graphSelectedNode: id,
    graphSelectedEdge: null  // node 선택 시 edge 해제
  }),
  setGraphSelectedEdge: (edge) => set({
    graphSelectedEdge: edge,
    graphSelectedNode: null  // edge 선택 시 node 해제
  }),
}))

// Selectors 생성
const useStore = createSelectors(useStoreBase)

// 사용법
const selectedEntityId = useStore.use.selectedEntityId()
const setGraphSelectedNode = useStore.use.setGraphSelectedNode()
```

---

## UI/UX 패턴

### 1. 테이블 행 클릭과 셀 클릭 분리

```typescript
// ⚠️ 셀의 onClick에서 stopPropagation 필수
const handleSourceClick = (e: React.MouseEvent, entityId: string) => {
  e.stopPropagation()  // 행 클릭 이벤트 전파 방지
  selectEntity(entityId)
}

<TableRow onClick={() => handleRowClick(relation)}>
  <TableCell onClick={(e) => handleSourceClick(e, relation.source_id)}>
    {relation.source_id}
  </TableCell>
  <TableCell onClick={() => handleRowClick(relation)}>
    {relation.weight}  {/* 행 클릭과 동일한 동작 */}
  </TableCell>
</TableRow>
```

### 2. 검색 디바운스

```typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

// 사용
const [searchInput, setSearchInput] = useState('')
const debouncedSearch = useDebounce(searchInput, 300)

useEffect(() => {
  fetchData(debouncedSearch)
}, [debouncedSearch])
```

### 3. 접이식 상세 패널

```typescript
const [isExpanded, setIsExpanded] = useState(false)

// 선택 시 자동 펼침
useEffect(() => {
  if (selectedItem) {
    setIsExpanded(true)
  }
}, [selectedItem])

// 패널 헤더 (항상 표시)
<div onClick={() => setIsExpanded(prev => !prev)}>
  <span>상세 정보</span>
  {isExpanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
</div>

// 패널 내용 (조건부 표시)
{isExpanded && (
  <div className="max-h-[200px] overflow-auto">
    {/* 상세 내용 */}
  </div>
)}
```

### 4. displayMode 패턴 (엔티티/관계 선택 분기)

```typescript
const displayMode = useMemo(() => {
  if (graphSelectedEdge) return 'edge'
  if (graphSelectedNode || selectedEntityId) return 'entity'
  return 'none'
}, [graphSelectedEdge, graphSelectedNode, selectedEntityId])

// 렌더링
{displayMode === 'edge' && <EdgeProperties edge={graphSelectedEdge} />}
{displayMode === 'entity' && <EntityProperties entity={selectedEntity} />}
{displayMode === 'none' && <EmptyState />}
```

---

## API 패턴

### 페이지네이션 API

```typescript
// Request 타입
interface PaginatedRequest {
  page: number
  page_size: number
  search?: string
  sort_field?: string
  sort_direction?: 'asc' | 'desc'
}

// Response 타입
interface PaginatedResponse<T> {
  items: T[]
  pagination: {
    page: number
    page_size: number
    total_count: number
    total_pages: number
    has_next: boolean
    has_prev: boolean
  }
}

// API 함수
export async function getEntitiesPaginated(request: PaginatedRequest) {
  const params = new URLSearchParams({
    page: String(request.page),
    page_size: String(request.page_size),
    ...(request.search && { search: request.search }),
    ...(request.sort_field && { sort_field: request.sort_field }),
    ...(request.sort_direction && { sort_direction: request.sort_direction }),
  })
  return apiGet<PaginatedResponse<Entity>>(`/entities?${params}`)
}
```

---

## 번역 (i18next)

```typescript
import { useTranslation } from 'react-i18next'

const { t } = useTranslation()

// 사용
<span>{t('entityManagement.detailPanel.edgeTitle')}</span>

// 번역 파일 구조 (ko.json, en.json)
{
  "entityManagement": {
    "tabs": {
      "entities": "엔티티 탐색",
      "relations": "관계 탐색"
    },
    "detailPanel": {
      "title": "상세 정보",
      "entityTitle": "엔티티 속성",
      "edgeTitle": "관계 속성",
      "edgeFields": {
        "source": "출발",
        "target": "도착",
        "keywords": "키워드",
        "weight": "가중치",
        "description": "설명"
      }
    }
  }
}
```

---

## 주의사항 체크리스트

- [ ] Sigma `enableEdgeEvents: true` 설정 확인
- [ ] Edge 클릭 시 Node 클릭 이벤트 충돌 처리
- [ ] 상태 변경 시 상호 배타적 선택 처리 (node ↔ edge)
- [ ] Auto-select 로직에서 edge 선택 상태 체크
- [ ] 테이블 셀 클릭 시 `stopPropagation()` 처리
- [ ] 그래프 변경 후 `sigma.refresh()` 호출
- [ ] 노드/엣지에 `originalColor` 저장 (하이라이트 복원용)
- [ ] 검색 입력에 디바운스 적용 (300ms 권장)
- [ ] 번역 키 추가 시 ko.json, en.json 모두 수정

---

## 참고 파일

| 기능 | 파일 경로 |
|------|----------|
| 메인 그래프 뷰어 | `lightrag_webui/src/features/GraphViewer.tsx` |
| 엔티티 관리 그래프 | `lightrag_webui/src/components/entity-management/EntityGraphView.tsx` |
| 그래프 상태 관리 | `lightrag_webui/src/stores/graph.ts` |
| 엔티티 관리 상태 | `lightrag_webui/src/stores/entityManagement.ts` |
| 속성 표시 | `lightrag_webui/src/components/graph/PropertiesView.tsx` |
| API 함수 | `lightrag_webui/src/api/lightrag.ts` |
| 백엔드 라우터 | `lightrag/api/routers/entity_management_routes.py` |
| Neo4j 구현 | `lightrag/kg/neo4j_impl.py` |
