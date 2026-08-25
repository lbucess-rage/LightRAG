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
  | 'llm-settings'
  | 'workspaces'
  | 'answers'
  | 'answer-sources'
  | 'answer-matching'
  | 'structured-data'
  | 'answer-test'
  | 'answer-analytics'
  | 'answer-detailed-analytics'
  | 'answer-help'

export type NavigationItem = {
  value: AppTab
  labelKey: string
  fallback: string
  group: 'kms' | 'answer' | 'ops'
  showInNavigation?: boolean
}

export const navigationItems: NavigationItem[] = [
  { value: 'documents', labelKey: 'header.documents', fallback: 'Documents', group: 'kms' },
  { value: 'chunks', labelKey: 'header.chunks', fallback: 'Chunks', group: 'kms' },
  { value: 'knowledge-graph', labelKey: 'header.knowledgeGraph', fallback: 'Knowledge Graph', group: 'kms' },
  { value: 'entity-management', labelKey: 'header.entityManagement', fallback: 'Entity-Relation', group: 'kms' },
  { value: 'schema', labelKey: 'header.schema', fallback: 'Schema', group: 'kms' },
  { value: 'retrieval', labelKey: 'header.retrieval', fallback: 'Search', group: 'kms' },
  { value: 'answers', labelKey: 'header.answers', fallback: 'FAQ List', group: 'answer' },
  { value: 'answer-sources', labelKey: 'header.answerSources', fallback: 'Create FAQ', group: 'answer' },
  { value: 'answer-matching', labelKey: 'header.answerMatching', fallback: 'Answer Item Settings', group: 'answer', showInNavigation: false },
  { value: 'structured-data', labelKey: 'header.structuredData', fallback: 'Structured Data', group: 'answer', showInNavigation: false },
  { value: 'answer-test', labelKey: 'header.answerTest', fallback: 'FAQ Quality', group: 'answer' },
  { value: 'answer-analytics', labelKey: 'header.answerAnalytics', fallback: 'Analytics', group: 'answer', showInNavigation: false },
  { value: 'answer-detailed-analytics', labelKey: 'header.answerDetailedAnalytics', fallback: 'Detail Analytics', group: 'answer', showInNavigation: false },
  { value: 'answer-help', labelKey: 'header.answerHelp', fallback: 'Help', group: 'answer', showInNavigation: false },
  { value: 'api', labelKey: 'header.api', fallback: 'API', group: 'ops' },
  { value: 'prompts', labelKey: 'header.prompts', fallback: 'Prompts', group: 'ops' },
  { value: 'llm-settings', labelKey: 'header.llmSettings', fallback: 'LLM Settings', group: 'ops' },
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
      'answer-detailed-analytics',
      'answer-help',
      'api',
      'llm-settings',
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
      'answer-detailed-analytics',
      'answer-help',
      'api',
      'prompts',
      'llm-settings',
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
    'llm-settings',
    'workspaces',
  ]
}

export const getDefaultTabForMode = (mode: WorkspaceMode): AppTab =>
  mode === 'answer_catalog' ? 'answers' : 'documents'
