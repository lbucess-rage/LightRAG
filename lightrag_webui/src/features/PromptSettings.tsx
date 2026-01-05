import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCwIcon, RotateCcwIcon, SaveIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'
import {
  getAllPrompts,
  updatePrompt,
  resetPrompt,
  resetAllPrompts,
  PromptResponse,
  PromptUpdateRequest
} from '@/api/lightrag'
import { errorMessage } from '@/lib/utils'

type PromptItemProps = {
  prompt: PromptResponse
  onSave: (key: string, request: PromptUpdateRequest) => Promise<void>
  onReset: (key: string) => Promise<void>
  saving: boolean
}

function PromptItem({ prompt, onSave, onReset, saving }: PromptItemProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  // Initialize edit value when prompt changes
  useEffect(() => {
    const value = prompt.prompt_type === 'json'
      ? JSON.stringify(prompt.prompt_value, null, 2)
      : String(prompt.prompt_value)
    setEditValue(value)
    setIsDirty(false)
  }, [prompt])

  const handleChange = (value: string) => {
    setEditValue(value)
    const originalValue = prompt.prompt_type === 'json'
      ? JSON.stringify(prompt.prompt_value, null, 2)
      : String(prompt.prompt_value)
    setIsDirty(value !== originalValue)
  }

  const handleSave = async () => {
    let valueToSave: string | string[] = editValue
    if (prompt.prompt_type === 'json') {
      try {
        valueToSave = JSON.parse(editValue)
      } catch {
        alert(t('promptSettings.invalidJson', 'Invalid JSON format'))
        return
      }
    }
    await onSave(prompt.prompt_key, {
      prompt_value: valueToSave,
      prompt_type: prompt.prompt_type,
      description: prompt.description || undefined
    })
    setIsDirty(false)
  }

  const handleReset = async () => {
    if (confirm(t('promptSettings.confirmReset', 'Reset this prompt to default?'))) {
      await onReset(prompt.prompt_key)
    }
  }

  return (
    <div className="border rounded-lg mb-2 overflow-hidden">
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors",
          expanded && "border-b"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronRightIcon className="w-4 h-4" />
          )}
          <span className="font-medium">{prompt.prompt_key}</span>
          {prompt.is_default ? (
            <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
              {t('promptSettings.default', 'Default')}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 bg-emerald-200 dark:bg-emerald-800 rounded">
              {t('promptSettings.customized', 'Customized')}
            </span>
          )}
          {isDirty && (
            <span className="text-xs px-2 py-0.5 bg-amber-200 dark:bg-amber-800 rounded">
              {t('promptSettings.unsaved', 'Unsaved')}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {prompt.prompt_type === 'json' ? 'JSON' : 'Text'}
        </span>
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          {prompt.description && (
            <p className="text-sm text-muted-foreground">{prompt.description}</p>
          )}
          <Textarea
            value={editValue}
            onChange={(e) => handleChange(e.target.value)}
            className="font-mono text-sm min-h-[200px]"
            placeholder={t('promptSettings.enterPrompt', 'Enter prompt...')}
          />
          <div className="flex justify-end gap-2">
            {!prompt.is_default && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  handleReset()
                }}
                disabled={saving}
              >
                <RotateCcwIcon className="w-4 h-4 mr-1" />
                {t('promptSettings.resetToDefault', 'Reset')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleSave()
              }}
              disabled={saving || !isDirty}
            >
              <SaveIcon className="w-4 h-4 mr-1" />
              {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PromptSettings() {
  const { t } = useTranslation()
  const [prompts, setPrompts] = useState<PromptResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPrompts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getAllPrompts()
      setPrompts(response.data.prompts)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrompts()
  }, [fetchPrompts])

  const handleSave = async (key: string, request: PromptUpdateRequest) => {
    setSaving(true)
    try {
      const response = await updatePrompt(key, request)
      // Update the local state with the saved prompt
      setPrompts(prev => prev.map(p =>
        p.prompt_key === key ? response.data : p
      ))
    } catch (err) {
      alert(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (key: string) => {
    setSaving(true)
    try {
      const response = await resetPrompt(key)
      if (response.data) {
        setPrompts(prev => prev.map(p =>
          p.prompt_key === key ? response.data! : p
        ))
      }
    } catch (err) {
      alert(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleResetAll = async () => {
    if (confirm(t('promptSettings.confirmResetAll', 'Reset ALL prompts to defaults? This cannot be undone.'))) {
      setSaving(true)
      try {
        await resetAllPrompts()
        await fetchPrompts()
      } catch (err) {
        alert(errorMessage(err))
      } finally {
        setSaving(false)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p>{t('promptSettings.loading', 'Loading prompts...')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-red-500">
          <p>{error}</p>
          <Button onClick={fetchPrompts} className="mt-4">
            {t('promptSettings.retry', 'Retry')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h1 className="text-xl font-bold">{t('promptSettings.title', 'Prompt Settings')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('promptSettings.description', 'Customize prompts used for entity extraction and query responses.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchPrompts} disabled={loading}>
            <RefreshCwIcon className="w-4 h-4 mr-1" />
            {t('promptSettings.refresh', 'Refresh')}
          </Button>
          <Button variant="destructive" onClick={handleResetAll} disabled={saving}>
            <RotateCcwIcon className="w-4 h-4 mr-1" />
            {t('promptSettings.resetAll', 'Reset All')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {prompts.map(prompt => (
            <PromptItem
              key={prompt.prompt_key}
              prompt={prompt}
              onSave={handleSave}
              onReset={handleReset}
              saving={saving}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
