import { useEffect, useMemo, useState } from 'react'
import { SigmaContainer, useRegisterEvents, useSigma } from '@react-sigma/core'
import { MultiDirectedGraph } from 'graphology'
import { EdgeArrowProgram, NodeCircleProgram } from 'sigma/rendering'
import { Settings as SigmaSettings } from 'sigma/settings'
import { useTranslation } from 'react-i18next'

import {
  AnswerGraphNode,
  AnswerGraphProjection,
  AnswerGraphRelation,
} from '@/api/lightrag'
import ZoomControl from '@/components/graph/ZoomControl'
import Badge from '@/components/ui/Badge'
import { useSettingsStore } from '@/stores/settings'

import '@react-sigma/core/lib/style.css'

const ENTITY_COLORS: Record<string, string> = {
  FAQAnswer: '#10b981',
  Intent: '#6366f1',
  Term: '#0ea5e9',
  Category: '#f59e0b',
  Product: '#14b8a6',
  System: '#8b5cf6',
  Symptom: '#ef4444',
  ErrorCode: '#e11d48',
  Procedure: '#64748b',
}

const DEFAULT_NODE_COLOR = '#64748b'
const SELECTED_NODE_COLOR = '#ef4444'
const SELECTED_EDGE_COLOR = '#f97316'

type GraphSelection =
  | { kind: 'node'; node: AnswerGraphNode }
  | { kind: 'relation'; relation: AnswerGraphRelation; relationKey: string }
  | null

const truncateLabel = (label: string, maxLength = 32) =>
  label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label

function buildGraph(projection: AnswerGraphProjection, isDarkTheme: boolean) {
  const graph = new MultiDirectedGraph()
  const nodeById = new Map(projection.nodes.map((node) => [node.node_id, node]))
  const adjacency = new Map<string, Set<string>>()
  const degree = new Map<string, number>()

  projection.nodes.forEach((node) => adjacency.set(node.node_id, new Set()))
  projection.relations.forEach((relation) => {
    if (!nodeById.has(relation.source_id) || !nodeById.has(relation.target_id)) return
    adjacency.get(relation.source_id)?.add(relation.target_id)
    adjacency.get(relation.target_id)?.add(relation.source_id)
    degree.set(relation.source_id, (degree.get(relation.source_id) || 0) + 1)
    degree.set(relation.target_id, (degree.get(relation.target_id) || 0) + 1)
  })

  const rootId =
    projection.nodes.find((node) => node.entity_type === 'FAQAnswer')?.node_id ||
    projection.nodes[0]?.node_id
  const depth = new Map<string, number>()

  if (rootId) {
    depth.set(rootId, 0)
    const queue = [rootId]
    while (queue.length) {
      const current = queue.shift()
      if (!current) break
      const nextDepth = (depth.get(current) || 0) + 1
      adjacency.get(current)?.forEach((neighbor) => {
        if (depth.has(neighbor)) return
        depth.set(neighbor, nextDepth)
        queue.push(neighbor)
      })
    }
  }

  const maxKnownDepth = Math.max(0, ...depth.values())
  projection.nodes.forEach((node) => {
    if (!depth.has(node.node_id)) depth.set(node.node_id, maxKnownDepth + 1)
  })

  const nodesByDepth = new Map<number, AnswerGraphNode[]>()
  projection.nodes.forEach((node) => {
    const nodeDepth = depth.get(node.node_id) || 0
    nodesByDepth.set(nodeDepth, [...(nodesByDepth.get(nodeDepth) || []), node])
  })

  nodesByDepth.forEach((nodes, nodeDepth) => {
    const radius = nodeDepth === 0 ? 0 : 130 * nodeDepth
    nodes.forEach((node, index) => {
      const angle = nodes.length === 1 ? 0 : (index / nodes.length) * Math.PI * 2 - Math.PI / 2
      const originalColor = ENTITY_COLORS[node.entity_type] || DEFAULT_NODE_COLOR
      const nodeDegree = degree.get(node.node_id) || 0
      const size =
        node.entity_type === 'FAQAnswer'
          ? 18
          : Math.min(13, 7 + Math.sqrt(Math.max(1, nodeDegree)) * 1.8)

      graph.addNode(node.node_id, {
        label: truncateLabel(node.label),
        fullLabel: node.label,
        entityType: node.entity_type,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        size,
        originalSize: size,
        color: originalColor,
        originalColor,
        labelColor: isDarkTheme ? '#f8fafc' : '#111827',
      })
    })
  })

  projection.relations.forEach((relation, index) => {
    if (!graph.hasNode(relation.source_id) || !graph.hasNode(relation.target_id)) return
    const relationKey = `relation-${index}`
    const edgeColor = isDarkTheme ? '#64748b' : '#94a3b8'
    graph.addDirectedEdgeWithKey(relationKey, relation.source_id, relation.target_id, {
      label: '',
      relationType: relation.relation_type,
      relationIndex: index,
      size: Math.min(3, Math.max(1, relation.weight || 1)),
      originalSize: Math.min(3, Math.max(1, relation.weight || 1)),
      color: edgeColor,
      originalColor: edgeColor,
      type: 'arrow',
    })
  })

  return graph
}

