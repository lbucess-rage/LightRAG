import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import ChunkManager from '@/components/documents/ChunkManager'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'

export default function ChunkManagement() {
  const { t } = useTranslation()
  const chunkDocumentFilter = useSettingsStore.use.chunkDocumentFilter()
  const setChunkDocumentFilter = useSettingsStore.use.setChunkDocumentFilter()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()

  useEffect(() => {
    setChunkDocumentFilter(null)
  }, [currentWorkspaceId, setChunkDocumentFilter])

  return (
    <Card className="!rounded-none !overflow-hidden flex h-full min-h-0 flex-col">
      <CardHeader className="px-6 py-2">
        <CardTitle className="text-lg">{t('chunkPanel.title')}</CardTitle>
        <CardDescription>{t('chunkPanel.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChunkManager
          docId={chunkDocumentFilter}
          onDocFilterChange={setChunkDocumentFilter}
        />
      </CardContent>
    </Card>
  )
}
