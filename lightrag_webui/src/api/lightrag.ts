import axios, { AxiosError } from 'axios'
import { backendBaseUrl, popularLabelsDefaultLimit, searchLabelsDefaultLimit } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'
import { navigationService } from '@/services/navigation'
import { encodeWorkspaceHeader } from '@/lib/workspaceHeader'

// Types
export type LightragNodeType = {
  id: string
  labels: string[]
  properties: Record<string, any>
}

export type LightragEdgeType = {
  id: string
  source: string
  target: string
  type: string
  properties: Record<string, any>
}

export type LightragGraphType = {
  nodes: LightragNodeType[]
  edges: LightragEdgeType[]
}

export type LightragStatus = {
  status: 'healthy'
  working_directory: string
  input_directory: string
  configuration: {
    llm_binding: string
    llm_binding_host: string
    llm_model: string
    embedding_binding: string
    embedding_binding_host: string
    embedding_model: string
    kv_storage: string
    doc_status_storage: string
    graph_storage: string
    vector_storage: string
    workspace?: string
    max_graph_nodes?: string
    enable_rerank?: boolean
    rerank_binding?: string | null
    rerank_model?: string | null
    rerank_binding_host?: string | null
    summary_language: string
    force_llm_summary_on_merge: boolean
    max_parallel_insert: number
    max_async: number
    embedding_func_max_async: number
    embedding_batch_num: number
    cosine_threshold: number
    min_rerank_score: number
    related_chunk_number: number
  }
  update_status?: Record<string, any>
  core_version?: string
  api_version?: string
  auth_mode?: 'enabled' | 'disabled'
  pipeline_busy: boolean
  keyed_locks?: {
    process_id: number
    cleanup_performed: {
      mp_cleaned: number
      async_cleaned: number
    }
    current_status: {
      total_mp_locks: number
      pending_mp_cleanup: number
      total_async_locks: number
      pending_async_cleanup: number
    }
  }
  webui_title?: string
  webui_description?: string
}

export type LightragDocumentsScanProgress = {
  is_scanning: boolean
  current_file: string
  indexed_count: number
  total_files: number
  progress: number
}

/**
 * Specifies the retrieval mode:
 * - "naive": Performs a basic search without advanced techniques.
 * - "local": Focuses on context-dependent information.
 * - "global": Utilizes global knowledge.
 * - "hybrid": Combines local and global retrieval methods.
 * - "mix": Integrates knowledge graph and vector retrieval.
 * - "bypass": Bypasses knowledge retrieval and directly uses the LLM.
 */
export type QueryMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | 'bypass'

export type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
  thinkingContent?: string
  displayContent?: string
  thinkingTime?: number | null
}

export type QueryRequest = {
  query: string
  /** Specifies the retrieval mode. */
  mode: QueryMode
  /** If True, only returns the retrieved context without generating a response. */
  only_need_context?: boolean
  /** If True, only returns the generated prompt without producing a response. */
  only_need_prompt?: boolean
  /** Defines the response format. Examples: 'Multiple Paragraphs', 'Single Paragraph', 'Bullet Points'. */
  response_type?: string
  /** If True, enables streaming output for real-time responses. */
  stream?: boolean
  /** Number of top items to retrieve. Represents entities in 'local' mode and relationships in 'global' mode. */
  top_k?: number
  /** Maximum number of text chunks to retrieve and keep after reranking. */
  chunk_top_k?: number
  /** Maximum number of tokens allocated for entity context in unified token control system. */
  max_entity_tokens?: number
  /** Maximum number of tokens allocated for relationship context in unified token control system. */
  max_relation_tokens?: number
  /** Maximum total tokens budget for the entire query context (entities + relations + chunks + system prompt). */
  max_total_tokens?: number
  /**
   * Stores past conversation history to maintain context.
   * Format: [{"role": "user/assistant", "content": "message"}].
   */
  conversation_history?: Message[]
  /** Number of complete conversation turns (user-assistant pairs) to consider in the response context. */
  history_turns?: number
  /** User-provided prompt for the query. If provided, this will be used instead of the default value from prompt template. */
  user_prompt?: string
  /** Enable reranking for retrieved text chunks. If True but no rerank model is configured, a warning will be issued. Default is True. */
  enable_rerank?: boolean
  /** If True, includes reference documents in the response. */
  include_references?: boolean
  /** If True, includes chunk content (images, tables, etc.) in the references. */
  include_chunk_content?: boolean
  /** If True, highlights entity names in bold and relation keywords in italics. */
  highlight_entities?: boolean
}

export type StructuredContentItem = {
  type: 'image' | 'table' | 'text' | 'equation' | string
  image?: { path?: string; s3_url?: string; captions?: string[]; footnotes?: string[] }
  table?: { caption?: string[]; footnotes?: string[]; body_markdown?: string }
  equation?: { text?: string; format?: string }
  content?: { raw?: string } | string
  entity?: { name?: string; type?: string; summary?: string }
  source?: { doc_id?: string; page_idx?: number; file_path?: string; chunk_order_index?: number }
  analysis?: { description?: string }
  version?: string
  score?: number
}

export type ReferenceItem = {
  reference_id: string
  doc_id?: string
  file_path: string
  download_url?: string
  content?: string[]
  structured_content?: StructuredContentItem[]
  score?: number
  scores?: (number | null)[]
  evidence?: string[]
  doc_nm?: string
}

export type QueryResponse = {
  response: string
  references?: ReferenceItem[]
}

export type EntityUpdateResponse = {
  status: string
  message: string
  data: Record<string, any>
  operation_summary?: {
    merged: boolean
    merge_status: 'success' | 'failed' | 'not_attempted'
    merge_error: string | null
    operation_status: 'success' | 'partial_success' | 'failure'
    target_entity: string | null
    final_entity?: string | null
    renamed?: boolean
  }
}

export type DocActionResponse = {
  status: 'success' | 'partial_success' | 'failure' | 'duplicated'
  message: string
  track_id?: string
  task_id?: string
  stream_url?: string
}

export type ScanResponse = {
  status: 'scanning_started'
  message: string
  track_id: string
  task_id?: string
  stream_url?: string
}

export type ReprocessFailedResponse = {
  status: 'reprocessing_started'
  message: string
  track_id: string
}

export type DeleteDocResponse = {
  status: 'deletion_started' | 'busy' | 'not_allowed'
  message: string
  doc_id: string
}

export type DocStatus = 'pending' | 'processing' | 'preprocessed' | 'processed' | 'failed'

export type DocStatusResponse = {
  id: string
  content_summary: string
  content_length: number
  status: DocStatus
  created_at: string
  updated_at: string
  track_id?: string
  chunks_count?: number
  error_msg?: string
  metadata?: Record<string, any>
  file_path: string
  doc_nm?: string
}

export type DocsStatusesResponse = {
  statuses: Record<DocStatus, DocStatusResponse[]>
}

export type TrackStatusResponse = {
  track_id: string
  documents: DocStatusResponse[]
  total_count: number
  status_summary: Record<string, number>
}

export type DocumentsRequest = {
  status_filter?: DocStatus | null
  page: number
  page_size: number
  sort_field: 'created_at' | 'updated_at' | 'id' | 'file_path'
  sort_direction: 'asc' | 'desc'
}