function AutoFitGraph() {
  const sigma = useSigma()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      sigma.setCustomBBox(null)
      sigma.refresh()
      sigma.getCamera().animatedReset({ duration: 250 })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [sigma])

  return null
}

function GraphInteraction({
  projection,
  selection,
  onSelectionChange,
}: {
  projection: AnswerGraphProjection
  selection: GraphSelection
  onSelectionChange: (selection: GraphSelection) => void
}) {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()
  const [draggedNode, setDraggedNode] = useState<string | null>(null)

  useEffect(() => {
    const graph = sigma.getGraph()
    const selectedNodeId = selection?.kind === 'node' ? selection.node.node_id : null
    const selectedEdgeId = selection?.kind === 'relation' ? selection.relationKey : null

    graph.forEachNode((nodeId) => {
      graph.setNodeAttribute(nodeId, 'color', graph.getNodeAttribute(nodeId, 'originalColor'))
      graph.setNodeAttribute(nodeId, 'size', graph.getNodeAttribute(nodeId, 'originalSize'))
    })
    graph.forEachEdge((edgeId) => {
      graph.setEdgeAttribute(edgeId, 'color', graph.getEdgeAttribute(edgeId, 'originalColor'))
      graph.setEdgeAttribute(edgeId, 'size', graph.getEdgeAttribute(edgeId, 'originalSize'))
      graph.setEdgeAttribute(edgeId, 'label', '')
    })

    if (selectedNodeId && graph.hasNode(selectedNodeId)) {
      graph.setNodeAttribute(selectedNodeId, 'color', SELECTED_NODE_COLOR)
      graph.setNodeAttribute(
        selectedNodeId,
        'size',
        Number(graph.getNodeAttribute(selectedNodeId, 'originalSize')) + 3
      )
      graph.forEachEdge(selectedNodeId, (edgeId) => {
        graph.setEdgeAttribute(edgeId, 'color', SELECTED_EDGE_COLOR)
      })
    }

    if (selectedEdgeId && graph.hasEdge(selectedEdgeId)) {
      graph.setEdgeAttribute(selectedEdgeId, 'color', SELECTED_EDGE_COLOR)
      graph.setEdgeAttribute(
        selectedEdgeId,
        'label',
        graph.getEdgeAttribute(selectedEdgeId, 'relationType')
      )
      graph.setEdgeAttribute(
        selectedEdgeId,
        'size',
        Number(graph.getEdgeAttribute(selectedEdgeId, 'originalSize')) + 1.5
      )
      const [source, target] = graph.extremities(selectedEdgeId)
      graph.setNodeAttribute(source, 'color', SELECTED_NODE_COLOR)
      graph.setNodeAttribute(target, 'color', SELECTED_NODE_COLOR)
    }

    sigma.refresh()
  }, [selection, sigma])

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => {
        const selectedNode = projection.nodes.find((item) => item.node_id === node)
        if (selectedNode) onSelectionChange({ kind: 'node', node: selectedNode })
      },
      clickEdge: ({ edge }) => {
        const relationIndex = Number(sigma.getGraph().getEdgeAttribute(edge, 'relationIndex'))
        const relation = projection.relations[relationIndex]
        if (relation) {
          onSelectionChange({ kind: 'relation', relation, relationKey: edge })
        }
      },
      clickStage: () => onSelectionChange(null),
      downNode: ({ node }) => {
        setDraggedNode(node)
        sigma.getGraph().setNodeAttribute(node, 'highlighted', true)
      },
      mousemovebody: (event) => {
        if (!draggedNode) return
        const position = sigma.viewportToGraph(event)
        sigma.getGraph().setNodeAttribute(draggedNode, 'x', position.x)
        sigma.getGraph().setNodeAttribute(draggedNode, 'y', position.y)
        event.preventSigmaDefault()
        event.original.preventDefault()
        event.original.stopPropagation()
      },
      mouseup: () => {
        if (!draggedNode) return
        sigma.getGraph().removeNodeAttribute(draggedNode, 'highlighted')
        setDraggedNode(null)
      },
    })
  }, [draggedNode, onSelectionChange, projection, registerEvents, sigma])

  return null
}

