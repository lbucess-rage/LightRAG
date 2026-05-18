import { WorkspaceMode } from '@/api/lightrag'

export type AppTab =
  | 'documents'
  | 'chunks'
  | 'knowledge-graph'
  | 'entity-management'
  | 'schema'
  | 'retrieval'
  | 'api'
  | 'prompts'
  | 'workspaces'
  | 'answers'
  | 'answer-sources'
  | 'answer-matching'
  | 'structured-data'
  | 'answer-test'
  | 'answer-analytics'
  | 'answer-help'

export type NavigationItem = {
  value: AppTab
  labelKey: string
  fallback: string
  group: 'kms' | 'answer' | 'ops'
}

export const navigationItems: NavigationItem[] = [
  { value: 'documents', labelKey: 'header.documents', fallback: 'Documents', group: 'kms' },
  { value: 'chunks', labelKey: 'header.chunks', fallback: 'Chunks', group: 'kms' },
  { value: 'knowledge-graph', labelKey: 'header.knowledgeGraph', fallback: 'Knowledge Graph', group: 'kms' },
  { value: 'entity-management', labelKey: 'header.entityManagement', fallback: 'Entity-Relation', group: 'kms' },
  { value: 'schema', labelKey: 'header.schema', fallback: 'Schema', group: 'kms' },
  { value: 'retrieval', labelKey: 'header.retrieval', fallback: 'Search', group: 'kms' },
  { value: 'answers', labelKey: 'header.answers', fallback: 'Answers', group: 'answer' },
  { value: 'answer-sources', labelKey: 'header.answerSources', fallback: 'Sources', group: 'answer' },
  { value: 'answer-matching', labelKey: 'header.answerMatching', fallback: 'Matching', group: 'answer' },
  { value: 'structured-data', labelKey: 'header.structuredData', fallback: 'Structured Data', group: 'answer' },
  { value: 'answer-test', labelKey: 'header.answerTest', fallback: 'Test Console', group: 'answer' },
  { value: 'answer-analytics', labelKey: 'header.answerAnalytics', fallback: 'Analytics', group: 'answer' },
  { value: 'answer-help', labelKey: 'header.answerHelp', fallback: 'Help', group: 'answer' },
  { value: 'api', labelKey: 'header.api', fallback: 'API', group: 'ops' },
  { value: 'prompts', labelKey: 'header.prompts', fallback: 'Prompts', group: 'ops' },
  { value: 'workspaces', labelKey: 'header.workspaces', fallback: 'Workspaces', group: 'ops' },
]

export const getVisibleTabsForMode = (mode: WorkspaceMode): AppTab[] => {
  if (mode === 'answer_catalog') {
    return [
      'answers',
      'answer-sources',
      'answer-matching',
      'structured-data',
      'answer-test',
      'answer-analytics',
      'answer-help',
      'api',
      'workspaces',
    ]
  }
  if (mode === 'hybrid') {
    return [
      'documents',
      'chunks',
      'knowledge-graph',
      'entity-management',
      'schema',
      'retrieval',
      'answers',
      'answer-sources',
      'answer-matching',
      'structured-data',
      'answer-test',
      'answer-analytics',
      'answer-help',
      'api',
      'prompts',
      'workspaces',
    ]
  }
  return [
    'documents',
    'chunks',
    'knowledge-graph',
    'entity-management',
    'schema',
    'retrieval',
    'api',
    'prompts',
    'workspaces',
  ]
}

export const getDefaultTabForMode = (mode: WorkspaceMode): AppTab =>
  mode === 'answer_catalog' ? 'answers' : 'documents'