export type PaginationInfo = {
  page: number
  page_size: number
  total_count: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export type PaginatedDocsResponse = {
  documents: DocStatusResponse[]
  pagination: PaginationInfo
  status_counts: Record<string, number>
}

export type StatusCountsResponse = {
  status_counts: Record<string, number>
}

export type AuthStatusResponse = {
  auth_configured: boolean
  access_token?: string
  token_type?: string
  auth_mode?: 'enabled' | 'disabled'
  message?: string
  core_version?: string
  api_version?: string
  webui_title?: string
  webui_description?: string
}

export type PipelineStatusResponse = {
  autoscanned: boolean
  busy: boolean
  job_name: string
  job_start?: string
  docs: number
  batchs: number
  cur_batch: number
  request_pending: boolean
  cancellation_requested?: boolean
  latest_message: string
  history_messages?: string[]
  update_status?: Record<string, any>
}

export type LoginResponse = {
  access_token: string
  token_type: string
  auth_mode?: 'enabled' | 'disabled'  // Authentication mode identifier
  message?: string                    // Optional message
  core_version?: string
  api_version?: string
  webui_title?: string
  webui_description?: string
}

export const InvalidApiKeyError = 'Invalid API Key'
export const RequireApiKeError = 'API Key required'

// Axios instance
const axiosInstance = axios.create({
  baseURL: backendBaseUrl,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Interceptor: add api key, workspace header, and check authentication
axiosInstance.interceptors.request.use((config) => {
  const apiKey = useSettingsStore.getState().apiKey
  const token = localStorage.getItem('LIGHTRAG-API-TOKEN');
  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId

  // Always include token if it exists, regardless of path
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  if (apiKey) {
    config.headers['X-API-Key'] = apiKey
  }
  // Include workspace header for multi-tenant support
  const workspaceHeader = encodeWorkspaceHeader(workspaceId)
  if (workspaceHeader && !config.headers['LIGHTRAG-WORKSPACE']) {
    config.headers['LIGHTRAG-WORKSPACE'] = workspaceHeader
  }
  return config
})

// Interceptor：hanle error
axiosInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      if (error.response?.status === 401) {
        // For login API, throw error directly
        if (error.config?.url?.includes('/login')) {
          throw error;
        }
        // For other APIs, navigate to login page
        navigationService.navigateToLogin();

        // return a reject Promise
        return Promise.reject(new Error('Authentication required'));
      }
      throw new Error(
        `${error.response.status} ${error.response.statusText}\n${JSON.stringify(
          error.response.data
        )}\n${error.config?.url}`
      )
    }
    throw error
  }
)

// API methods
export const queryGraphs = async (
  label: string,
  maxDepth: number,
  maxNodes: number
): Promise<LightragGraphType> => {
  const response = await axiosInstance.get(`/graphs?label=${encodeURIComponent(label)}&max_depth=${maxDepth}&max_nodes=${maxNodes}`)
  return response.data
}

export const getGraphLabels = async (): Promise<string[]> => {
  const response = await axiosInstance.get('/graph/label/list')
  return response.data
}

export const getPopularLabels = async (limit: number = popularLabelsDefaultLimit): Promise<string[]> => {
  const response = await axiosInstance.get(`/graph/label/popular?limit=${limit}`)
  return response.data
}

