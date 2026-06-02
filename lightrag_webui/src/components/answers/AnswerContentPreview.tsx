import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'

import type { AnswerContentFormat } from '@/api/lightrag'
import { cn } from '@/lib/utils'

type AnswerContentPreviewProps = {
  content: string
  format: AnswerContentFormat
  className?: string
}

const htmlPreviewDocument = (content: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        padding: 12px;
        color: #0f172a;
        background: #ffffff;
        font-size: 14px;
        line-height: 1.6;
        overflow-wrap: anywhere;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        border: 1px solid #e2e8f0;
        padding: 6px 8px;
      }
      img,
      video {
        max-width: 100%;
        height: auto;
      }
      @media (prefers-color-scheme: dark) {
        body {
          color: #e2e8f0;
          background: #020617;
        }
        th,
        td {
          border-color: #334155;
        }
      }
    </style>
  </head>
  <body>${content}</body>
</html>`

export default function AnswerContentPreview({ content, format, className }: AnswerContentPreviewProps) {
  const { t } = useTranslation()
  const label = t(`answerCatalog.sources.types.${format}`, format)

  return (
    <div className={cn('rounded-md border bg-background', className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t('answerCatalog.library.renderedPreview', 'Rendered Preview')}
        </div>
        <div className="rounded border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
          {label}
        </div>
      </div>
      {format === 'markdown' ? (
        <div className="prose prose-sm max-w-none break-words p-3 dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '-'}</ReactMarkdown>
        </div>
      ) : format === 'html' ? (
        <iframe
          title={t('answerCatalog.library.htmlPreviewTitle', 'HTML answer preview')}
          sandbox=""
          srcDoc={htmlPreviewDocument(content || '')}
          className="h-64 w-full bg-background"
        />
      ) : (
        <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-sm leading-6">
          {content || '-'}
        </div>
      )}
    </div>
  )
}
