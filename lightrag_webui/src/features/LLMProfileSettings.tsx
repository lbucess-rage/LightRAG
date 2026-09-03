import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  CpuIcon,
  ImageIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  ServerIcon,
  Settings2Icon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react'

import {
  createLLMProfile,
  deleteLLMProfile,
  getLLMProfiles,
  LLMProfile,
  LLMProfileCreateRequest,
  LLMProfileTestResponse,
  testLLMProfile,
  updateLLMProfile,
} from '@/api/lightrag'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Switch } from '@/components/ui/Switch'
import Textarea from '@/components/ui/Textarea'
import { cn, errorMessage } from '@/lib/utils'
import WorkspaceLLMPolicies from '@/features/WorkspaceLLMPolicies'

type ProfileForm = {
  profileId: string
  name: string
  description: string
  baseUrl: string
  model: string
  apiKey: string
  clearApiKey: boolean
  timeoutSeconds: number
  contextWindow: number
  maxTokens: number
  temperature: number
  topP: number
  presencePenalty: number
  thinkingEnabled: boolean
  supportsThinking: boolean
  supportsTools: boolean
  supportsStructuredOutput: boolean
  supportsVision: boolean
  verifyTls: boolean
  extraOptions: string
  isActive: boolean
}

const createEmptyForm = (): ProfileForm => ({
  profileId: '',
  name: '',
  description: '',
  baseUrl: 'http://localhost:8000/v1',
  model: 'your-model-name',
  apiKey: '',
  clearApiKey: false,
  timeoutSeconds: 120,
  contextWindow: 131072,
  maxTokens: 2048,
  temperature: 0.7,
  topP: 0.8,
  presencePenalty: 0,
  thinkingEnabled: false,
  supportsThinking: true,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsVision: false,
  verifyTls: true,
  extraOptions: '{}',
  isActive: true,
})

const profileToForm = (profile: LLMProfile): ProfileForm => ({
  profileId: profile.profile_id,
  name: profile.name,
  description: profile.description || '',
  baseUrl: profile.base_url,
  model: profile.model,
  apiKey: '',
  clearApiKey: false,
  timeoutSeconds: profile.timeout_seconds,
  contextWindow: profile.context_window,
  maxTokens: profile.max_tokens,
  temperature: profile.temperature,
  topP: profile.top_p,
  presencePenalty: profile.presence_penalty,
  thinkingEnabled: profile.thinking_enabled,
  supportsThinking: profile.supports_thinking,
  supportsTools: profile.supports_tools,
  supportsStructuredOutput: profile.supports_structured_output,
  supportsVision: profile.supports_vision,
  verifyTls: profile.verify_tls,
  extraOptions: JSON.stringify(profile.extra_options || {}, null, 2),
  isActive: profile.is_active,
})

type FieldProps = {
  label: string
  description?: string
  children: React.ReactNode
}

function Field({ label, description, children }: FieldProps) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
    </div>
  )
}