export const searchLabels = async (query: string, limit: number = searchLabelsDefaultLimit): Promise<string[]> => {
  const response = await axiosInstance.get(`/graph/label/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  return response.data
}

export const checkHealth = async (): Promise<
  LightragStatus | { status: 'error'; message: string }
> => {
  try {
    const response = await axiosInstance.get('/health')
    return response.data
  } catch (error) {
    return {
      status: 'error',
      message: errorMessage(error)
    }
  }
}

export const getDocuments = async (): Promise<DocsStatusesResponse> => {
  const response = await axiosInstance.get('/documents')
  return response.data
}

export const scanNewDocuments = async (): Promise<ScanResponse> => {
  const response = await axiosInstance.post('/documents/scan')
  return response.data
}

export const reprocessFailedDocuments = async (): Promise<ReprocessFailedResponse> => {
  const response = await axiosInstance.post('/documents/reprocess_failed')
  return response.data
}

export const getDocumentsScanProgress = async (): Promise<LightragDocumentsScanProgress> => {
  const response = await axiosInstance.get('/documents/scan-progress')
  return response.data
}

export const queryText = async (request: QueryRequest): Promise<QueryResponse> => {
  const response = await axiosInstance.post('/query', request)
  return response.data
}

export const queryTextStream = async (
  request: QueryRequest,
  onChunk: (chunk: string) => void,
  onError?: (error: string) => void,
  onReferences?: (references: ReferenceItem[]) => void,
  onEvidenceMap?: (evidenceMap: Record<string, string[]>) => void
) => {
  const apiKey = useSettingsStore.getState().apiKey;
  const token = localStorage.getItem('LIGHTRAG-API-TOKEN');
  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/x-ndjson',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  const workspaceHeader = encodeWorkspaceHeader(workspaceId);
  if (workspaceHeader) {
    headers['LIGHTRAG-WORKSPACE'] = workspaceHeader;
  }

  try {
    const response = await fetch(`${backendBaseUrl}/query/stream`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      // Handle 401 Unauthorized error specifically
      if (response.status === 401) {
        // For consistency with axios interceptor, navigate to login page
        navigationService.navigateToLogin();

        // Create a specific authentication error
        const authError = new Error('Authentication required');
        throw authError;
      }

      // Handle other common HTTP errors with specific messages
      let errorBody = 'Unknown error';
      try {
        errorBody = await response.text(); // Try to get error details from body
      } catch { /* ignore */ }

      // Format error message similar to axios interceptor for consistency
      const url = `${backendBaseUrl}/query/stream`;
      throw new Error(
        `${response.status} ${response.statusText}\n${JSON.stringify(
          { error: errorBody }
        )}\n${url}`
      );
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break; // Stream finished
      }

      // Decode the chunk and add to buffer
      buffer += decoder.decode(value, { stream: true }); // stream: true handles multi-byte chars split across chunks

      // Process complete lines (NDJSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep potentially incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            // Handle references and response separately (non-streaming sends both in one line)
            if (parsed.references && onReferences) {
              onReferences(parsed.references);
            }
            if (parsed.response) {
              onChunk(parsed.response);
            }
            if (parsed.evidence_map && onEvidenceMap) {
              onEvidenceMap(parsed.evidence_map);
            }
            if (parsed.error && onError) {
              onError(parsed.error);
            }
          } catch (error) {
            console.error('Error parsing stream chunk:', line, error);
            if (onError) onError(`Error parsing server response: ${line}`);
          }
        }
      }
    }

    // Process any remaining data in the buffer after the stream ends
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.references && onReferences) {
          onReferences(parsed.references);
        }
        if (parsed.response) {
          onChunk(parsed.response);
        }
        if (parsed.evidence_map && onEvidenceMap) {
          onEvidenceMap(parsed.evidence_map);
        }
        if (parsed.error && onError) {
          onError(parsed.error);
        }
      } catch (error) {
        console.error('Error parsing final chunk:', buffer, error);
        if (onError) onError(`Error parsing final server response: ${buffer}`);
      }
    }

  } catch (error) {
    const message = errorMessage(error);

    // Check if this is an authentication error
    if (message === 'Authentication required') {
      // Already navigated to login page in the response.status === 401 block
      console.error('Authentication required for stream request');
      if (onError) {
        onError('Authentication required');
      }
      return; // Exit early, no need for further error handling
    }

    // Check for specific HTTP error status codes in the error message
    const statusCodeMatch = message.match(/^(\d{3})\s/);
    if (statusCodeMatch) {
      const statusCode = parseInt(statusCodeMatch[1], 10);

      // Handle specific status codes with user-friendly messages
      let userMessage = message;

      switch (statusCode) {
      case 403:
        userMessage = 'You do not have permission to access this resource (403 Forbidden)';
        console.error('Permission denied for stream request:', message);
        break;
      case 404:
        userMessage = 'The requested resource does not exist (404 Not Found)';
        console.error('Resource not found for stream request:', message);
        break;
      case 429:
        userMessage = 'Too many requests, please try again later (429 Too Many Requests)';
        console.error('Rate limited for stream request:', message);
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        userMessage = `Server error, please try again later (${statusCode})`;
        console.error('Server error for stream request:', message);
        break;
      default:
        console.error('Stream request failed with status code:', statusCode, message);
      }

      if (onError) {
        onError(userMessage);
      }
      return;
    }

    // Handle network errors (like connection refused, timeout, etc.)
    if (message.includes('NetworkError') ||
        message.includes('Failed to fetch') ||
        message.includes('Network request failed')) {
      console.error('Network error for stream request:', message);
      if (onError) {
        onError('Network connection error, please check your internet connection');
      }
      return;
    }

    // Handle JSON parsing errors during stream processing
    if (message.includes('Error parsing') || message.includes('SyntaxError')) {
      console.error('JSON parsing error in stream:', message);
      if (onError) {
        onError('Error processing response data');
      }
      return;
    }

    // Handle other errors
    console.error('Unhandled stream error:', message);
    if (onError) {
      onError(message);
    } else {
      console.error('No error handler provided for stream error:', message);
    }
  }
};

export const insertText = async (text: string): Promise<DocActionResponse> => {
  const response = await axiosInstance.post('/documents/text', { text })
  return response.data
}

export const insertTextWithSource = async (
  text: string,
  fileSource?: string
): Promise<DocActionResponse> => {
  const payload: Record<string, string> = { text }
  if (fileSource) {
    payload.file_source = fileSource
  }
  const response = await axiosInstance.post('/documents/text', payload)
  return response.data
}

export const insertTexts = async (texts: string[]): Promise<DocActionResponse> => {
  const response = await axiosInstance.post('/documents/texts', { texts })
  return response.data
}

export const uploadDocument = async (
  file: File,
  onUploadProgress?: (percentCompleted: number) => void
): Promise<DocActionResponse> => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await axiosInstance.post('/documents/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    },
    // prettier-ignore
    onUploadProgress:
      onUploadProgress !== undefined
        ? (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total!)
          onUploadProgress(percentCompleted)
        }
        : undefined
  })
  return response.data
}

export const batchUploadDocuments = async (
  files: File[],
  onUploadProgress?: (fileName: string, percentCompleted: number) => void
): Promise<DocActionResponse[]> => {
  return await Promise.all(
    files.map(async (file) => {
      return await uploadDocument(file, (percentCompleted) => {
        onUploadProgress?.(file.name, percentCompleted)
      })
    })
  )
}

export const clearDocuments = async (): Promise<DocActionResponse> => {
  const response = await axiosInstance.delete('/documents')
  return response.data
}

export const clearCache = async (): Promise<{
  status: 'success' | 'fail'
  message: string
}> => {
  const response = await axiosInstance.post('/documents/clear_cache', {})
  return response.data
}

export const deleteDocuments = async (
  docIds: string[],
  deleteFile: boolean = false,
  deleteLLMCache: boolean = false,
  deleteS3File: boolean = false
): Promise<DeleteDocResponse> => {
  const response = await axiosInstance.delete('/documents/delete_document', {
    data: { doc_ids: docIds, delete_file: deleteFile, delete_llm_cache: deleteLLMCache, delete_s3_file: deleteS3File }
  })
  return response.data
}

export const getAuthStatus = async (): Promise<AuthStatusResponse> => {
  try {
    // Add a timeout to the request to prevent hanging
    const response = await axiosInstance.get('/auth-status', {
      timeout: 5000, // 5 second timeout
      headers: {
        'Accept': 'application/json' // Explicitly request JSON
      }
    });

    // Check if response is HTML (which indicates a redirect or wrong endpoint)
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      console.warn('Received HTML response instead of JSON for auth-status endpoint');
      return {
        auth_configured: true,
        auth_mode: 'enabled'
      };
    }

    // Strict validation of the response data
    if (response.data &&
        typeof response.data === 'object' &&
        'auth_configured' in response.data &&
        typeof response.data.auth_configured === 'boolean') {

      // For unconfigured auth, ensure we have an access token
      if (!response.data.auth_configured) {
        if (response.data.access_token && typeof response.data.access_token === 'string') {
          return response.data;
        } else {
          console.warn('Auth not configured but no valid access token provided');
        }
      } else {
        // For configured auth, just return the data
        return response.data;
      }
    }

    // If response data is invalid but we got a response, log it
    console.warn('Received invalid auth status response:', response.data);

    // Default to auth configured if response is invalid
    return {
      auth_configured: true,
      auth_mode: 'enabled'
    };
  } catch (error) {
    // If the request fails, assume authentication is configured
    console.error('Failed to get auth status:', errorMessage(error));
    return {
      auth_configured: true,
      auth_mode: 'enabled'
    };
  }
}

export const getPipelineStatus = async (): Promise<PipelineStatusResponse> => {
  const response = await axiosInstance.get('/documents/pipeline_status')
  return response.data
}

export const cancelPipeline = async (): Promise<{
  status: 'cancellation_requested' | 'not_busy'
  message: string
}> => {
  const response = await axiosInstance.post('/documents/cancel_pipeline')
  return response.data
}

export const loginToServer = async (username: string, password: string): Promise<LoginResponse> => {
  const formData = new FormData();
  formData.append('username', username);
  formData.append('password', password);

  const response = await axiosInstance.post('/login', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });

  return response.data;
}

/**
 * Updates an entity's properties in the knowledge graph
 * @param entityName The name of the entity to update
 * @param updatedData Dictionary containing updated attributes
 * @param allowRename Whether to allow renaming the entity (default: false)
 * @param allowMerge Whether to merge into an existing entity when renaming to a duplicate name
 * @returns Promise with the updated entity information
 */
export const updateEntity = async (
  entityName: string,
  updatedData: Record<string, any>,
  allowRename: boolean = false,
  allowMerge: boolean = false
): Promise<EntityUpdateResponse> => {
  const response = await axiosInstance.post('/graph/entity/edit', {
    entity_name: entityName,
    updated_data: updatedData,
    allow_rename: allowRename,
    allow_merge: allowMerge
  })
  return response.data
}

/**
 * Updates a relation's properties in the knowledge graph
 * @param sourceEntity The source entity name
 * @param targetEntity The target entity name
 * @param updatedData Dictionary containing updated attributes
 * @returns Promise with the updated relation information
 */
export const updateRelation = async (
  sourceEntity: string,
  targetEntity: string,
  updatedData: Record<string, any>
): Promise<DocActionResponse> => {
  const response = await axiosInstance.post('/graph/relation/edit', {
    source_id: sourceEntity,
    target_id: targetEntity,
    updated_data: updatedData
  })
  return response.data
}

/**
 * Checks if an entity name already exists in the knowledge graph
 * @param entityName The entity name to check
 * @returns Promise with boolean indicating if the entity exists
 */
export const checkEntityNameExists = async (entityName: string): Promise<boolean> => {
  try {
    const response = await axiosInstance.get(`/graph/entity/exists?name=${encodeURIComponent(entityName)}`)
    return response.data.exists
  } catch (error) {
    console.error('Error checking entity name:', error)
    return false
  }
}

/**
 * Get the processing status of documents by tracking ID
 * @param trackId The tracking ID returned from upload, text, or texts endpoints
 * @returns Promise with the track status response containing documents and summary
 */
export const getTrackStatus = async (trackId: string): Promise<TrackStatusResponse> => {
  const response = await axiosInstance.get(`/documents/track_status/${encodeURIComponent(trackId)}`)
  return response.data
}

/**
 * Get documents with pagination support
 * @param request The pagination request parameters
 * @returns Promise with paginated documents response
 */
export const getDocumentsPaginated = async (request: DocumentsRequest): Promise<PaginatedDocsResponse> => {
  const response = await axiosInstance.post('/documents/paginated', request)
  return response.data
}

/**
 * Get counts of documents by status
 * @returns Promise with status counts response
 */
export const getDocumentStatusCounts = async (): Promise<StatusCountsResponse> => {
  const response = await axiosInstance.get('/documents/status_counts')
  return response.data
}

// Prompt Types
export type PromptType = 'text' | 'json'

export type PromptResponse = {
  prompt_key: string
  prompt_value: string | string[]
  prompt_type: PromptType
  description: string | null
  is_active: boolean
  is_default: boolean
}

export type PromptsListResponse = {
  status: 'success'
  data: {
    prompts: PromptResponse[]
    total: number
  }
}

export type SinglePromptResponse = {
  status: 'success'
  data: PromptResponse
}

export type PromptUpdateRequest = {
  prompt_value: string | string[]
  prompt_type: PromptType
  description?: string
}

export type PromptUpdateResponse = {
  status: 'success'
  message: string
  data: PromptResponse
}

export type PromptResetResponse = {
  status: 'success'
  message: string
  data?: PromptResponse
}

// Prompt API methods
/**
 * Get all prompts with their current values
 * @returns Promise with all prompts list
 */
export const getAllPrompts = async (): Promise<PromptsListResponse> => {
  const response = await axiosInstance.get('/prompts')
  return response.data
}

/**
 * Get a specific prompt by key
 * @param promptKey The prompt key to fetch
 * @returns Promise with the prompt data
 */
export const getPrompt = async (promptKey: string): Promise<SinglePromptResponse> => {
  const response = await axiosInstance.get(`/prompts/${encodeURIComponent(promptKey)}`)
  return response.data
}

/**
 * Update a specific prompt
 * @param promptKey The prompt key to update
 * @param request The update request data
 * @returns Promise with the updated prompt
 */
export const updatePrompt = async (
  promptKey: string,
  request: PromptUpdateRequest
): Promise<PromptUpdateResponse> => {
  const response = await axiosInstance.put(`/prompts/${encodeURIComponent(promptKey)}`, request)
  return response.data
}

/**
 * Reset a prompt to its default value
 * @param promptKey The prompt key to reset
 * @returns Promise with the reset result
 */
export const resetPrompt = async (promptKey: string): Promise<PromptResetResponse> => {
  const response = await axiosInstance.delete(`/prompts/${encodeURIComponent(promptKey)}`)
  return response.data
}

/**
 * Reset all prompts to their default values
 * @returns Promise with the reset result
 */
export const resetAllPrompts = async (): Promise<PromptResetResponse> => {
  const response = await axiosInstance.post('/prompts/reset-all')
  return response.data
}

// User Prompt Template Types
export type UserPromptTemplate = {
  template_id: string
  template_name: string
  content: string
  description?: string
  is_favorite: boolean
  create_time?: string
  update_time?: string
}

export type UserPromptTemplateCreateRequest = {
  template_name: string
  content: string
  description?: string
  is_favorite?: boolean
}

export type UserPromptTemplateUpdateRequest = {
  template_name?: string
  content?: string
  description?: string
  is_favorite?: boolean
}

export type UserPromptTemplatesListResponse = {
  status: 'success'
  data: {
    templates: UserPromptTemplate[]
    total: number
  }
}

export type UserPromptTemplateResponse = {
  status: 'success'
  data: UserPromptTemplate
}

export type UserPromptTemplateActionResponse = {
  status: 'success'
  message: string
  data?: UserPromptTemplate
}

// User Prompt Template API methods
/**
 * Get all user prompt templates for the current workspace
 * @returns Promise with all templates list
 */
export const getUserPromptTemplates = async (): Promise<UserPromptTemplatesListResponse> => {
  const response = await axiosInstance.get('/user-prompt-templates')
  return response.data
}

/**
 * Get a specific template by ID
 * @param templateId The template ID to fetch
 * @returns Promise with the template data
 */
export const getUserPromptTemplate = async (templateId: string): Promise<UserPromptTemplateResponse> => {
  const response = await axiosInstance.get(`/user-prompt-templates/${encodeURIComponent(templateId)}`)
  return response.data
}

/**
 * Create a new user prompt template
 * @param request The create request data
 * @returns Promise with the created template
 */
export const createUserPromptTemplate = async (
  request: UserPromptTemplateCreateRequest
): Promise<UserPromptTemplateActionResponse> => {
  const response = await axiosInstance.post('/user-prompt-templates', request)
  return response.data
}

/**
 * Update an existing template
 * @param templateId The template ID to update
 * @param request The update request data
 * @returns Promise with the update result
 */
export const updateUserPromptTemplate = async (
  templateId: string,
  request: UserPromptTemplateUpdateRequest
): Promise<UserPromptTemplateActionResponse> => {
  const response = await axiosInstance.put(`/user-prompt-templates/${encodeURIComponent(templateId)}`, request)
  return response.data
}

/**
 * Delete a template
 * @param templateId The template ID to delete
 * @returns Promise with the delete result
 */
export const deleteUserPromptTemplate = async (templateId: string): Promise<UserPromptTemplateActionResponse> => {
  const response = await axiosInstance.delete(`/user-prompt-templates/${encodeURIComponent(templateId)}`)
  return response.data
}

// Entity Management Types
export type EntityResponse = {
  entity_id: string
  entity_type?: string
  description?: string
  source_id?: string
  file_path?: string
  created_at?: string
  s3_url?: string
  degree: number
}

export type EntitiesRequest = {
  page: number
  page_size: number
  search?: string
  entity_type?: string
  sort_field: string
  sort_direction: 'asc' | 'desc'
}

export type EntitiesPaginatedResponse = {
  entities: EntityResponse[]
  pagination: PaginationInfo
}

export type EntityTypeCount = {
  entity_type: string
  count: number
}

export type EntityTypesResponse = {
  types: EntityTypeCount[]
  total_entities: number
}

export type RelationResponse = {
  source_id: string
  target_id: string
  weight?: number
  keywords?: string
  description?: string
  source_chunk_id?: string
  created_at?: string
}

export type RelationsRequest = {
  page: number
  page_size: number
  search?: string
  sort_field: string
  sort_direction: 'asc' | 'desc'
}

export type RelationsPaginatedResponse = {
  relations: RelationResponse[]
  pagination: PaginationInfo
}

export type DeleteEntityResponse = {
  status: string
  message: string
}

export type DeleteRelationRequest = {
  source_id: string
  target_id: string
}

export type DeleteRelationResponse = {
  status: string
  message: string
}

// Entity Management API methods
/**
 * Get paginated list of entities
 * @param request The pagination and filter request
 * @returns Promise with paginated entities response
 */
export const getEntitiesPaginated = async (request: EntitiesRequest): Promise<EntitiesPaginatedResponse> => {
  const response = await axiosInstance.post('/entities', request)
  return response.data
}

/**
 * Get all entity types with counts
 * @returns Promise with entity types response
 */
export const getEntityTypes = async (): Promise<EntityTypesResponse> => {
  const response = await axiosInstance.get('/entity-types')
  return response.data
}

/**
 * Get paginated list of relations
 * @param request The pagination and search request
 * @returns Promise with paginated relations response
 */
export const getRelationsPaginated = async (request: RelationsRequest): Promise<RelationsPaginatedResponse> => {
  const response = await axiosInstance.post('/relations', request)
  return response.data
}

/**
 * Delete an entity
 * @param entityId The entity ID to delete
 * @returns Promise with delete response
 */
export const deleteEntity = async (entityId: string, cascade: boolean = true): Promise<DeleteEntityResponse> => {
  const response = await axiosInstance.delete(`/entities/${encodeURIComponent(entityId)}?cascade=${cascade}`)
  return response.data
}

/**
 * Get related entities (similar names) for batch deletion
 */
export type RelatedEntityItem = {
  entity_id: string
  entity_type?: string
  description?: string
  degree: number
}

export type RelatedEntitiesResponse = {
  related: RelatedEntityItem[]
  total: number
}

export const getRelatedEntities = async (entityId: string): Promise<RelatedEntitiesResponse> => {
  const response = await axiosInstance.get(`/entities/${encodeURIComponent(entityId)}/related`)
  return response.data
}

/**
 * Batch delete multiple entities
 */
export type BatchDeleteResponse = {
  status: string
  message: string
  deleted: number
  failed: number
}

/**
 * Quick ingest a single image through multimodal processing
 */
export const quickIngestImage = async (
  file: File,
  title: string,
  imagePrompt?: string,
): Promise<{ status: string; message: string; doc_id?: string; entity_name?: string }> => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  if (imagePrompt) formData.append('image_prompt', imagePrompt)
  const response = await axiosInstance.post('/documents/quick-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

// =====================================================
// Document Preview (single-doc deep view for UI dialog)
// =====================================================

export type DocumentPreviewChunk = {
  id: string
  chunk_order_index?: number | null
  tokens?: number | null
  content?: string | null
  structured_content?: Record<string, any> | null
}

export type DocumentRawKind = 'text' | 'image' | 'pdf' | 'binary'

export type DocumentPreview = {
  id: string
  status: string
  file_path?: string | null
  doc_nm?: string | null
  content_summary?: string | null
  content_length?: number | null
  chunks_count?: number | null
  track_id?: string | null
  error_msg?: string | null
  metadata?: Record<string, any> | null
  created_at?: string | null
  updated_at?: string | null
  s3_url?: string | null
  mime_type?: string | null
  raw_kind: DocumentRawKind
  can_preview_inline: boolean
  content?: string | null
  chunks: DocumentPreviewChunk[]
}

export const getDocumentPreview = async (docId: string): Promise<DocumentPreview> => {
  const response = await axiosInstance.get<DocumentPreview>(
    `/documents/${encodeURIComponent(docId)}/preview`
  )
  return response.data
}

export const buildDocumentRawUrl = (
  docId: string,
  opts?: { download?: boolean; workspace?: string; proxy?: boolean }
): string => {
  const params = new URLSearchParams()
  if (opts?.download) params.set('download', 'true')
  if (opts?.proxy) params.set('proxy', 'true')
  const workspace = opts?.workspace ?? useWorkspaceStore.getState().currentWorkspaceId
  if (workspace) params.set('workspace', workspace)
  const query = params.toString()
  const path = `/documents/${encodeURIComponent(docId)}/raw${query ? `?${query}` : ''}`
  return `${backendBaseUrl}${path}`
}

export const batchDeleteEntities = async (entityIds: string[], cascade: boolean = true): Promise<BatchDeleteResponse> => {
  const response = await axiosInstance.post('/entities/batch-delete', { entity_ids: entityIds, cascade })
  return response.data
}

/**
 * Delete a relation between two entities
 * @param request The delete relation request with source and target IDs
 * @returns Promise with delete response
 */
export const deleteRelation = async (request: DeleteRelationRequest, cascade: boolean = true): Promise<DeleteRelationResponse> => {
  const response = await axiosInstance.delete(`/relations?cascade=${cascade}`, { data: request })
  return response.data
}

export type DeletionTargetType = 'document' | 'chunk' | 'entity' | 'relation'
export type DeletionPolicy = 'graph_only' | 'cascade_safe' | 'cascade_full' | 'delete_documents' | 'force_delete_chunks'

export type DeletionRelationSelector = {
  source_id: string
  target_id: string
}

export type DeletionRequest = {
  target_type: DeletionTargetType
  policy?: DeletionPolicy
  ids?: string[]
  relations?: DeletionRelationSelector[]
  delete_file?: boolean
  delete_s3_file?: boolean
  delete_llm_cache?: boolean
  invalidate_cache?: boolean
}

export type DeletionPreviewResponse = {
  status: string
  workspace: string
  target_type: DeletionTargetType
  policy: DeletionPolicy
  executable: boolean
  summary: Record<string, unknown>
  impact: Record<string, unknown>
  warnings: string[]
  missing: string[]
}

export type DeletionExecuteResponse = {
  status: string
  workspace: string
  target_type: DeletionTargetType
  policy: DeletionPolicy
  job_id?: string | null
  preview: DeletionPreviewResponse
  results: Array<Record<string, unknown>>
  warnings: string[]
}

export const previewDeletion = async (request: DeletionRequest): Promise<DeletionPreviewResponse> => {
  const response = await axiosInstance.post('/deletions/preview', request)
  return response.data
}

export const executeDeletion = async (request: DeletionRequest): Promise<DeletionExecuteResponse> => {
  const response = await axiosInstance.post('/deletions/execute', request)
  return response.data
}

export type DeletionJobSummary = {
  job_id: string
  workspace: string
  target_type: DeletionTargetType
  policy: DeletionPolicy
  created_at?: string | null
  restored_at?: string | null
  summary: Record<string, unknown>
  counts: Record<string, number>
}

export type DeletionJobListResponse = {
  jobs: DeletionJobSummary[]
  total_count: number
}

export type DeletionJobDetail = DeletionJobSummary & {
  request: Record<string, unknown>
  preview: Record<string, unknown>
}

export type RestoreRequest = {
  overwrite?: boolean
  invalidate_cache?: boolean
}

export type RestorePreviewResponse = {
  status: string
  workspace: string
  job_id: string
  executable: boolean
  already_restored: boolean
  counts: Record<string, number>
  conflicts: Record<string, number>
  warnings: string[]
}

export type RestoreExecuteResponse = {
  status: string
  workspace: string
  job_id: string
  preview: RestorePreviewResponse
  restored: Record<string, number>
  warnings: string[]
}

export const listDeletionJobs = async (limit: number = 20, offset: number = 0): Promise<DeletionJobListResponse> => {
  const response = await axiosInstance.get('/deletions/jobs', { params: { limit, offset } })
  return response.data
}

export const getDeletionJob = async (jobId: string): Promise<DeletionJobDetail> => {
  const response = await axiosInstance.get(`/deletions/jobs/${encodeURIComponent(jobId)}`)
  return response.data
}

export const previewRestoreDeletionJob = async (
  jobId: string,
  request: RestoreRequest = {}
): Promise<RestorePreviewResponse> => {
  const response = await axiosInstance.post(
    `/deletions/jobs/${encodeURIComponent(jobId)}/restore/preview`,
    request
  )
  return response.data
}

export const executeRestoreDeletionJob = async (
  jobId: string,
  request: RestoreRequest = {}
): Promise<RestoreExecuteResponse> => {
  const response = await axiosInstance.post(
    `/deletions/jobs/${encodeURIComponent(jobId)}/restore/execute`,
    request
  )
  return response.data
}

export type DocumentHistoryOperation = {
  operation_id: string
  operation_type: string
  status: string
  source: string
  target_type: string
  target_id?: string | null
  doc_id?: string | null
  title: string
  summary?: string | null
  created_at?: string | null
  completed_at?: string | null
  can_restore: boolean
  restore_job_id?: string | null
  restored_at?: string | null
  counts: Record<string, number>
  metadata: Record<string, unknown>
}

export type DocumentHistoryResponse = {
  workspace: string
  doc_id: string
  file_path?: string | null
  current_document?: Record<string, unknown> | null
  operations: DocumentHistoryOperation[]
  total_count: number
}

export const getDocumentHistory = async (
  docId: string,
  limit: number = 50
): Promise<DocumentHistoryResponse> => {
  const response = await axiosInstance.get(`/history/documents/${encodeURIComponent(docId)}`, {
    params: { limit }
  })
  return response.data
}

export type ChunkSortField =
  | 'id'
  | 'file_path'
  | 'full_doc_id'
  | 'chunk_order_index'
  | 'tokens'
  | 'create_time'
  | 'update_time'

export type ChunksRequest = {
  page: number
  page_size: number
  doc_id?: string | null
  search?: string | null
  chunk_type?: string | null
  sort_field: ChunkSortField
  sort_direction: 'asc' | 'desc'
}

export type ChunkListItem = {
  chunk_id: string
  doc_id?: string | null
  file_path?: string | null
  chunk_order_index?: number | null
  tokens?: number | null
  content_preview: string
  content_length: number
  chunk_type: string
  has_structured_content: boolean
  entity_count: number
  relation_count: number
  created_at?: number | null
  updated_at?: number | null
}

export type ChunksPaginatedResponse = {
  chunks: ChunkListItem[]
  pagination: PaginationInfo
}

export type ChunkEntityRef = {
  entity_id: string
  entity_type?: string | null
  description?: string | null
  degree: number
}

export type ChunkRelationRef = {
  source_id: string
  target_id: string
  keywords?: string | null
  description?: string | null
  weight?: number | null
}

export type ChunkDocumentRef = {
  doc_id?: string | null
  file_path?: string | null
  status?: string | null
  chunks_count?: number | null
}

export type ChunkDetail = {
  chunk_id: string
  doc_id?: string | null
  file_path?: string | null
  chunk_order_index?: number | null
  tokens?: number | null
  content: string
  content_length: number
  chunk_type: string
  structured_content?: any
  llm_cache_list: string[]
  created_at?: number | null
  updated_at?: number | null
  document?: ChunkDocumentRef | null
  entities: ChunkEntityRef[]
  relations: ChunkRelationRef[]
  deletion_impact: Record<string, any>
}

export type ChunkUpdateRequest = {
  content?: string
  structured_content?: any
  clear_structured_content?: boolean
  invalidate_cache?: boolean
}

export const getChunksPaginated = async (request: ChunksRequest): Promise<ChunksPaginatedResponse> => {
  const response = await axiosInstance.post('/chunks', request)
  return response.data
}

export const getDocumentChunks = async (
  docId: string,
  page: number = 1,
  pageSize: number = 100
): Promise<ChunksPaginatedResponse> => {
  const response = await axiosInstance.get(
    `/chunks/by-document/${encodeURIComponent(docId)}?page=${page}&page_size=${pageSize}`
  )
  return response.data
}

export const getChunkDetail = async (chunkId: string): Promise<ChunkDetail> => {
  const response = await axiosInstance.get(`/chunks/${encodeURIComponent(chunkId)}`)
  return response.data
}

export const updateChunk = async (chunkId: string, request: ChunkUpdateRequest): Promise<ChunkDetail> => {
  const response = await axiosInstance.patch(`/chunks/${encodeURIComponent(chunkId)}`, request)
  return response.data
}

// =====================================================
// Workspace Management Types and API
// =====================================================

export type WorkspaceInfo = {
  workspace_id: string
  name: string
  description?: string
  is_default: boolean
  document_count: number
  entity_count: number
  relation_count: number
  metadata?: Record<string, any>
  create_time?: number
  update_time?: number
  is_busy: boolean
}

export type WorkspaceMode = 'kms' | 'answer_catalog' | 'hybrid'

export const getWorkspaceMode = (workspace?: WorkspaceInfo | null): WorkspaceMode => {
  const mode = workspace?.metadata?.workspace_mode
  if (mode === 'answer_catalog' || mode === 'hybrid' || mode === 'kms') return mode
  return 'kms'
}

export type WorkspaceListResponse = {
  workspaces: WorkspaceInfo[]
  total: number
  page: number
  page_size: number
}

export type WorkspaceCreateRequest = {
  workspace_id: string
  name: string
  description?: string
  metadata?: Record<string, any>
}

export type WorkspaceUpdateRequest = {
  name?: string
  description?: string
  metadata?: Record<string, any>
}

export type WorkspaceStatsResponse = {
  workspace_id: string
  document_count: number
  entity_count: number
  relation_count: number
  is_busy: boolean
  busy_start_time?: number
}

export type CopySettingsRequest = {
  target_workspace_id: string
  include_prompts?: boolean
  include_templates?: boolean
}

export type CopyDataRequest = {
  target_workspace_id: string
  include_documents?: boolean
  include_entities?: boolean
  include_relations?: boolean
  include_vectors?: boolean
}

/**
 * Get paginated list of workspaces
 * @param page Page number (1-based)
 * @param pageSize Number of items per page
 * @param force Bypass the short client-side dedupe cache
 * @returns Promise with paginated workspaces response
 */
const WORKSPACE_LIST_DEDUPE_MS = 1500
let workspaceListPromise: Promise<WorkspaceListResponse> | null = null
let workspaceListCache: { key: string; timestamp: number; data: WorkspaceListResponse } | null = null

export const getWorkspaces = async (
  page: number = 1,
  pageSize: number = 50,
  force: boolean = false
): Promise<WorkspaceListResponse> => {
  const key = `${page}:${pageSize}`
  const now = Date.now()

  if (!force && workspaceListCache?.key === key && now - workspaceListCache.timestamp < WORKSPACE_LIST_DEDUPE_MS) {
    return workspaceListCache.data
  }

  if (!force && workspaceListPromise) {
    return workspaceListPromise
  }

  workspaceListPromise = axiosInstance
    .get('/workspaces', {
      params: { page, page_size: pageSize }
    })
    .then((response) => {
      workspaceListCache = { key, timestamp: Date.now(), data: response.data }
      return response.data
    })
    .finally(() => {
      workspaceListPromise = null
    })

  return workspaceListPromise
}

/**
 * Get workspace by ID
 * @param workspaceId The workspace ID
 * @returns Promise with workspace info
 */
export const getWorkspace = async (workspaceId: string): Promise<WorkspaceInfo> => {
  const response = await axiosInstance.get(`/workspaces/${encodeURIComponent(workspaceId)}`)
  return response.data
}

/**
 * Create a new workspace
 * @param request The workspace creation request
 * @returns Promise with created workspace info
 */
export const createWorkspace = async (request: WorkspaceCreateRequest): Promise<WorkspaceInfo> => {
  const response = await axiosInstance.post('/workspaces', request)
  return response.data
}

/**
 * Update a workspace
 * @param workspaceId The workspace ID to update
 * @param request The workspace update request
 * @returns Promise with updated workspace info
 */
export const updateWorkspace = async (workspaceId: string, request: WorkspaceUpdateRequest): Promise<WorkspaceInfo> => {
  const response = await axiosInstance.patch(`/workspaces/${encodeURIComponent(workspaceId)}`, request)
  return response.data
}

/**
 * Delete a workspace
 * @param workspaceId The workspace ID to delete
 * @param deleteData Whether to delete all data in the workspace
 * @returns Promise with delete response
 */
export const deleteWorkspace = async (workspaceId: string, deleteData: boolean = true): Promise<{ message: string }> => {
  const response = await axiosInstance.delete(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    params: { delete_data: deleteData }
  })
  return response.data
}

/**
 * Get workspace statistics
 * @param workspaceId The workspace ID
 * @returns Promise with workspace stats
 */
export const getWorkspaceStats = async (workspaceId: string): Promise<WorkspaceStatsResponse> => {
  const response = await axiosInstance.get(`/workspaces/${encodeURIComponent(workspaceId)}/stats`)
  return response.data
}

/**
 * Sync workspace statistics with actual data
 * @param workspaceId The workspace ID
 * @returns Promise with sync response
 */
export const syncWorkspaceStats = async (workspaceId: string): Promise<{ message: string }> => {
  const response = await axiosInstance.post(`/workspaces/${encodeURIComponent(workspaceId)}/sync-stats`)
  return response.data
}

/**
 * Set a workspace as default
 * @param workspaceId The workspace ID to set as default
 * @returns Promise with response
 */
export const setDefaultWorkspace = async (workspaceId: string): Promise<{ message: string }> => {
  const response = await axiosInstance.post(`/workspaces/${encodeURIComponent(workspaceId)}/set-default`)
  return response.data
}

/**
 * Get the default workspace
 * @returns Promise with default workspace info
 */
export const getDefaultWorkspace = async (): Promise<WorkspaceInfo> => {
  const response = await axiosInstance.get('/workspaces/default')
  return response.data
}

/**
 * Copy settings from one workspace to another
 * @param sourceWorkspaceId The source workspace ID
 * @param request The copy settings request
 * @returns Promise with copy response
 */
export const copyWorkspaceSettings = async (
  sourceWorkspaceId: string,
  request: CopySettingsRequest
): Promise<{ message: string; copied_items: string[] }> => {
  const response = await axiosInstance.post(
    `/workspaces/${encodeURIComponent(sourceWorkspaceId)}/copy-settings`,
    request
  )
  return response.data
}

/**
 * Copy data from one workspace to another
 * @param sourceWorkspaceId The source workspace ID
 * @param request The copy data request
 * @returns Promise with copy response
 */
export const copyWorkspaceData = async (
  sourceWorkspaceId: string,
  request: CopyDataRequest
): Promise<{ message: string; copied_tables: string[] }> => {
  const response = await axiosInstance.post(
    `/workspaces/${encodeURIComponent(sourceWorkspaceId)}/copy-data`,
    request
  )
  return response.data
}

/**
 * Move data from one workspace to another (copy then delete source)
 * @param sourceWorkspaceId The source workspace ID
 * @param request The move data request (same as copy)
 * @returns Promise with move response
 */
export const moveWorkspaceData = async (
  sourceWorkspaceId: string,
  request: CopyDataRequest
): Promise<{ message: string; moved_tables: string[]; deleted_from_source: string[] }> => {
  const response = await axiosInstance.post(
    `/workspaces/${encodeURIComponent(sourceWorkspaceId)}/move-data`,
    request
  )
  return response.data
}

// =====================================================
// Answer Catalog Types and API
// =====================================================

export type AnswerStatus = 'draft' | 'published' | 'archived' | 'expired'
export type AnswerDisplayPolicy = 'summary' | 'full' | 'both'
export type AnswerContentFormat = 'plain' | 'markdown' | 'html'
export type AnswerGuidanceType = 'keyword' | 'question' | 'synonym' | 'negative_keyword' | 'note'

export type AnswerItem = {
  answer_id: string
  workspace: string
  title: string
  body: string
  approved_summary?: string | null
  content_format: AnswerContentFormat
  display_policy: AnswerDisplayPolicy
  status: AnswerStatus
  version: number
  valid_from?: string | null
  valid_until?: string | null
  priority: number
  tags: string[]
  metadata: Record<string, any>
  publish_time?: string | null
  create_time?: string | null
  update_time?: string | null
}

export type AnswerGuidance = {
  guidance_id: string
  answer_id: string
  workspace: string
  guidance_type: AnswerGuidanceType
  text: string
  weight: number
  metadata: Record<string, any>
  create_time?: string | null
}

export type AnswerRevision = {
  revision_id: string
  answer_id: string
  workspace: string
  version: number
  snapshot: Record<string, any>
  created_at?: string | null
}

export type AnswerEvent = {
  event_id: string
  workspace: string
  event_type: string
  query?: string | null
  selected_answer_id?: string | null
  candidate_ids: string[]
  scores: Record<string, number>
  metadata: Record<string, any>
  create_time?: string | null
}

export type AnswerStructuredDataset = {
  answer_id: string
  title: string
  status: AnswerStatus
  source_type: string
  source_uri?: string | null
  kind: string
  columns: string[]
  row_count: number
  sample_rows: Record<string, any>[]
  metadata: Record<string, any>
}

export type AnswerStructuredFilter = {
  field: string
  operator: 'contains' | 'equals' | 'starts_with' | 'ends_with'
  value: string
}

export type AnswerStructuredQueryRequest = {
  answer_id: string
  filters?: AnswerStructuredFilter[]
  limit?: number
  preview_only?: boolean
}

export type AnswerStructuredQueryResponse = {
  answer_id: string
  title: string
  pseudo_sql: string
  columns: string[]
  rows: Record<string, any>[]
  row_count: number
  preview_only: boolean
}

export type AnswerListResponse = {
  answers: AnswerItem[]
  total: number
  page: number
  page_size: number
}

export type AnswerCreateRequest = {
  answer_id?: string
  title: string
  body: string
  approved_summary?: string | null
  content_format?: AnswerContentFormat
  display_policy?: AnswerDisplayPolicy
  status?: AnswerStatus
  valid_from?: string | null
  valid_until?: string | null
  priority?: number
  tags?: string[]
  metadata?: Record<string, any>
  guidance?: string[]
}

export type AnswerUpdateRequest = Partial<Omit<AnswerCreateRequest, 'answer_id' | 'guidance'>>

export type AnswerResolveRequest = {
  query: string
  top_k?: number
  min_score?: number
  include_drafts?: boolean
  strategy?: 'fast' | 'balanced'
}

export type AnswerResolveCandidate = {
  answer: AnswerItem
  score: number
  matched_guidance: string[]
  reason: string
  score_details?: Record<string, number>
}

export type AnswerResolveResponse = {
  selected_answer?: AnswerItem | null
  confidence: number
  candidates: AnswerResolveCandidate[]
  trace_id: string
  rationale: string
}

export const listAnswers = async (params?: {
  status?: string
  search?: string
  page?: number
  page_size?: number
}): Promise<AnswerListResponse> => {
  const response = await axiosInstance.get('/api/answers', { params })
  return response.data
}

export const createAnswer = async (request: AnswerCreateRequest): Promise<AnswerItem> => {
  const response = await axiosInstance.post('/api/answers', request)
  return response.data
}

export const getAnswer = async (answerId: string): Promise<AnswerItem> => {
  const response = await axiosInstance.get(`/api/answers/${encodeURIComponent(answerId)}`)
  return response.data
}

export const updateAnswer = async (answerId: string, request: AnswerUpdateRequest): Promise<AnswerItem> => {
  const response = await axiosInstance.patch(`/api/answers/${encodeURIComponent(answerId)}`, request)
  return response.data
}

export const publishAnswer = async (answerId: string): Promise<AnswerItem> => {
  const response = await axiosInstance.post(`/api/answers/${encodeURIComponent(answerId)}/publish`)
  return response.data
}

export const archiveAnswer = async (answerId: string): Promise<AnswerItem> => {
  const response = await axiosInstance.post(`/api/answers/${encodeURIComponent(answerId)}/archive`)
  return response.data
}

export const listAnswerGuidance = async (answerId: string): Promise<AnswerGuidance[]> => {
  const response = await axiosInstance.get(`/api/answers/${encodeURIComponent(answerId)}/guidance`)
  return response.data
}

export const addAnswerGuidance = async (
  answerId: string,
  request: { guidance_type?: AnswerGuidanceType; text: string; weight?: number; metadata?: Record<string, any> }
): Promise<AnswerGuidance> => {
  const response = await axiosInstance.post(`/api/answers/${encodeURIComponent(answerId)}/guidance`, request)
  return response.data
}

export const deleteAnswerGuidance = async (answerId: string, guidanceId: string): Promise<{ message: string }> => {
  const response = await axiosInstance.delete(`/api/answers/${encodeURIComponent(answerId)}/guidance/${encodeURIComponent(guidanceId)}`)
  return response.data
}

export const listAnswerRevisions = async (answerId: string): Promise<AnswerRevision[]> => {
  const response = await axiosInstance.get(`/api/answers/${encodeURIComponent(answerId)}/revisions`)
  return response.data
}

export const restoreAnswerRevision = async (answerId: string, revisionId: string): Promise<AnswerItem> => {
  const response = await axiosInstance.post(
    `/api/answers/${encodeURIComponent(answerId)}/revisions/${encodeURIComponent(revisionId)}/restore`
  )
  return response.data
}

export const resolveAnswer = async (request: AnswerResolveRequest): Promise<AnswerResolveResponse> => {
  const response = await axiosInstance.post('/api/answers/resolve', request)
  return response.data
}

export const listAnswerEvents = async (params?: {
  event_type?: string
  selected_answer_id?: string
  limit?: number
}): Promise<AnswerEvent[]> => {
  const response = await axiosInstance.get('/api/answers/events', { params })
  return response.data
}

export const listAnswerStructuredDatasets = async (params?: {
  structured_only?: boolean
  status?: string
}): Promise<AnswerStructuredDataset[]> => {
  const response = await axiosInstance.get('/api/answers/structured/datasets', { params })
  return response.data
}

export const queryAnswerStructuredDataset = async (
  request: AnswerStructuredQueryRequest
): Promise<AnswerStructuredQueryResponse> => {
  const response = await axiosInstance.post('/api/answers/structured/query', request)
  return response.data
}

export type AnswerStatsResponse = {
  workspace: string
  answers: Record<string, number>
  events: Record<string, number>
}

export const getAnswerStats = async (workspaceId?: string): Promise<AnswerStatsResponse> => {
  const response = await axiosInstance.get('/api/answers/stats/summary', {
    headers: workspaceId ? { 'LIGHTRAG-WORKSPACE': encodeWorkspaceHeader(workspaceId) } : undefined,
  })
  return response.data
}

// =====================================================
// URL Knowledge Ingestion Types and API
// =====================================================

export type URLValidateResponse = {
  valid: boolean
  normalized_url: string
  domain: string
  doc_id: string
}

export type URLIngestRequest = {
  url: string
  file_path_label?: string
  process_images?: boolean
  process_tables?: boolean
  skip_duplicates?: boolean
  force_reindex?: boolean
  follow_links?: boolean
  max_depth?: number
  document_prompt?: string
  image_prompt?: string
  table_prompt?: string
}

export type URLIngestResponse = {
  task_id: string
  stream_url: string
  message: string
}

export type URLBatchIngestRequest = {
  urls: string[]
  process_images?: boolean
  process_tables?: boolean
  skip_duplicates?: boolean
  force_reindex?: boolean
  follow_links?: boolean
  max_depth?: number
  document_prompt?: string
  image_prompt?: string
  table_prompt?: string
}

export type URLBatchTaskInfo = {
  task_id: string
  stream_url: string
  url: string
  message: string
}

export type URLBatchSkippedInfo = {
  url: string
  reason: string
}

export type URLBatchIngestResponse = {
  tasks: URLBatchTaskInfo[]
  skipped: URLBatchSkippedInfo[]
  total_submitted: number
  total_skipped: number
}

export const validateUrl = async (url: string): Promise<URLValidateResponse> => {
  const response = await axiosInstance.post('/api/url/validate', { url })
  return response.data
}

export const ingestUrl = async (request: URLIngestRequest): Promise<URLIngestResponse> => {
  const response = await axiosInstance.post('/api/url/ingest', request)
  return response.data
}

export const ingestUrlBatch = async (request: URLBatchIngestRequest): Promise<URLBatchIngestResponse> => {
  const response = await axiosInstance.post('/api/url/ingest-batch', request)
  return response.data
}

// =====================================================
// Board API Ingestion Types and API
// =====================================================

export type BoardFieldMapping = {
  items_path: string
  title_field: string
  body_field: string
  id_field?: string
  date_field?: string
  author_field?: string
  attachments_field?: string
  attachment_url_field?: string
  attachment_name_field?: string
  detail_url_template?: string
  pagination_type?: 'page_param' | 'offset_limit' | 'cursor' | 'none'
  page_param?: string
  page_size_param?: string
  total_field?: string
  cursor_field?: string
}

export type BoardExploreRequest = {
  api_url: string
  method?: string
  headers?: Record<string, string>
  params?: Record<string, string>
  body?: Record<string, any>
  base_url?: string
  user_mapping?: BoardFieldMapping
}

export type BoardExploreResponse = {
  success: boolean
  sample_data?: Record<string, any>
  detected_mapping?: BoardFieldMapping
  detected_items_count: number
  sample_item?: Record<string, any>
  alternative_mappings?: BoardFieldMapping[]
  detection_method?: 'llm' | 'heuristic' | 'manual'
  llm_confidence?: 'high' | 'medium' | 'low'
  llm_notes?: string
  error?: string
}

export type BoardIngestRequest = {
  api_url: string
  method?: string
  headers?: Record<string, string>
  params?: Record<string, string>
  body?: Record<string, any>
  field_mapping: BoardFieldMapping
  max_pages?: number
  page_size?: number
  process_images?: boolean
  process_tables?: boolean
  process_documents?: boolean
  parser?: 'pymupdf' | 'docling'
  skip_duplicates?: boolean
  update_existing?: boolean
  fetch_detail?: boolean
  base_url?: string
  document_prompt?: string
  image_prompt?: string
  table_prompt?: string
}

export type BoardIngestResponse = {
  task_id: string
  stream_url: string
  message: string
}

export const exploreBoard = async (req: BoardExploreRequest): Promise<BoardExploreResponse> => {
  const response = await axiosInstance.post('/api/board/explore', req)
  return response.data
}

export const ingestBoard = async (req: BoardIngestRequest): Promise<BoardIngestResponse> => {
  const response = await axiosInstance.post('/api/board/ingest', req)
  return response.data
}

export type BoardViewResponse = {
  success: boolean
  title: string
  body: string
  date: string
  author: string
  attachments: any[]
  raw_data: Record<string, any>
  error: string
}

export const viewBoardPost = async (filePath: string): Promise<BoardViewResponse> => {
  const response = await axiosInstance.post('/api/board/view', { file_path: filePath })
  return response.data
}

// =====================================================
// Async Task Types and API
// =====================================================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type TaskProgressEvent = {
  task_id: string
  status: TaskStatus
  progress: number
  message: string
  detail?: Record<string, any>
  timestamp: number
}

export type TaskStatusResponse = {
  task_id: string
  task_type: string
  workspace: string
  status: TaskStatus
  progress: number
  message: string
  created_at: number
  updated_at: number
  result?: Record<string, any>
  error?: string
  metadata: Record<string, any>
}

export type TaskCancelResponse = {
  task_id: string
  status: string
  message: string
}

export const getTaskStatus = async (taskId: string): Promise<TaskStatusResponse> => {
  const response = await axiosInstance.get(`/api/tasks/${encodeURIComponent(taskId)}`)
  return response.data
}

export const cancelTask = async (taskId: string): Promise<TaskCancelResponse> => {
  const response = await axiosInstance.post(`/api/tasks/${encodeURIComponent(taskId)}/cancel`)
  return response.data
}

export const listTasks = async (): Promise<TaskStatusResponse[]> => {
  const response = await axiosInstance.get('/api/tasks')
  return response.data.tasks || []
}

/**
 * Stream task progress events via NDJSON.
 * Uses native fetch (not axios) for streaming support.
 */
export const streamTaskProgress = (
  taskId: string,
  onEvent: (event: TaskProgressEvent) => void,
  onError?: (error: string) => void
): AbortController => {
  const controller = new AbortController()
  const apiKey = useSettingsStore.getState().apiKey
  const token = localStorage.getItem('LIGHTRAG-API-TOKEN')
  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId

  const headers: HeadersInit = {
    'Accept': 'application/x-ndjson',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (apiKey) headers['X-API-Key'] = apiKey
  const workspaceHeader = encodeWorkspaceHeader(workspaceId)
  if (workspaceHeader) headers['LIGHTRAG-WORKSPACE'] = workspaceHeader

  const run = async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })

      if (!response.ok) {
        if (response.status === 401) {
          navigationService.navigateToLogin()
          onError?.('Authentication required')
          return
        }
        const body = await response.text().catch(() => 'Unknown error')
        onError?.(`${response.status} ${response.statusText}: ${body}`)
        return
      }

      if (!response.body) {
        onError?.('Response body is null')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line)
            // Skip heartbeat events (server sends {"heartbeat": true, "task_id": "..."})
            if (parsed.heartbeat || !parsed.status) continue
            const event: TaskProgressEvent = parsed
            onEvent(event)
            // Stop streaming on terminal status
            if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
              controller.abort()
              return
            }
          } catch {
            // ignore parse errors for partial lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer)
          if (!parsed.heartbeat && parsed.status) onEvent(parsed as TaskProgressEvent)
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const msg = errorMessage(err)
      onError?.(msg)
    }
  }

  run()
  return controller
}

// =====================================================
// Multimodal Processing Types and API
// =====================================================

export type MultimodalProcessResponse = {
  task_id: string
  stream_url: string
  message: string
}

/**
 * Upload a file for multimodal processing.
 * Uses FormData with axios for upload progress tracking.
 */
export const processMultimodal = async (
  file: File,
  options: {
    parser?: string
    process_images?: boolean
    process_tables?: boolean
    process_equations?: boolean
    file_path_label?: string
    pdf_password?: string
    document_prompt?: string
    image_prompt?: string
    table_prompt?: string
  },
  onUploadProgress?: (percentCompleted: number) => void
): Promise<MultimodalProcessResponse> => {
  const formData = new FormData()
  formData.append('file', file)
  if (options.parser) formData.append('parser', options.parser)
  if (options.process_images !== undefined) formData.append('process_images', String(options.process_images))
  if (options.process_tables !== undefined) formData.append('process_tables', String(options.process_tables))
  if (options.process_equations !== undefined) formData.append('process_equations', String(options.process_equations))
  if (options.file_path_label) formData.append('file_path_label', options.file_path_label)
  if (options.pdf_password) formData.append('pdf_password', options.pdf_password)
  if (options.document_prompt) formData.append('document_prompt', options.document_prompt)
  if (options.image_prompt) formData.append('image_prompt', options.image_prompt)
  if (options.table_prompt) formData.append('table_prompt', options.table_prompt)

  const response = await axiosInstance.post('/api/multimodal/process', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onUploadProgress
      ? (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total!)
          onUploadProgress(percentCompleted)
        }
      : undefined,
  })
  return response.data
}
