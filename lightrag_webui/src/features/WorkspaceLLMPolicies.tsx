import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BrainCircuitIcon, Loader2Icon, RotateCcwIcon, SaveIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  getWorkspaceLLMPolicies,
  getWorkspaces,
  LLMProfile,
  resetWorkspaceLLMPolicies,
  updateWorkspaceLLMPolicies,
  WorkspaceInfo,
  WorkspaceLLMPolicy,
  WorkspaceLLMPolicyUpsert,
  WorkspaceLLMPurpose,
} from '@/api/lightrag'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { errorMessage } from '@/lib/utils'

const PURPOSES: WorkspaceLLMPurpose[] = [
  'knowledge_ingestion',
  'knowledge_structure',
  'schema_design',
  'search_answer',
  'faq_selection',
  'multimodal',
]

type PolicyDraft = WorkspaceLLMPolicyUpsert

const nullableNumber = (value: string) => (value.trim() === '' ? null : Number(value))

const policyFromSaved = (policy: WorkspaceLLMPolicy): PolicyDraft => ({
  purpose: policy.purpose,
  profile_id: policy.profile_id,
  thinking_mode: policy.thinking_mode,
  timeout_seconds: policy.timeout_seconds ?? null,
  max_tokens: policy.max_tokens ?? null,
  temperature: policy.temperature ?? null,
  top_p: policy.top_p ?? null,
  presence_penalty: policy.presence_penalty ?? null,
  response_format: policy.response_format ?? null,
  fallback_profile_id: policy.fallback_profile_id ?? null,
  extra_options: policy.extra_options || {},
})

function recommendedPolicies(profiles: LLMProfile[]): PolicyDraft[] {
  const active = profiles.filter((profile) => profile.is_active)
  const v6 = active.find((profile) => profile.profile_id === 'qwen-v6-18008')
    || active.find((profile) => /v6/i.test(`${profile.profile_id} ${profile.model}`))
    || active[0]
  const v4 = active.find((profile) => profile.profile_id === 'qwen-v4-18002')
    || active.find((profile) => /v4/i.test(`${profile.profile_id} ${profile.model}`))
    || v6
  const vision = [v4, v6, ...active].find((profile) => profile?.supports_vision) || v4

  const make = (
    purpose: WorkspaceLLMPurpose,
    profile: LLMProfile | undefined,
    thinkingMode: PolicyDraft['thinking_mode'],
    maxTokens: number,
    fallback?: LLMProfile
  ): PolicyDraft => ({
    purpose,
    profile_id: profile?.profile_id || '',
    thinking_mode: thinkingMode,
    timeout_seconds: null,
    max_tokens: maxTokens,
    temperature: null,
    top_p: null,
    presence_penalty: null,
    response_format: ['knowledge_structure', 'schema_design', 'faq_selection'].includes(purpose)
      ? 'json_object'
      : null,
    fallback_profile_id:
      fallback && fallback.profile_id !== profile?.profile_id ? fallback.profile_id : null,
    extra_options: {},
  })

  return [
    make('knowledge_ingestion', v6, 'disabled', 4096, v4),
    make('knowledge_structure', v6, 'disabled', 4096, v4),
    {
      ...make('schema_design', v6, 'enabled', 12288, v4),
      timeout_seconds: 300,
    },
    make('search_answer', v4, 'disabled', 1200, v6),
    make('faq_selection', v4, 'disabled', 512, v6),
    make('multimodal', vision, 'disabled', 2048, vision?.profile_id === v4?.profile_id ? v6 : v4),
  ]
}