export default function AnswerGraphVisualization({
  projection,
}: {
  projection: AnswerGraphProjection
}) {
  const { t } = useTranslation()
  const theme = useSettingsStore.use.theme()
  const isDarkTheme =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const rootNode =
    projection.nodes.find((node) => node.entity_type === 'FAQAnswer') || projection.nodes[0] || null
  const [selection, setSelection] = useState<GraphSelection>(
    rootNode ? { kind: 'node', node: rootNode } : null
  )

  const graph = useMemo(
    () => buildGraph(projection, isDarkTheme),
    [isDarkTheme, projection]
  )
  const nodeById = useMemo(
    () => new Map(projection.nodes.map((node) => [node.node_id, node])),
    [projection.nodes]
  )
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    projection.nodes.forEach((node) => {
      counts.set(node.entity_type, (counts.get(node.entity_type) || 0) + 1)
    })
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [projection.nodes])

  const selectedNodeRelations =
    selection?.kind === 'node'
      ? projection.relations.filter(
        (relation) =>
          relation.source_id === selection.node.node_id ||
          relation.target_id === selection.node.node_id
      ).length
      : 0

  const sigmaSettings = useMemo<Partial<SigmaSettings>>(
    () => ({
      allowInvalidContainer: true,
      defaultNodeType: 'default',
      defaultEdgeType: 'arrow',
      nodeProgramClasses: { default: NodeCircleProgram },
      edgeProgramClasses: { arrow: EdgeArrowProgram },
      renderEdgeLabels: true,
      enableEdgeEvents: true,
      labelRenderedSizeThreshold: 9,
      labelGridCellSize: 80,
      labelSize: 12,
      edgeLabelSize: 9,
      labelColor: { color: isDarkTheme ? '#f8fafc' : '#111827', attribute: 'labelColor' },
      edgeLabelColor: { color: isDarkTheme ? '#cbd5e1' : '#475569' },
    }),
    [isDarkTheme]
  )

  return (
    <div className="grid min-h-[460px] overflow-hidden rounded-md border lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="relative min-h-[460px] bg-muted/10">
        <SigmaContainer graph={graph} settings={sigmaSettings} className="h-full min-h-[460px] w-full">
          <AutoFitGraph />
          <GraphInteraction
            projection={projection}
            selection={selection}
            onSelectionChange={setSelection}
          />
          <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
            <ZoomControl />
          </div>
        </SigmaContainer>
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm">
          {t(
            'answerCatalog.graph.canvasHint',
            'Select a node or relation to inspect it. Drag nodes to rearrange the graph.'
          )}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col border-t bg-background lg:border-l lg:border-t-0">
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="text-sm font-semibold">
            {selection?.kind === 'relation'
              ? t('answerCatalog.graph.selectedRelation', 'Selected relation')
              : t('answerCatalog.graph.selectedNode', 'Selected node')}
          </div>

          {!selection ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t(
                'answerCatalog.graph.selectGraphItem',
                'Select a node or relation in the graph to view its details.'
              )}
            </p>
          ) : selection.kind === 'node' ? (
            <div className="mt-3 space-y-3">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{selection.node.label}</p>
                  <Badge variant="outline">{selection.node.entity_type}</Badge>
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {selection.node.node_id}
                </p>
              </div>
              {selection.node.description && (
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-5">
                  {selection.node.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border p-2">
                  <span className="text-muted-foreground">
                    {t('answerCatalog.graph.connectionCount', 'Connections')}
                  </span>
                  <strong className="mt-1 block text-sm">{selectedNodeRelations}</strong>
                </div>
                <div className="rounded-md border p-2">
                  <span className="text-muted-foreground">
                    {t('answerCatalog.graph.source', 'Source')}
                  </span>
                  <strong className="mt-1 block text-sm">{selection.node.source}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <Badge variant="outline">{selection.relation.relation_type}</Badge>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="block text-xs text-muted-foreground">
                    {t('answerCatalog.graph.relationSource', 'From')}
                  </span>
                  {nodeById.get(selection.relation.source_id)?.label ||
                    selection.relation.source_id}
                </p>
                <p>
                  <span className="block text-xs text-muted-foreground">
                    {t('answerCatalog.graph.relationTarget', 'To')}
                  </span>
                  {nodeById.get(selection.relation.target_id)?.label ||
                    selection.relation.target_id}
                </p>
              </div>
              {selection.relation.description && (
                <p className="rounded-md bg-muted/40 p-3 text-xs leading-5">
                  {selection.relation.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border p-2">
                  <span className="text-muted-foreground">
                    {t('answerCatalog.graph.weightLabel', 'Weight')}
                  </span>
                  <strong className="mt-1 block text-sm">{selection.relation.weight}</strong>
                </div>
                <div className="rounded-md border p-2">
                  <span className="text-muted-foreground">
                    {t('answerCatalog.graph.source', 'Source')}
                  </span>
                  <strong className="mt-1 block text-sm">{selection.relation.source}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            {t('answerCatalog.graph.legend', 'Node types')}
          </div>
          <div className="flex flex-wrap gap-2">
            {typeCounts.map(([entityType, count]) => (
              <span
                key={entityType}
                className="inline-flex items-center gap-1.5 text-xs"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: ENTITY_COLORS[entityType] || DEFAULT_NODE_COLOR }}
                />
                {entityType} {count}
              </span>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
