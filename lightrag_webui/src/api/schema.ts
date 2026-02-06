import axios from 'axios'
import { backendBaseUrl } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

// =============================================================================
// Types
// =============================================================================

export interface EntityType {
  name: string
  display_name: string
  description: string
  examples: string[]
  color?: string
  icon?: string
  confidence?: number
}

export interface RelationType {
  name: string
  display_name: string
  description: string
  source_types: string[]
  target_types: string[]
  is_directional?: boolean
  cardinality?: string
  confidence?: number
}

export interface DomainSchema {
  domain: string
  display_name: string
  description: string
  entity_types: EntityType[]
  relation_types: RelationType[]
  version: string
  tags: string[]
  extends?: string[]
  created_at?: string
  updated_at?: string
  author?: string
}

export interface TemplateSummary {
  domain: string
  display_name: string
  description: string
  entity_count: number
  relation_count: number
  tags: string[]
  version: string
}

export interface SchemaDiscoveryResult {
  entity_types: EntityType[]
  relation_types: RelationType[]
  source_type: 'document' | 'domain_keyword' | 'hybrid'
  confidence: number
  sample_extractions?: any[]
  similar_templates?: string[]
  suggestions?: string[]
  domain_summary?: string
}

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  entity_count: number
  relation_count: number
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
}

// =============================================================================
// API Client
// =============================================================================

