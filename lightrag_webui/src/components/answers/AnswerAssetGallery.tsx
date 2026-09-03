import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileSpreadsheetIcon,
  HeadphonesIcon,
  ImageIcon,
  VideoIcon,
} from 'lucide-react'

import { AnswerAsset, getAnswerAssetContent } from '@/api/lightrag'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

type AnswerAssetGalleryProps = {
  assets: AnswerAsset[]
  className?: string
}

const formatFileSize = (value: number) => {
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const AssetIcon = ({ type }: { type: AnswerAsset['asset_type'] }) => {
  if (type === 'image') return <ImageIcon className="h-4 w-4" />
  if (type === 'video') return <VideoIcon className="h-4 w-4" />
  if (type === 'audio') return <HeadphonesIcon className="h-4 w-4" />
  if (type === 'table') return <FileSpreadsheetIcon className="h-4 w-4" />
  return <FileIcon className="h-4 w-4" />
}

function AssetPreview({ asset }: { asset: AnswerAsset }) {
  const { t } = useTranslation()
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const directUrl =
    asset.storage_type === 'external' || asset.storage_type === 's3'
      ? asset.content_url || asset.storage_uri || null
      : null
  const mediaUrl = directUrl || objectUrl

  useEffect(() => {
    let active = true
    let nextObjectUrl: string | null = null
    setFailed(false)
    setObjectUrl(null)
    if (directUrl || asset.storage_type === 'inline') return undefined
    getAnswerAssetContent(asset)
      .then((blob) => {
        if (!active) return
        nextObjectUrl = URL.createObjectURL(blob)
        setObjectUrl(nextObjectUrl)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    }
  }, [asset, directUrl])

  if (asset.asset_type === 'table' && asset.content_text) {
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-3 text-xs leading-5">
        {asset.content_text}
      </pre>
    )
  }

  if (failed) {
    return (
      <div className="flex min-h-24 items-center justify-center px-4 text-sm text-muted-foreground">
        {t('answerCatalog.assets.unavailable', 'The attachment could not be loaded.')}
      </div>
    )
  }

  if (asset.asset_type === 'image') {
    return mediaUrl ? (
      <div className="flex min-h-40 items-center justify-center bg-muted/20 p-2">
        <img
          src={mediaUrl}
          alt={asset.alt_text || asset.caption || asset.file_name || ''}
          className="max-h-80 max-w-full object-contain"
        />
      </div>
    ) : null
  }
  if (asset.asset_type === 'video') {
    return mediaUrl ? (
      <video controls preload="metadata" className="max-h-80 w-full bg-black">
        <source src={mediaUrl} type={asset.mime_type || undefined} />
      </video>
    ) : null
  }
  if (asset.asset_type === 'audio') {
    return mediaUrl ? (
      <div className="bg-muted/20 p-3">
        <audio controls preload="metadata" className="w-full">
          <source src={mediaUrl} type={asset.mime_type || undefined} />
        </audio>
      </div>
    ) : null
  }

  return (
    <div className="flex min-h-24 items-center justify-center gap-2 bg-muted/20 p-4 text-sm text-muted-foreground">
      <AssetIcon type={asset.asset_type} />
      <span className="break-all">{asset.file_name || asset.caption || asset.asset_id}</span>
    </div>
  )
}

export default function AnswerAssetGallery({ assets, className }: AnswerAssetGalleryProps) {
  const { t } = useTranslation()
  const activeAssets = assets.filter((asset) => asset.is_active)
  if (activeAssets.length === 0) return null

  return (
    <div className={cn('grid gap-3 md:grid-cols-2', className)}>
      {activeAssets.map((asset) => {
        const directUrl =
          asset.storage_type === 'external' || asset.storage_type === 's3'
            ? asset.content_url || asset.storage_uri
            : asset.content_url
        return (
          <article key={asset.asset_id} className="overflow-hidden rounded-md border bg-background">
            <AssetPreview asset={asset} />
            <div className="flex items-start justify-between gap-3 border-t px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AssetIcon type={asset.asset_type} />
                  <span className="truncate">
                    {asset.caption || asset.file_name || t('answerCatalog.assets.attachment', 'Attachment')}
                  </span>
                </div>
                {asset.alt_text && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {asset.alt_text}
                  </p>
                )}
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {[asset.mime_type, formatFileSize(asset.file_size)].filter(Boolean).join(' · ')}
                </div>
              </div>
              {directUrl && (
                <Button asChild type="button" size="icon" variant="ghost" title={t('answerCatalog.assets.open', 'Open attachment')}>
                  <a href={directUrl} target="_blank" rel="noreferrer" download={asset.storage_type === 'local' ? asset.file_name || undefined : undefined}>
                    {asset.storage_type === 'external' ? (
                      <ExternalLinkIcon className="h-4 w-4" />
                    ) : (
                      <DownloadIcon className="h-4 w-4" />
                    )}
                  </a>
                </Button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
