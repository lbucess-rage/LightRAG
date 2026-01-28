import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Star, Save, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import Textarea from '@/components/ui/Textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/Select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/AlertDialog'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  UserPromptTemplate,
  getUserPromptTemplates,
  createUserPromptTemplate,
  updateUserPromptTemplate,
  deleteUserPromptTemplate
} from '@/api/lightrag'
import { errorMessage } from '@/lib/utils'

interface UserPromptTemplateInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
}

export default function UserPromptTemplateInput({
  value,
  onChange,
  placeholder,
  className,
  id
}: UserPromptTemplateInputProps) {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<UserPromptTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Dialog states
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load templates on mount
  useEffect(() => {
    loadTemplates()
  }, [])

  const loadTemplates = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await getUserPromptTemplates()
      setTemplates(response.data.templates)
    } catch (error) {
      console.error('Failed to load templates:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Handle template selection
  const handleTemplateSelect = useCallback((templateId: string) => {
    if (templateId === '__none__') {
      setSelectedTemplateId('')
      onChange('')
      return
    }

    const template = templates.find(t => t.template_id === templateId)
    if (template) {
      setSelectedTemplateId(templateId)
      onChange(template.content)
    }
  }, [templates, onChange])

  // Handle content change
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    // Clear selection if content differs from selected template
    if (selectedTemplateId) {
      const selectedTemplate = templates.find(t => t.template_id === selectedTemplateId)
      if (selectedTemplate && e.target.value !== selectedTemplate.content) {
        setSelectedTemplateId('')
      }
    }
  }, [onChange, selectedTemplateId, templates])

  // Save as new template
  const handleSaveTemplate = useCallback(async () => {
    if (!newTemplateName.trim() || !value.trim()) {
      toast.error(t('retrievePanel.querySettings.templateNameRequired'))
      return
    }

    setIsSaving(true)
    try {
      const response = await createUserPromptTemplate({
        template_name: newTemplateName.trim(),
        content: value,
        is_favorite: false
      })

      if (response.data) {
        setSelectedTemplateId(response.data.template_id || '')
      }

      toast.success(t('retrievePanel.querySettings.templateSaved'))
      setSaveDialogOpen(false)
      setNewTemplateName('')
      await loadTemplates()
    } catch (error) {
      toast.error(t('retrievePanel.querySettings.templateSaveFailed') + ': ' + errorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }, [newTemplateName, value, t, loadTemplates])

  // Update existing template
  const handleUpdateTemplate = useCallback(async () => {
    if (!selectedTemplateId || !value.trim()) return

    setIsSaving(true)
    try {
      await updateUserPromptTemplate(selectedTemplateId, {
        content: value
      })
      toast.success(t('retrievePanel.querySettings.templateUpdated'))
      await loadTemplates()
    } catch (error) {
      toast.error(t('retrievePanel.querySettings.templateUpdateFailed') + ': ' + errorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }, [selectedTemplateId, value, t, loadTemplates])

  // Delete template
  const handleDeleteTemplate = useCallback(async () => {
    if (!selectedTemplateId) return

    setIsDeleting(true)
    try {
      await deleteUserPromptTemplate(selectedTemplateId)
      toast.success(t('retrievePanel.querySettings.templateDeleted'))
      setSelectedTemplateId('')
      onChange('')
      setDeleteDialogOpen(false)
      await loadTemplates()
    } catch (error) {
      toast.error(t('retrievePanel.querySettings.templateDeleteFailed') + ': ' + errorMessage(error))
    } finally {
      setIsDeleting(false)
    }
  }, [selectedTemplateId, t, onChange, loadTemplates])

  // Toggle favorite
  const handleToggleFavorite = useCallback(async (templateId: string, currentFavorite: boolean) => {
    try {
      await updateUserPromptTemplate(templateId, {
        is_favorite: !currentFavorite
      })
      await loadTemplates()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }, [loadTemplates])

  // Check if current content differs from selected template
  const hasContentChanged = useCallback(() => {
    if (!selectedTemplateId) return false
    const selectedTemplate = templates.find(t => t.template_id === selectedTemplateId)
    return selectedTemplate && value !== selectedTemplate.content
  }, [selectedTemplateId, templates, value])

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Template selector and action buttons */}
      <div className="flex items-center gap-1">
        <Select
          value={selectedTemplateId || '__none__'}
          onValueChange={handleTemplateSelect}
          disabled={isLoading}
        >
          <SelectTrigger className="flex-1 h-8 text-xs">
            {isLoading ? (
              <div className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t('retrievePanel.querySettings.loadingTemplates')}</span>
              </div>
            ) : (
              <SelectValue placeholder={t('retrievePanel.querySettings.selectTemplate')} />
            )}
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="__none__">
                <span className="text-gray-500">{t('retrievePanel.querySettings.noTemplate')}</span>
              </SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.template_id} value={template.template_id}>
                  <div className="flex items-center gap-1">
                    {template.is_favorite && (
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    )}
                    <span className="truncate max-w-[180px]">{template.template_name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {/* Save button */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => {
            if (selectedTemplateId && hasContentChanged()) {
              handleUpdateTemplate()
            } else {
              setSaveDialogOpen(true)
            }
          }}
          disabled={!value.trim() || isSaving}
          title={selectedTemplateId && hasContentChanged()
            ? t('retrievePanel.querySettings.updateTemplate')
            : t('retrievePanel.querySettings.saveAsTemplate')
          }
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
        </Button>

        {/* Favorite toggle button */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => {
            const template = templates.find(t => t.template_id === selectedTemplateId)
            if (template) {
              handleToggleFavorite(selectedTemplateId, template.is_favorite)
            }
          }}
          disabled={!selectedTemplateId}
          title={t('retrievePanel.querySettings.toggleFavorite')}
        >
          <Star
            className={cn(
              'h-3.5 w-3.5',
              templates.find(t => t.template_id === selectedTemplateId)?.is_favorite
                ? 'fill-yellow-400 text-yellow-400'
                : ''
            )}
          />
        </Button>

        {/* Delete button */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={!selectedTemplateId || isDeleting}
          title={t('retrievePanel.querySettings.deleteTemplate')}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
        </Button>
      </div>

      {/* Multiline textarea */}
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={handleContentChange}
        placeholder={placeholder}
        className="min-h-[80px] max-h-[200px] resize-y text-xs"
        rows={3}
      />

      {/* Save as new template dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('retrievePanel.querySettings.saveAsTemplate')}</DialogTitle>
            <DialogDescription>
              {t('retrievePanel.querySettings.saveTemplateDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder={t('retrievePanel.querySettings.templateNamePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSaveTemplate()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveTemplate} disabled={isSaving || !newTemplateName.trim()}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                t('common.save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('retrievePanel.querySettings.confirmDeleteTemplate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('retrievePanel.querySettings.confirmDeleteTemplateDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTemplate}
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('retrievePanel.querySettings.deleting')}
                </>
              ) : (
                t('retrievePanel.querySettings.deleteTemplate')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