const schemaApi = axios.create({
  baseURL: `${backendBaseUrl}/api/schema`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add workspace header interceptor
schemaApi.interceptors.request.use((config) => {
  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId
  if (workspaceId) {
    config.headers['LIGHTRAG-WORKSPACE'] = workspaceId
  }
  return config
})

// =============================================================================
// Discovery API
// =============================================================================

export interface DiscoverFromDocumentOptions {
  sample_size?: number
  max_entity_types?: number
  max_relation_types?: number
  language?: string
  domain_hints?: string
  include_common_types?: boolean  // Include common contact center entity/relation types
}

export async function discoverFromDocument(
  documents: { content: string; file_path?: string }[],
  options?: DiscoverFromDocumentOptions
): Promise<SchemaDiscoveryResult> {
  try {
    // Extract include_common_types to top level (API expects it there)
    const include_common_types = options?.include_common_types ?? true
    const { include_common_types: _, ...restOptions } = options || {}

    const response = await schemaApi.post<ApiResponse<SchemaDiscoveryResult>>(
      '/discover/from-document',
      { documents, options: restOptions, include_common_types }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Discovery failed')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export interface DiscoverFromFilesOptions {
  max_entity_types?: number
  max_relation_types?: number
  domain_hints?: string
  language?: string
  include_common_types?: boolean
}

export async function discoverFromFiles(
  files: File[],
  options?: DiscoverFromFilesOptions
): Promise<SchemaDiscoveryResult> {
  try {
    const formData = new FormData()

    // Add files
    for (const file of files) {
      formData.append('files', file)
    }

    // Add options as form fields
    if (options?.max_entity_types) {
      formData.append('max_entity_types', options.max_entity_types.toString())
    }
    if (options?.max_relation_types) {
      formData.append('max_relation_types', options.max_relation_types.toString())
    }
    if (options?.domain_hints) {
      formData.append('domain_hints', options.domain_hints)
    }
    if (options?.language) {
      formData.append('language', options.language)
    }
    if (options?.include_common_types !== undefined) {
      formData.append('include_common_types', options.include_common_types.toString())
    }

    const response = await schemaApi.post<ApiResponse<SchemaDiscoveryResult>>(
      '/discover/from-files',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Discovery failed')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export interface DiscoverFromDomainOptions {
  max_entity_types?: number
  max_relation_types?: number
  language?: string
  merge_strategy?: 'union' | 'intersection'
  include_common_types?: boolean
}

export async function discoverFromDomain(
  domains: string[],
  options?: DiscoverFromDomainOptions
): Promise<SchemaDiscoveryResult> {
  try {
    // Extract include_common_types to top level (API expects it there)
    const include_common_types = options?.include_common_types ?? true
    const { include_common_types: _, ...restOptions } = options || {}

    const response = await schemaApi.post<ApiResponse<SchemaDiscoveryResult>>(
      '/discover/from-domain',
      { domains, options: restOptions, include_common_types }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Discovery failed')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function discoverHybrid(
  documents: { content: string; file_path?: string }[],
  domainHints: string[],
  options?: {
    template_weight?: number
    discovery_weight?: number
  }
): Promise<SchemaDiscoveryResult> {
  try {
    const response = await schemaApi.post<ApiResponse<SchemaDiscoveryResult>>(
      '/discover/hybrid',
      { documents, domain_hints: domainHints, options }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Discovery failed')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

// =============================================================================
// Template API
// =============================================================================

export interface ListTemplatesResponse {
  templates: TemplateSummary[]
  total: number
  limit: number
  offset: number
}

export async function listTemplates(
  tags?: string[],
  limit = 100,
  offset = 0
): Promise<ListTemplatesResponse> {
  try {
    const params: Record<string, string | number> = { limit, offset }
    if (tags && tags.length > 0) {
      params.tags = tags.join(',')
    }
    const response = await schemaApi.get<ApiResponse<ListTemplatesResponse>>(
      '/templates',
      { params }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to list templates')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function getTemplate(domain: string): Promise<DomainSchema> {
  try {
    const response = await schemaApi.get<ApiResponse<DomainSchema>>(
      `/templates/${domain}`
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Template not found')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export interface CreateTemplateInput {
  domain: string
  display_name: string
  description: string
  entity_types: Omit<EntityType, 'confidence'>[]
  relation_types: Omit<RelationType, 'confidence'>[]
  tags?: string[]
}

export async function createTemplate(input: CreateTemplateInput): Promise<DomainSchema> {
  try {
    const response = await schemaApi.post<ApiResponse<DomainSchema>>(
      '/templates',
      input
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to create template')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function updateTemplate(
  domain: string,
  input: CreateTemplateInput
): Promise<DomainSchema> {
  try {
    const response = await schemaApi.put<ApiResponse<DomainSchema>>(
      `/templates/${domain}`,
      input
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to update template')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function deleteTemplate(domain: string): Promise<void> {
  try {
    const response = await schemaApi.delete<ApiResponse<{ deleted: string }>>(
      `/templates/${domain}`
    )
    if (!response.data.success) {
      throw new Error(response.data.error?.message || 'Failed to delete template')
    }
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function mergeTemplates(
  domains: string[],
  newDomain?: string,
  options?: {
    merge_strategy?: 'union' | 'intersection'
    save_as_template?: boolean
  }
): Promise<DomainSchema> {
  try {
    const response = await schemaApi.post<ApiResponse<DomainSchema>>(
      '/templates/merge',
      { domains, new_domain: newDomain, options }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to merge templates')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

// =============================================================================
// Analysis API
// =============================================================================

export async function validateSchema(
  input: CreateTemplateInput
): Promise<SchemaValidationResult> {
  try {
    const response = await schemaApi.post<ApiResponse<SchemaValidationResult>>(
      '/analyze/validate',
      input
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Validation failed')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

// =============================================================================
// Schema Application API
// =============================================================================

export interface CurrentSchema {
  entity_types: string[]
  source: string | null
  applied_at: string | null
  is_default: boolean
}

export interface ApplySchemaResult {
  entity_types: string[]
  source: string | null
  applied_at: string | null
  previous_count: number
}

export async function getCurrentSchema(): Promise<CurrentSchema> {
  try {
    const response = await schemaApi.get<ApiResponse<CurrentSchema>>('/current')
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to get current schema')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function applySchema(
  entityTypes: string[],
  source?: string
): Promise<ApplySchemaResult> {
  try {
    const response = await schemaApi.post<ApiResponse<ApplySchemaResult>>(
      '/apply',
      { entity_types: entityTypes, source }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to apply schema')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function resetSchema(): Promise<ApplySchemaResult> {
  try {
    const response = await schemaApi.post<ApiResponse<ApplySchemaResult>>('/reset')
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to reset schema')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

// =============================================================================
// Schema Merge API
// =============================================================================

export interface MergePreviewResult {
  current_types: string[]
  new_types: string[]
  duplicates: string[]
  merged_result: string[]
  current_count: number
  new_count: number
  duplicate_count: number
  merged_count: number
  source: string | null
}

export interface MergeApplyResult {
  entity_types: string[]
  source: string | null
  applied_at: string | null
  previous_count: number
  added_count: number
  duplicate_count: number
  duplicates_excluded: string[]
}

export async function mergePreview(
  newEntityTypes: string[],
  source?: string
): Promise<MergePreviewResult> {
  try {
    const response = await schemaApi.post<ApiResponse<MergePreviewResult>>(
      '/merge/preview',
      { new_entity_types: newEntityTypes, source }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to preview merge')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

export async function mergeApply(
  newEntityTypes: string[],
  source?: string,
  excludeDuplicates = true
): Promise<MergeApplyResult> {
  try {
    const response = await schemaApi.post<ApiResponse<MergeApplyResult>>(
      '/merge/apply',
      {
        new_entity_types: newEntityTypes,
        source,
        exclude_duplicates: excludeDuplicates,
        confirmed: true,
      }
    )
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error?.message || 'Failed to apply merge')
    }
    return response.data.data
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}
