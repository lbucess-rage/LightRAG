import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SigmaContainer, useSigma, useRegisterEvents } from '@react-sigma/core'
import { Settings as SigmaSettings } from 'sigma/settings'
import { EdgeArrowProgram, NodePointProgram, NodeCircleProgram } from 'sigma/rendering'
import { NodeBorderProgram } from '@sigma/node-border'
import { EdgeCurvedArrowProgram, createEdgeCurveProgram } from '@sigma/edge-curve'
import { DirectedGraph } from 'graphology'

import { useSettingsStore } from '@/stores/settings'
import { useEntityManagementStore, GraphNodeData, GraphEdgeData } from '@/stores/entityManagement'
import { useWorkspaceStore } from '@/stores/workspace'
import { queryGraphs, LightragGraphType, LightragNodeType, LightragEdgeType } from '@/api/lightrag'
import { labelColorDarkTheme, labelColorLightTheme } from '@/lib/constants'
import { resolveNodeColor, DEFAULT_NODE_COLOR } from '@/utils/graphColor'

import FocusOnNode from '@/components/graph/FocusOnNode'
import ZoomControl from '@/components/graph/ZoomControl'
import LayoutsControl from '@/components/graph/LayoutsControl'

import '@react-sigma/core/lib/style.css'

// Highlight color for selected node
const SELECTED_NODE_COLOR = '#ff6b6b'

// Function to create sigma settings based on theme
const createSigmaSettings = (isDarkTheme: boolean): Partial<SigmaSettings> => ({
  allowInvalidContainer: true,
  defaultNodeType: 'default',
  defaultEdgeType: 'curvedNoArrow',
  renderEdgeLabels: true,
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
  enableEdgeEvents: true,
  labelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelSize: 10,
  labelSize: 12
})

// Store raw graph data for detail panel access
interface RawGraphData {
  nodes: LightragNodeType[]
  edges: LightragEdgeType[]
  nodeMap: Map<string, LightragNodeType>  // entityId -> node
  edgeMap: Map<string, LightragEdgeType>  // "source-target" -> edge
  neighborMap: Map<string, { id: string; label: string }[]>  // entityId -> neighbors
}

// Build graphology graph from API response
function buildGraph(
  data: LightragGraphType,
  isDarkTheme: boolean
): { graph: DirectedGraph; rawData: RawGraphData } {
  const graph = new DirectedGraph()
  const typeColorMap = new Map<string, string>()

  // Build node map for quick lookup
  const nodeMap = new Map<string, LightragNodeType>()
  const neighborMap = new Map<string, { id: string; label: string }[]>()

  // Calculate max degree for node sizing
  const degrees = new Map<string, number>()
  data.edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1)
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1)
  })

  const maxDegree = Math.max(...Array.from(degrees.values()), 1)

  // Add nodes
  data.nodes.forEach((node, index) => {
    const entityId = node.properties?.entity_id || node.labels?.[0] || node.id
    const entityType = node.properties?.entity_type || ''
    const degree = degrees.get(node.id) || 0

    // Store node in map
    nodeMap.set(entityId, node)
    neighborMap.set(entityId, [])

    // Get color for entity type
    const { color } = resolveNodeColor(entityType, typeColorMap)
    const nodeColor = color || DEFAULT_NODE_COLOR

    // Calculate node size based on degree
    const size = 5 + (degree / maxDegree) * 15

    // Calculate position in a circle layout initially
    const angle = (index / data.nodes.length) * 2 * Math.PI
    const radius = 100

    if (!graph.hasNode(entityId)) {
      graph.addNode(entityId, {
        label: entityId,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        size,
        color: nodeColor,
        originalColor: nodeColor,
        borderColor: isDarkTheme ? '#ffffff' : '#000000',
        borderSize: 0
      })
    }
  })

  // Build edge map
  const edgeMap = new Map<string, LightragEdgeType>()

  // Add edges and build neighbor relationships
  data.edges.forEach((edge) => {
    const sourceNode = data.nodes.find(n => n.id === edge.source)
    const targetNode = data.nodes.find(n => n.id === edge.target)
    const sourceId = sourceNode?.properties?.entity_id || sourceNode?.labels?.[0] || edge.source
    const targetId = targetNode?.properties?.entity_id || targetNode?.labels?.[0] || edge.target
    const keywords = edge.properties?.keywords || ''

    // Store edge in map
    edgeMap.set(`${sourceId}-${targetId}`, edge)

    // Update neighbor relationships
    const sourceNeighbors = neighborMap.get(sourceId) || []
    const targetNeighbors = neighborMap.get(targetId) || []

    if (!sourceNeighbors.find(n => n.id === targetId)) {
      sourceNeighbors.push({ id: targetId, label: targetId })
      neighborMap.set(sourceId, sourceNeighbors)
    }
    if (!targetNeighbors.find(n => n.id === sourceId)) {
      targetNeighbors.push({ id: sourceId, label: sourceId })
      neighborMap.set(targetId, targetNeighbors)
    }

    if (graph.hasNode(sourceId) && graph.hasNode(targetId) && !graph.hasEdge(sourceId, targetId)) {
      graph.addEdge(sourceId, targetId, {
        label: keywords,
        keywords: keywords,
        description: edge.properties?.description || '',
        weight: edge.properties?.weight || 1,
        source_id: edge.properties?.source_id || '',
        edgeId: edge.id,
        edgeType: edge.type,
        properties: edge.properties,
        size: 1,
        color: isDarkTheme ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
        originalColor: isDarkTheme ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'
      })
    }
  })

  return {
    graph,
    rawData: {
      nodes: data.nodes,
      edges: data.edges,
      nodeMap,
      edgeMap,
      neighborMap
    }
  }
}

