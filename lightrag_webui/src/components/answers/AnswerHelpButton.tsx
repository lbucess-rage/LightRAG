import { HelpCircleIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/ui/Button'
import { useSettingsStore } from '@/stores/settings'

export default function AnswerHelpButton() {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => useSettingsStore.getState().setCurrentTab('answer-help')}
    >
      <HelpCircleIcon className="h-4 w-4" />
      {t('answerCatalog.help.openHelp', '도움말')}
    </Button>
  )
}