type ToggleRowProps = {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

function ToggleRow({ label, description, checked, onCheckedChange, disabled }: ToggleRowProps) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

function ProbeBadge({ label, status }: { label: string; status: string }) {
  const passed = status === 'ok'
  return (
    <Badge variant="outline" className={cn('gap-1', passed ? 'border-emerald-300 text-emerald-700' : 'text-muted-foreground')}>
      {passed ? <CheckCircle2Icon className="h-3 w-3" /> : <XCircleIcon className="h-3 w-3" />}
      {label}
    </Badge>
  )
}

export default function LLMProfileSettings() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<LLMProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileForm>(createEmptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testPrompt, setTestPrompt] = useState('한 문장으로 연결 상태를 확인해 주세요.')
  const [testThinking, setTestThinking] = useState(false)
  const [testImageUrl, setTestImageUrl] = useState('')
  const [testResult, setTestResult] = useState<LLMProfileTestResponse | null>(null)
  const [section, setSection] = useState<'profiles' | 'workspaces'>('profiles')
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.profile_id === selectedId) || null,
    [profiles, selectedId]
  )

  const loadProfiles = useCallback(async (preferredId?: string) => {
    setLoading(true)
    try {
      const result = await getLLMProfiles()
      setProfiles(result)
      const requestedId = preferredId || selectedId
      const nextId = result.some((profile) => profile.profile_id === requestedId)
        ? requestedId || null
        : result[0]?.profile_id || null
      setSelectedId(nextId)
      const next = result.find((profile) => profile.profile_id === nextId)
      if (next) {
        setForm(profileToForm(next))
        setTestThinking(next.thinking_enabled)
      } else {
        setForm(createEmptyForm())
        setTestThinking(false)
      }
    } catch (error) {
      toast.error(t('llmSettings.loadFailed'), { description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [selectedId, t])

  useEffect(() => {
    void loadProfiles()
    // The initial request should run once. Further refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectProfile = (profile: LLMProfile) => {
    setSelectedId(profile.profile_id)
    setForm(profileToForm(profile))
    setTestThinking(profile.thinking_enabled)
    setTestResult(null)
    setTestImageUrl('')
  }

  const startCreate = () => {
    setSelectedId(null)
    setForm(createEmptyForm())
    setTestThinking(false)
    setTestResult(null)
    setTestImageUrl('')
  }

  const updateForm = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const parseExtraOptions = (): Record<string, any> | null => {
    try {
      const parsed = JSON.parse(form.extraOptions || '{}')
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error(t('llmSettings.extraOptionsObject'))
      }
      return parsed
    } catch (error) {
      toast.error(t('llmSettings.invalidExtraOptions'), { description: errorMessage(error) })
      return null
    }
  }

  const buildPayload = (): LLMProfileCreateRequest | null => {
    const extraOptions = parseExtraOptions()
    if (extraOptions === null) return null
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      toast.error(t('llmSettings.requiredFields'))
      return null
    }
    return {
      profile_id: form.profileId.trim() || undefined,
      name: form.name.trim(),
      description: form.description.trim() || null,
      provider: 'openai_compatible',
      base_url: form.baseUrl.trim(),
      model: form.model.trim(),
      api_key: form.apiKey || undefined,
      timeout_seconds: form.timeoutSeconds,
      context_window: form.contextWindow,
      max_tokens: form.maxTokens,
      temperature: form.temperature,
      top_p: form.topP,
      presence_penalty: form.presencePenalty,
      thinking_enabled: form.supportsThinking && form.thinkingEnabled,
      supports_thinking: form.supportsThinking,
      supports_tools: form.supportsTools,
      supports_structured_output: form.supportsStructuredOutput,
      supports_vision: form.supportsVision,
      verify_tls: form.verifyTls,
      extra_options: extraOptions,
      is_active: form.isActive,
    }
  }

  const saveProfile = async () => {
    const payload = buildPayload()
    if (!payload) return
    setSaving(true)
    try {
      let saved: LLMProfile
      if (selectedProfile) {
        const updatePayload = { ...payload }
        delete updatePayload.profile_id
        saved = await updateLLMProfile(selectedProfile.profile_id, {
          ...updatePayload,
          clear_api_key: form.clearApiKey,
        })
      } else {
        saved = await createLLMProfile(payload)
      }
      toast.success(t('llmSettings.saved'))
      await loadProfiles(saved.profile_id)
    } catch (error) {
      toast.error(t('llmSettings.saveFailed'), { description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const removeProfile = async () => {
    if (!selectedProfile) return
    if (!confirm(t('llmSettings.confirmDelete', { name: selectedProfile.name }))) return
    try {
      await deleteLLMProfile(selectedProfile.profile_id)
      toast.success(t('llmSettings.deleted'))
      setSelectedId(null)
      setForm(createEmptyForm())
      setTestResult(null)
      await loadProfiles()
    } catch (error) {
      toast.error(t('llmSettings.deleteFailed'), { description: errorMessage(error) })
    }
  }

  const runTest = async () => {
    if (!selectedProfile) {
      toast.info(t('llmSettings.saveBeforeTest'))
      return
    }
    if (!testPrompt.trim()) {
      toast.error(t('llmSettings.testPromptRequired'))
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testLLMProfile(selectedProfile.profile_id, {
        prompt: testPrompt.trim(),
        thinking_enabled: testThinking,
        image_url: form.supportsVision && testImageUrl.trim() ? testImageUrl.trim() : undefined,
      })
      setTestResult(result)
      if (result.success) toast.success(t('llmSettings.testSucceeded'))
      else toast.error(t('llmSettings.testFailed'), { description: result.error || undefined })
    } catch (error) {
      toast.error(t('llmSettings.testFailed'), { description: errorMessage(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-md border p-2">
            <CpuIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t('llmSettings.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('llmSettings.description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void loadProfiles()} disabled={loading}>
            <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          {section === 'profiles' && (
            <Button onClick={startCreate}>
              <PlusIcon className="h-4 w-4" />
              {t('llmSettings.addProfile')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex w-fit rounded-md bg-muted p-1">
        <Button
          size="sm"
          variant={section === 'profiles' ? 'secondary' : 'ghost'}
          onClick={() => setSection('profiles')}
        >
          <ServerIcon className="h-4 w-4" />
          {t('llmSettings.profileTab')}
        </Button>
        <Button
          size="sm"
          variant={section === 'workspaces' ? 'secondary' : 'ghost'}
          onClick={() => setSection('workspaces')}
        >
          <Settings2Icon className="h-4 w-4" />
          {t('llmSettings.workspacePolicyTab')}
        </Button>
      </div>

      {section === 'profiles' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-md border lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex min-h-56 flex-col border-b lg:min-h-0 lg:border-r lg:border-b-0">
          <div className="border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{t('llmSettings.profileList')}</p>
              <Badge variant="outline">{profiles.length}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('llmSettings.profileListDescription')}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                {t('common.loading')}
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground">
                <ServerIcon className="mb-2 h-7 w-7" />
                {t('llmSettings.emptyProfiles')}
              </div>
            ) : (
              <div className="space-y-1">
                {profiles.map((profile) => (
                  <button
                    type="button"
                    key={profile.profile_id}
                    onClick={() => selectProfile(profile)}
                    className={cn(
                      'w-full rounded-md border px-3 py-3 text-left transition-colors hover:bg-muted/60',
                      selectedId === profile.profile_id && 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{profile.name}</span>
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', profile.is_active ? 'bg-emerald-500' : 'bg-zinc-400')} />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{profile.model}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {profile.supports_thinking && <Badge variant="outline">Thinking</Badge>}
                      {profile.supports_vision && <Badge variant="outline">Vision</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto">
          <div className="mx-auto max-w-[1500px] space-y-7 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedProfile ? selectedProfile.name : t('llmSettings.newProfile')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedProfile ? selectedProfile.profile_id : t('llmSettings.newProfileDescription')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedProfile && (
                  <Button variant="outline" onClick={() => void removeProfile()}>
                    <Trash2Icon className="h-4 w-4" />
                    {t('common.delete')}
                  </Button>
                )}
                <Button onClick={() => void saveProfile()} disabled={saving}>
                  {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
                  {t('common.save')}
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ServerIcon className="h-4 w-4" />
                <h3 className="font-semibold">{t('llmSettings.connectionSection')}</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label={t('llmSettings.profileName')}>
                  <Input value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
                </Field>
                <Field label={t('llmSettings.profileId')} description={t('llmSettings.profileIdHelp')}>
                  <Input
                    value={form.profileId}
                    onChange={(event) => updateForm('profileId', event.target.value)}
                    disabled={Boolean(selectedProfile)}
                    placeholder="llm-qwen-production"
                  />
                </Field>
                <Field label={t('llmSettings.baseUrl')}>
                  <Input value={form.baseUrl} onChange={(event) => updateForm('baseUrl', event.target.value)} />
                </Field>
                <Field label={t('llmSettings.model')}>
                  <Input value={form.model} onChange={(event) => updateForm('model', event.target.value)} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
                <Field label={t('llmSettings.descriptionLabel')}>
                  <Input value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
                </Field>
                <Field label={t('llmSettings.apiKey')} description={selectedProfile?.api_key_configured ? t('llmSettings.apiKeyConfigured') : t('llmSettings.apiKeyOptional')}>
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <KeyRoundIcon className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="password"
                        className="pl-9"
                        value={form.apiKey}
                        onChange={(event) => {
                          updateForm('apiKey', event.target.value)
                          if (event.target.value) updateForm('clearApiKey', false)
                        }}
                        placeholder={selectedProfile?.api_key_configured ? '••••••••' : 'dummy'}
                      />
                    </div>
                    {selectedProfile?.api_key_configured && (
                      <Button
                        type="button"
                        variant={form.clearApiKey ? 'destructive' : 'outline'}
                        onClick={() => updateForm('clearApiKey', !form.clearApiKey)}
                      >
                        {t('llmSettings.clearKey')}
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div className="flex items-center gap-2">
                <BrainCircuitIcon className="h-4 w-4" />
                <h3 className="font-semibold">{t('llmSettings.generationSection')}</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                <Field label={t('llmSettings.timeout')}>
                  <Input type="number" min={1} value={form.timeoutSeconds} onChange={(event) => updateForm('timeoutSeconds', Number(event.target.value))} />
                </Field>
                <Field label={t('llmSettings.contextWindow')}>
                  <Input type="number" min={1} value={form.contextWindow} onChange={(event) => updateForm('contextWindow', Number(event.target.value))} />
                </Field>
                <Field label={t('llmSettings.maxTokens')}>
                  <Input type="number" min={1} value={form.maxTokens} onChange={(event) => updateForm('maxTokens', Number(event.target.value))} />
                </Field>
                <Field label="Temperature">
                  <Input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(event) => updateForm('temperature', Number(event.target.value))} />
                </Field>
                <Field label="Top P">
                  <Input type="number" min={0} max={1} step={0.05} value={form.topP} onChange={(event) => updateForm('topP', Number(event.target.value))} />
                </Field>
                <Field label="Presence penalty">
                  <Input type="number" min={-2} max={2} step={0.1} value={form.presencePenalty} onChange={(event) => updateForm('presencePenalty', Number(event.target.value))} />
                </Field>
                <Field label={t('llmSettings.active')}>
                  <div className="flex h-9 items-center rounded-md border px-3">
                    <Switch checked={form.isActive} onCheckedChange={(checked) => updateForm('isActive', checked)} />
                  </div>
                </Field>
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">{t('llmSettings.capabilitySection')}</h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ToggleRow
                  label={t('llmSettings.thinkingSupport')}
                  description={t('llmSettings.thinkingSupportDescription')}
                  checked={form.supportsThinking}
                  onCheckedChange={(checked) => {
                    updateForm('supportsThinking', checked)
                    if (!checked) updateForm('thinkingEnabled', false)
                  }}
                />
                <ToggleRow
                  label={t('llmSettings.defaultThinking')}
                  description={t('llmSettings.defaultThinkingDescription')}
                  checked={form.thinkingEnabled}
                  disabled={!form.supportsThinking}
                  onCheckedChange={(checked) => updateForm('thinkingEnabled', checked)}
                />
                <ToggleRow
                  label={t('llmSettings.visionSupport')}
                  description={t('llmSettings.visionSupportDescription')}
                  checked={form.supportsVision}
                  onCheckedChange={(checked) => updateForm('supportsVision', checked)}
                />
                <ToggleRow
                  label={t('llmSettings.toolsSupport')}
                  description={t('llmSettings.toolsSupportDescription')}
                  checked={form.supportsTools}
                  onCheckedChange={(checked) => updateForm('supportsTools', checked)}
                />
                <ToggleRow
                  label={t('llmSettings.structuredSupport')}
                  description={t('llmSettings.structuredSupportDescription')}
                  checked={form.supportsStructuredOutput}
                  onCheckedChange={(checked) => updateForm('supportsStructuredOutput', checked)}
                />
                <ToggleRow
                  label={t('llmSettings.verifyTls')}
                  description={t('llmSettings.verifyTlsDescription')}
                  checked={form.verifyTls}
                  onCheckedChange={(checked) => updateForm('verifyTls', checked)}
                />
              </div>
              <Field label={t('llmSettings.extraOptions')} description={t('llmSettings.extraOptionsDescription')}>
                <Textarea
                  className="min-h-28 font-mono text-xs"
                  value={form.extraOptions}
                  onChange={(event) => updateForm('extraOptions', event.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{t('llmSettings.testSection')}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('llmSettings.testDescription')}</p>
                </div>
                <Button onClick={() => void runTest()} disabled={!selectedProfile || testing}>
                  {testing ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlayIcon className="h-4 w-4" />}
                  {t('llmSettings.runTest')}
                </Button>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <Field label={t('llmSettings.testPrompt')}>
                  <Textarea className="min-h-24" value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} />
                </Field>
                <div className="space-y-3">
                  <ToggleRow
                    label={t('llmSettings.testThinking')}
                    description={t('llmSettings.testThinkingDescription')}
                    checked={testThinking}
                    disabled={!form.supportsThinking}
                    onCheckedChange={setTestThinking}
                  />
                  {form.supportsVision && (
                    <Field label={t('llmSettings.imageUrl')} description={t('llmSettings.imageUrlDescription')}>
                      <div className="relative">
                        <ImageIcon className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
                        <Input className="pl-9" value={testImageUrl} onChange={(event) => setTestImageUrl(event.target.value)} placeholder="https://... or data:image/..." />
                      </div>
                    </Field>
                  )}
                </div>
              </div>

              {testResult && (
                <div className={cn('rounded-md border p-4', testResult.success ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/10' : 'border-red-300 bg-red-50/50 dark:bg-red-950/10')}>
                  <div className="flex flex-wrap items-center gap-2">
                    {testResult.success ? <CheckCircle2Icon className="h-5 w-5 text-emerald-600" /> : <XCircleIcon className="h-5 w-5 text-red-600" />}
                    <span className="font-medium">{testResult.success ? t('llmSettings.testSucceeded') : t('llmSettings.testFailed')}</span>
                    <Badge variant="outline">{testResult.latency_ms.toLocaleString()} ms</Badge>
                    <ProbeBadge label="Health" status={testResult.health.status} />
                    <ProbeBadge label="Models" status={testResult.models.status} />
                    {testResult.model_found != null && <Badge variant="outline">{testResult.model_found ? t('llmSettings.modelFound') : t('llmSettings.modelNotFound')}</Badge>}
                    {testResult.thinking_enabled && <Badge variant="outline">Thinking {testResult.reasoning_detected ? t('llmSettings.detected') : t('llmSettings.notDetected')}</Badge>}
                    {testResult.vision_requested && <Badge variant="outline">Vision</Badge>}
                  </div>
                  {testResult.content && <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{testResult.content}</p>}
                  {testResult.error && <p className="mt-3 whitespace-pre-wrap text-sm text-red-700">{testResult.error}</p>}
                  {testResult.reasoning_detected && <p className="mt-2 text-xs text-muted-foreground">{t('llmSettings.reasoningSeparated', { count: testResult.reasoning_length })}</p>}
                </div>
              )}
            </div>

          </div>
        </section>
        </div>
      ) : (
        <WorkspaceLLMPolicies profiles={profiles} />
      )}
    </div>
  )
}