interface EntityGraphViewProps {
  selectedEntityId: string | null
}

// Highlight color for selected edge
const SELECTED_EDGE_COLOR = '#ff6b6b'
const HOVER_EDGE_COLOR = '#ffa500'

// Graph events component
function GraphEvents({
  selectedEntityId,
  rawData
}: {
  selectedEntityId: string | null
  rawData: RawGraphData | null
}) {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()
  const [draggedNode, setDraggedNode] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  // Timestamp to prevent node click from firing immediately after edge click
  const lastEdgeClickTime = useRef(0)

  const setGraphSelectedNode = useEntityManagementStore.use.setGraphSelectedNode()
  const setGraphSelectedEdge = useEntityManagementStore.use.setGraphSelectedEdge()
  const graphSelectedNode = useEntityManagementStore.use.graphSelectedNode()
  const graphSelectedEdge = useEntityManagementStore.use.graphSelectedEdge()

  // Helper to get node data for detail panel
  const getNodeData = useCallback((nodeId: string): GraphNodeData | null => {
    if (!rawData) return null
    const node = rawData.nodeMap.get(nodeId)
    if (!node) return null

    return {
      id: nodeId,
      labels: node.labels || [],
      properties: node.properties || {},
      neighbors: rawData.neighborMap.get(nodeId) || [],
      degree: (rawData.neighborMap.get(nodeId) || []).length
    }
  }, [rawData])

  // Helper to get edge data for detail panel
  const getEdgeData = useCallback((source: string, target: string, edgeAttrs: any): GraphEdgeData => {
    const edgeKey = `${source}-${target}`
    const rawEdge = rawData?.edgeMap.get(edgeKey)

    return {
      id: edgeAttrs.edgeId || rawEdge?.id || edgeKey,
      source,
      target,
      type: edgeAttrs.edgeType || rawEdge?.type,
      label: edgeAttrs.label || '',
      keywords: edgeAttrs.keywords || '',
      weight: edgeAttrs.weight,
      description: edgeAttrs.description || '',
      source_id: edgeAttrs.source_id || rawEdge?.properties?.source_id || '',
      properties: edgeAttrs.properties || rawEdge?.properties || {}
    }
  }, [rawData])

  // Auto-select node when selectedEntityId changes (from list selection)
  // But do NOT auto-select if an edge is currently selected
  useEffect(() => {
    if (!sigma) return
    // Skip if an edge is selected (don't override edge selection)
    if (graphSelectedEdge) return

    const graph = sigma.getGraph()

    // When entity is selected from list and it exists in the graph, auto-select it
    if (selectedEntityId && graph.hasNode(selectedEntityId) && graphSelectedNode !== selectedEntityId) {
      setGraphSelectedNode(selectedEntityId)
    }
  }, [selectedEntityId, sigma, graphSelectedNode, graphSelectedEdge, setGraphSelectedNode])

  // Update node visual state when selection changes
  useEffect(() => {
    if (!sigma) return
    const graph = sigma.getGraph()

    // Reset all nodes to original color
    graph.forEachNode((nodeId) => {
      const originalColor = graph.getNodeAttribute(nodeId, 'originalColor')
      graph.setNodeAttribute(nodeId, 'color', originalColor)
      graph.setNodeAttribute(nodeId, 'borderSize', 0)
    })

    // Highlight selected node (either from graph click or list selection)
    const nodeToHighlight = graphSelectedNode || selectedEntityId
    if (nodeToHighlight && graph.hasNode(nodeToHighlight)) {
      graph.setNodeAttribute(nodeToHighlight, 'color', SELECTED_NODE_COLOR)
      graph.setNodeAttribute(nodeToHighlight, 'borderSize', 3)
    }

    sigma.refresh()
  }, [graphSelectedNode, selectedEntityId, sigma])

  // Update edge visual state when selection/hover changes
  useEffect(() => {
    if (!sigma) return
    const graph = sigma.getGraph()

    // Reset all edges to original color
    graph.forEachEdge((edgeId) => {
      const originalColor = graph.getEdgeAttribute(edgeId, 'originalColor')
      graph.setEdgeAttribute(edgeId, 'color', originalColor)
      graph.setEdgeAttribute(edgeId, 'size', 1)
    })

    // Highlight hovered edge
    if (hoveredEdge && graph.hasEdge(hoveredEdge)) {
      graph.setEdgeAttribute(hoveredEdge, 'color', HOVER_EDGE_COLOR)
      graph.setEdgeAttribute(hoveredEdge, 'size', 2)
    }

    // Highlight selected edge
    if (selectedEdgeId && graph.hasEdge(selectedEdgeId)) {
      graph.setEdgeAttribute(selectedEdgeId, 'color', SELECTED_EDGE_COLOR)
      graph.setEdgeAttribute(selectedEdgeId, 'size', 2)
    }

    sigma.refresh()
  }, [selectedEdgeId, hoveredEdge, sigma])

  // Clear local edge selection when store edge is cleared
  useEffect(() => {
    if (!graphSelectedEdge) {
      setSelectedEdgeId(null)
    }
  }, [graphSelectedEdge])

  useEffect(() => {
    const handleClickEdge = (e: { edge: string }) => {
      const graph = sigma.getGraph()
      const edgeAttrs = graph.getEdgeAttributes(e.edge)
      const [source, target] = graph.extremities(e.edge)

      // Record timestamp to prevent node click from overriding edge selection
      lastEdgeClickTime.current = Date.now()

      // Store the edge ID locally for highlighting
      setSelectedEdgeId(e.edge)

      // Store edge data with full properties in the global store for the detail panel
      const edgeData = getEdgeData(source, target, edgeAttrs)
      setGraphSelectedEdge(edgeData)
    }

    const handleClickNode = (e: { node: string }) => {
      // Skip if edge was clicked within the last 200ms (prevents edge selection from being overridden)
      const timeSinceEdgeClick = Date.now() - lastEdgeClickTime.current
      if (timeSinceEdgeClick < 200) {
        return
      }
      // Get full node data for the detail panel
      const nodeData = getNodeData(e.node)
      setSelectedEdgeId(null)
      setGraphSelectedNode(e.node, nodeData)
    }

    const handleEnterEdge = (e: { edge: string }) => {
      setHoveredEdge(e.edge)
    }

    const handleLeaveEdge = () => {
      setHoveredEdge(null)
    }

    registerEvents({
      clickNode: handleClickNode,
      clickEdge: handleClickEdge,
      enterEdge: handleEnterEdge,
      leaveEdge: handleLeaveEdge,
      clickStage: () => {
        setGraphSelectedNode(null, null)
        setGraphSelectedEdge(null)
        setSelectedEdgeId(null)
        setHoveredEdge(null)
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
        e.original.preventDefault()
        e.original.stopPropagation()
      },
      mouseup: () => {
        if (draggedNode) {
          setDraggedNode(null)
          sigma.getGraph().removeNodeAttribute(draggedNode, 'highlighted')
        }
      },
      mousedown: (e) => {
        const mouseEvent = e.original as MouseEvent
        if (mouseEvent.buttons !== 0 && !sigma.getCustomBBox()) {
          sigma.setCustomBBox(sigma.getBBox())
        }
      }
    })
  }, [registerEvents, sigma, draggedNode, setGraphSelectedNode, setGraphSelectedEdge, getNodeData, getEdgeData])

  return null
}