export default function WorkspaceLLMPolicies({ profiles }: { profiles: LLMProfile[] }) {
  const { t } = useTranslation()
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [policies, setPolicies] = useState<PolicyDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const requestSequence = useRef(0)

  const activeProfiles = useMemo(
    () => profiles.filter((profile) => profile.is_active),
    [profiles]
  )

  useEffect(() => {
    const loadWorkspaces = async () => {
      try {
        const firstPage = await getWorkspaces(1, 100, true)
        const pageCount = Math.ceil(firstPage.total / firstPage.page_size)
        const remainingPages = pageCount > 1
          ? await Promise.all(
              Array.from({ length: pageCount - 1 }, (_, index) => getWorkspaces(index + 2, 100, true))
            )
          : []
        const allWorkspaces = [
          ...firstPage.workspaces,
          ...remainingPages.flatMap((page) => page.workspaces),
        ]
        setWorkspaces(allWorkspaces)
        setWorkspaceId((current) => current || allWorkspaces[0]?.workspace_id || '')
      } catch (error) {
        toast.error(t('llmSettings.policyWorkspaceLoadFailed'), { description: errorMessage(error) })
        setLoading(false)
      }
    }
    void loadWorkspaces()
  }, [t])

  const loadPolicies = useCallback(async () => {
    if (!workspaceId) return
    const sequence = ++requestSequence.current
    setLoading(true)
    try {
      const result = await getWorkspaceLLMPolicies(workspaceId)
      if (sequence !== requestSequence.current) return
      const savedByPurpose = new Map(result.map((policy) => [policy.purpose, policy]))
      const recommended = recommendedPolicies(profiles)
      setPolicies(
        recommended.map((policy) => {
          const saved = savedByPurpose.get(policy.purpose)
          return saved ? policyFromSaved(saved) : policy
        })
      )
      setSavedCount(result.length)
    } catch (error) {
      if (sequence !== requestSequence.current) return
      toast.error(t('llmSettings.policyLoadFailed'), { description: errorMessage(error) })
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [profiles, t, workspaceId])

  useEffect(() => {
    void loadPolicies()
  }, [loadPolicies])

  const updatePolicy = <K extends keyof PolicyDraft>(
    purpose: WorkspaceLLMPurpose,
    key: K,
    value: PolicyDraft[K]
  ) => {
    setPolicies((current) => current.map((policy) => (
      policy.purpose === purpose ? { ...policy, [key]: value } : policy
    )))
  }

  const applyRecommended = () => {
    setPolicies(recommendedPolicies(profiles))
    toast.info(t('llmSettings.recommendedPrepared'))
  }

  const savePolicies = async () => {
    if (!workspaceId || policies.some((policy) => !policy.profile_id)) {
      toast.error(t('llmSettings.policyProfileRequired'))
      return
    }
    setSaving(true)
    try {
      const result = await updateWorkspaceLLMPolicies(workspaceId, policies)
      setPolicies(result.map(policyFromSaved))
      setSavedCount(result.length)
      toast.success(t('llmSettings.policySaved'))
    } catch (error) {
      toast.error(t('llmSettings.policySaveFailed'), { description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const resetPolicies = async () => {
    if (!workspaceId || !confirm(t('llmSettings.policyResetConfirm'))) return
    setSaving(true)
    try {
      await resetWorkspaceLLMPolicies(workspaceId)
      setPolicies(recommendedPolicies(profiles))
      setSavedCount(0)
      toast.success(t('llmSettings.policyReset'))
    } catch (error) {
      toast.error(t('llmSettings.policyResetFailed'), { description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border">
      <div className="sticky top-0 z-10 flex flex-wrap items-end justify-between gap-4 border-b bg-background px-5 py-4">
        <div className="min-w-[280px] flex-1 space-y-1.5">
          <Label>{t('llmSettings.workspace')}</Label>
          <Select value={workspaceId} onValueChange={setWorkspaceId}>
            <SelectTrigger className="max-w-2xl">
              <SelectValue placeholder={t('llmSettings.selectWorkspace')} />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.workspace_id} value={workspace.workspace_id}>
                  {workspace.name} ({workspace.workspace_id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {savedCount === PURPOSES.length
              ? t('llmSettings.policyApplied')
              : t('llmSettings.policyNotApplied')}
          </Badge>
          <Button variant="outline" onClick={applyRecommended} disabled={!activeProfiles.length}>
            <SparklesIcon className="h-4 w-4" />
            {t('llmSettings.applyRecommended')}
          </Button>
          <Button variant="outline" onClick={() => void resetPolicies()} disabled={saving || !savedCount}>
            <RotateCcwIcon className="h-4 w-4" />
            {t('common.reset')}
          </Button>
          <Button onClick={() => void savePolicies()} disabled={saving || loading}>
            {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
            {t('common.save')}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-[1500px] space-y-4 p-5">
        <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-4 dark:bg-emerald-950/10">
          <BrainCircuitIcon className="mt-0.5 h-5 w-5 text-emerald-700" />
          <div>
            <p className="font-medium">{t('llmSettings.policyGuideTitle')}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('llmSettings.policyGuide')}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-52 items-center justify-center text-muted-foreground">
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : (
          <div className="space-y-3">
            {policies.map((policy) => (
              <section key={policy.purpose} className="rounded-md border p-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(240px,1fr)_190px_minmax(220px,0.8fr)]">
                  <div>
                    <h3 className="font-semibold">{t(`llmSettings.purposes.${policy.purpose}.title`)}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t(`llmSettings.purposes.${policy.purpose}.description`)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('llmSettings.primaryProfile')}</Label>
                    <Select value={policy.profile_id} onValueChange={(value) => updatePolicy(policy.purpose, 'profile_id', value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {activeProfiles.map((profile) => (
                          <SelectItem key={profile.profile_id} value={profile.profile_id}>
                            {profile.name} · {profile.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('llmSettings.thinkingMode')}</Label>
                    <Select value={policy.thinking_mode} onValueChange={(value) => updatePolicy(policy.purpose, 'thinking_mode', value as PolicyDraft['thinking_mode'])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">{t('llmSettings.thinkingInherit')}</SelectItem>
                        <SelectItem value="enabled">{t('llmSettings.thinkingOn')}</SelectItem>
                        <SelectItem value="disabled">{t('llmSettings.thinkingOff')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('llmSettings.fallbackProfile')}</Label>
                    <Select value={policy.fallback_profile_id || 'none'} onValueChange={(value) => updatePolicy(policy.purpose, 'fallback_profile_id', value === 'none' ? null : value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('llmSettings.noFallback')}</SelectItem>
                        {activeProfiles.filter((profile) => profile.profile_id !== policy.profile_id).map((profile) => (
                          <SelectItem key={profile.profile_id} value={profile.profile_id}>{profile.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <details className="mt-4 border-t pt-3">
                  <summary className="cursor-pointer text-sm font-medium">{t('llmSettings.advancedOverrides')}</summary>
                  <p className="mt-1 text-xs text-muted-foreground">{t('llmSettings.advancedOverridesDescription')}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {([
                      ['timeout_seconds', t('llmSettings.timeout')],
                      ['max_tokens', t('llmSettings.maxTokens')],
                      ['temperature', 'Temperature'],
                      ['top_p', 'Top P'],
                      ['presence_penalty', 'Presence penalty'],
                    ] as const).map(([key, label]) => (
                      <div key={key} className="space-y-1.5">
                        <Label>{label}</Label>
                        <Input
                          type="number"
                          value={policy[key] ?? ''}
                          placeholder={t('llmSettings.useProfileDefault')}
                          onChange={(event) => updatePolicy(policy.purpose, key, nullableNumber(event.target.value))}
                        />
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
