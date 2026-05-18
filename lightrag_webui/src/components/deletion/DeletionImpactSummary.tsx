import { useTranslation } from 'react-i18next'
import { AlertTriangleIcon, FileTextIcon, GitBranchIcon, NetworkIcon, PuzzleIcon } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import type { DeletionPreviewResponse } from '@/api/lightrag'

type ImpactRecord = Record<string, unknown>

const asArray = (value: unknown): ImpactRecord[] => {
  return Array.isArray(value) ? value.filter((item): item is ImpactRecord => !!item && typeof item === 'object') : []
}

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.map(String) : []
}

const humanizeKey = (key: string) => {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const formatKey = (key: string, t: ReturnType<typeof useTranslation>['t']) => {
  return t(`deletionImpact.summary.${key}`, { defaultValue: humanizeKey(key) })
}

const formatValue = (value: unknown, t: ReturnType<typeof useTranslation>['t']) => {
  if (typeof value === 'boolean') return value ? t('common.yes', 'Yes') : t('common.no', 'No')
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

const translateWarning = (warning: string, t: ReturnType<typeof useTranslation>['t']) => {
  if (warning === 'cascade_safe deletes graph/vector/chunk mappings, but shared source chunks remain unless orphaned.') {
    return t('deletionImpact.warnings.cascadeSafeSharedChunks')
  }
  if (warning === 'cascade_full deletes source chunks that support the target and may update or delete other entities and relations derived from those chunks.') {
    return t('deletionImpact.warnings.cascadeFullDeletesChunks')
  }
  if (warning === 'force_delete_chunks removes chunk text/vector data and updates graph references; original full document text is not rewritten.') {
    return t('deletionImpact.warnings.forceDeleteChunks')
  }
  if (warning === 'force_delete_chunks removes chunk text/vector data, updates graph references, and removes document tracking when no chunks remain.') {
    return t('deletionImpact.warnings.forceDeleteChunksWithTracking')
  }
  if (warning === 'document targets should normally use policy=delete_documents.') {
    return t('deletionImpact.warnings.documentPolicy')
  }

  const zeroChunkDocument = warning.match(/^document '(.+)' may remain with zero chunks after chunk deletion\.$/)
  if (zeroChunkDocument) {
    return t('deletionImpact.warnings.documentMayRemainZeroChunks', { docId: zeroChunkDocument[1] })
  }

  const zeroChunkDocumentRemoved = warning.match(/^document '(.+)' will be removed from document status because all chunks are selected\.$/)
  if (zeroChunkDocumentRemoved) {
    return t('deletionImpact.warnings.documentWillBeRemovedZeroChunks', { docId: zeroChunkDocumentRemoved[1] })
  }

  const notExecutablePolicy = warning.match(/^policy '(.+)' is not executable for target_type '(.+)'\.$/)
  if (notExecutablePolicy) {
    return t('deletionImpact.warnings.policyNotExecutable', {
      policy: notExecutablePolicy[1],
      targetType: notExecutablePolicy[2],
    })
  }

  return warning
}

const getImpactItems = (preview: DeletionPreviewResponse, t: ReturnType<typeof useTranslation>['t']) => {
  const impact = preview.impact as ImpactRecord

  if (preview.target_type === 'document') {
    return asArray(impact.documents).map((doc) => ({
      icon: FileTextIcon,
      title: String(doc.file_path || doc.doc_id || '-'),
      meta: [
        `${t('deletionImpact.meta.doc')}: ${doc.doc_id || '-'}`,
        `${t('deletionImpact.meta.chunks')}: ${Array.isArray(doc.chunks) ? doc.chunks.length : doc.chunks_count || 0}`,
      ],
    }))
  }

  if (preview.target_type === 'chunk') {
    return asArray(impact.chunks).map((chunk) => ({
      icon: PuzzleIcon,
      title: String(chunk.chunk_id || '-'),
      meta: [
        `${t('deletionImpact.meta.doc')}: ${chunk.doc_id || '-'}`,
        `${t('deletionImpact.meta.contentLength')}: ${chunk.content_length || 0}`,
      ],
    }))
  }

  if (preview.target_type === 'entity') {
    return asArray(impact.entities).map((entity) => ({
      icon: NetworkIcon,
      title: String(entity.entity_id || '-'),
      meta: [
        `${t('deletionImpact.meta.type')}: ${entity.entity_type || '-'}`,
        `${t('deletionImpact.meta.relations')}: ${asArray(entity.relations).length}`,
        `${t('deletionImpact.meta.orphanChunks')}: ${asStringArray(entity.orphan_chunks).length}`,
        `${t('deletionImpact.meta.sharedChunks')}: ${asStringArray(entity.shared_chunks).length}`,
      ],
    }))
  }

  return asArray(impact.relations).map((relation) => ({
    icon: GitBranchIcon,
    title: `${relation.source_id || '-'} -> ${relation.target_id || '-'}`,
    meta: [
      `${t('deletionImpact.meta.relationChunks')}: ${asStringArray(relation.relation_chunks).length}`,
      `${t('deletionImpact.meta.orphanChunks')}: ${asStringArray(relation.orphan_chunks).length}`,
      `${t('deletionImpact.meta.sharedChunks')}: ${asStringArray(relation.shared_chunks).length}`,
    ],
  }))
}

export default function DeletionImpactSummary({ preview }: { preview: DeletionPreviewResponse }) {
  const { t } = useTranslation()
  const summaryEntries = Object.entries(preview.summary || {})
  const items = getImpactItems(preview, t)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {summaryEntries.map(([key, value]) => (
          <div key={key} className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-[11px] uppercase text-muted-foreground">{formatKey(key, t)}</div>
            <div className="mt-1 text-base font-semibold">{formatValue(value, t)}</div>
          </div>
        ))}
      </div>

      {preview.warnings.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-1">
              {preview.warnings.map((warning) => (
                <li key={warning}>{translateWarning(warning, t)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {preview.missing.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-medium">{t('deletionImpact.missingTargets')}</div>
          <div className="mt-1 break-all">{preview.missing.join(', ')}</div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{t('deletionImpact.affectedTargets')}</div>
          <Badge variant={preview.executable ? 'secondary' : 'destructive'}>
            {preview.executable ? t('deletionImpact.executable') : t('deletionImpact.previewOnly')}
          </Badge>
        </div>
        <div className="max-h-56 overflow-auto rounded-md border">
          {items.length > 0 ? (
            items.map((item, index) => {
              const Icon = item.icon
              return (
                <div key={`${item.title}-${index}`} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={item.title}>{item.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {item.meta.map((meta) => (
                        <span key={meta} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {meta}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('deletionImpact.noAffectedTargets')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