// Apply sigma settings at runtime
function SigmaSettingsApplier({ isDarkTheme }: { isDarkTheme: boolean }) {
  const sigma = useSigma()

  useEffect(() => {
    if (!sigma) return

    // Ensure edge events are enabled
    sigma.setSetting('enableEdgeEvents', true)
    sigma.refresh()
  }, [sigma, isDarkTheme])

  return null
}

// Auto reset camera on mount
function AutoResetCamera() {
  const sigma = useSigma()

  useEffect(() => {
    if (!sigma) return

    // Small delay to ensure graph is fully rendered
    const timer = setTimeout(() => {
      try {
        sigma.setCustomBBox(null)
        sigma.refresh()

        const graph = sigma.getGraph()
        if (graph?.order && graph.nodes().length > 0) {
          sigma.getCamera().animate(
            { x: 0.5, y: 0.5, ratio: 1.1 },
            { duration: 300 }
          )
        }
      } catch (error) {
        console.error('Error resetting camera:', error)
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [sigma])

  return null
}

// Inner graph component
function EntityGraphInner({
  selectedEntityId,
  isDarkTheme,
  rawData
}: {
  selectedEntityId: string | null
  isDarkTheme: boolean
  rawData: RawGraphData | null
}) {
  const graphSelectedNode = useEntityManagementStore.use.graphSelectedNode()

  return (
    <>
      <SigmaSettingsApplier isDarkTheme={isDarkTheme} />
      <GraphEvents selectedEntityId={selectedEntityId} rawData={rawData} />
      <AutoResetCamera />
      <div className="absolute left-2 bottom-2 z-10 flex flex-col gap-1">
        <ZoomControl />
        <LayoutsControl />
      </div>
      <FocusOnNode node={graphSelectedNode} />
    </>
  )
}

export default function EntityGraphView({ selectedEntityId }: EntityGraphViewProps) {
  const { t } = useTranslation()
  const theme = useSettingsStore.use.theme()
  const isDarkTheme = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sigmaGraph, setSigmaGraph] = useState<DirectedGraph | null>(null)
  const [rawData, setRawData] = useState<RawGraphData | null>(null)
  const [graphKey, setGraphKey] = useState(0)
  const prevEntityIdRef = useRef<string | null>(null)
  const prevWorkspaceRef = useRef<string | null>(null)

  const sigmaSettings = useMemo(() => createSigmaSettings(isDarkTheme), [isDarkTheme])

  // Reset graph when workspace changes
  useEffect(() => {
    if (prevWorkspaceRef.current !== null && prevWorkspaceRef.current !== currentWorkspaceId) {
      // Workspace changed - reset graph state
      setSigmaGraph(null)
      setRawData(null)
      setError(null)
      prevEntityIdRef.current = null  // Reset entity ref to allow re-fetch
    }
    prevWorkspaceRef.current = currentWorkspaceId
  }, [currentWorkspaceId])

  // Fetch graph data when selected entity changes
  useEffect(() => {
    if (!selectedEntityId) {
      setSigmaGraph(null)
      setRawData(null)
      setError(null)
      return
    }

    // Skip if same entity
    if (prevEntityIdRef.current === selectedEntityId) {
      return
    }
    prevEntityIdRef.current = selectedEntityId

    const fetchGraph = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await queryGraphs(selectedEntityId, 2, 100)
        const { graph, rawData: newRawData } = buildGraph(response, isDarkTheme)
        setSigmaGraph(graph)
        setRawData(newRawData)
        setGraphKey(prev => prev + 1) // Force SigmaContainer remount with new graph
      } catch (err) {
        console.error('Failed to fetch entity graph:', err)
        setError(t('entityManagement.graphView.loadError'))
        setSigmaGraph(null)
        setRawData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchGraph()
  }, [selectedEntityId, isDarkTheme, t])

  // No entity selected state
  if (!selectedEntityId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t('entityManagement.graphView.selectEntity')}</p>
      </div>
    )
  }

  // Error state
  if (error && !sigmaGraph) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        <p>{error}</p>
      </div>
    )
  }

  // No graph data and not loading
  if (!sigmaGraph && !loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t('entityManagement.graphView.noData')}</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{t('entityManagement.graphView.loading')}</p>
          </div>
        </div>
      )}

      {/* Graph container */}
      {sigmaGraph && sigmaGraph.order > 0 && (
        <SigmaContainer
          key={graphKey}
          graph={sigmaGraph}
          settings={sigmaSettings}
          className="h-full w-full"
        >
          <EntityGraphInner selectedEntityId={selectedEntityId} isDarkTheme={isDarkTheme} rawData={rawData} />
        </SigmaContainer>
      )}
    </div>
  )
}
