import { useState, useEffect, useRef } from 'react'
import { useTabVisibility } from '@/contexts/useTabVisibility'
import { backendBaseUrl } from '@/lib/constants'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace'

export default function ApiSite() {
  const { t } = useTranslation()
  const { isTabVisible } = useTabVisibility()
  const isApiTabVisible = isTabVisible('api')
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()

  const [docsUrl] = useState(() => {
    const ws = useWorkspaceStore.getState().currentWorkspaceId
    return backendBaseUrl + '/docs' + (ws ? '?workspace=' + encodeURIComponent(ws) : '')
  })

  useEffect(() => {
    if (isApiTabVisible && !iframeLoaded) setIframeLoaded(true)
  }, [iframeLoaded, isApiTabVisible])

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'LIGHTRAG_WORKSPACE_CHANGE', workspace: currentWorkspaceId },
      '*'
    )
  }, [currentWorkspaceId])

  return (
    <div className={`size-full ${isApiTabVisible ? '' : 'hidden'}`}>
      {isApiTabVisible && iframeLoaded ? (
        <iframe
          ref={iframeRef}
          src={docsUrl}
          className="size-full w-full h-full"
          style={{ width: '100%', height: '100%', border: 'none' }}
          key="api-docs-iframe"
        />
      ) : isApiTabVisible ? (
        <div className="flex h-full w-full items-center justify-center bg-background">
          <div className="text-center">
            <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p>{t('apiSite.loading')}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
