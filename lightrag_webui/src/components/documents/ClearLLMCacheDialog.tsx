import { useState, useCallback } from 'react'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/Dialog'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import { clearCache } from '@/api/lightrag'
import { DatabaseIcon, Loader2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ClearLLMCacheDialogProps {
  onCacheCleared?: () => Promise<void>
}

export default function ClearLLMCacheDialog({ onCacheCleared }: ClearLLMCacheDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const handleClear = useCallback(async () => {
    if (isClearing) return
    setIsClearing(true)
    try {
      const result = await clearCache()
      if (result.status === 'success') {
        toast.success(t('documentPanel.clearLLMCache.success'))
        if (onCacheCleared) await onCacheCleared()
        setOpen(false)
      } else {
        toast.error(t('documentPanel.clearLLMCache.error', { error: result.message }))
      }
    } catch (err) {
      toast.error(t('documentPanel.clearLLMCache.error', { error: errorMessage(err) }))
    } finally {
      setIsClearing(false)
    }
  }, [isClearing, t, onCacheCleared])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" side="bottom" tooltip={t('documentPanel.clearLLMCache.tooltip')} size="sm">
          <DatabaseIcon className="h-4 w-4" /> {t('documentPanel.clearLLMCache.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('documentPanel.clearLLMCache.title')}</DialogTitle>
          <DialogDescription className="pt-2">
            {t('documentPanel.clearLLMCache.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isClearing}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={handleClear} disabled={isClearing}>
            {isClearing ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                {t('documentPanel.clearLLMCache.clearing')}
              </>
            ) : (
              t('documentPanel.clearLLMCache.confirmButton')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
