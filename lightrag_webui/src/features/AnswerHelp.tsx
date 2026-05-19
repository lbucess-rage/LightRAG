import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BadgeCheckIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  FileInputIcon,
  HelpCircleIcon,
  LibraryIcon,
  MousePointerClickIcon,
  PlayCircleIcon,
  SearchCheckIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { AppTab } from '@/lib/workspaceMode'
import { useSettingsStore } from '@/stores/settings'

type GuideStep = {
  title: string
  description: string
  tab: AppTab
  action: string
}

const terms = [
  {
    term: '승인 답변',
    description: '운영자가 검토하고 게시한 원문 또는 요약 답변입니다. 검색 시 새 답변을 만들지 않고 이 답변을 정확히 찾는 것이 목표입니다.',
  },
  {
    term: '소스',
    description: '답변 초안을 만들기 위해 입력하는 텍스트, HTML, Markdown, URL, 파일, DB/NoSQL 샘플 같은 원자료입니다.',
  },
  {
    term: '매칭 힌트',
    description: '답변을 찾기 쉽게 만드는 질문, 키워드, 동의어, 메모입니다. 대표 질문은 더 높은 기준으로 매칭됩니다.',
  },
  {
    term: '제외어',
    description: '특정 질문이 이 답변으로 매칭되면 안 되는 단서입니다. 예를 들어 환불 답변에 배송 지연 제외어를 넣을 수 있습니다.',
  },
  {
    term: '표시 방식',
    description: '답변을 요약만 보여줄지, 원문만 보여줄지, 둘 다 보여줄지 정하는 운영 정책입니다.',
  },
  {
    term: '변경 이력',
    description: '답변을 저장한 시점별 기록입니다. 잘못 수정했을 때 이전 버전으로 복구할 수 있습니다.',
  },
  {
    term: '매칭 점수',
    description: '제목, 요약, 본문, 태그, 매칭 힌트, 우선순위가 질문과 얼마나 맞는지 합산한 점수입니다.',
  },
  {
    term: '구조 분석 결과',
    description: 'JSON, CSV, DB/NoSQL 샘플처럼 필드와 행으로 해석 가능한 소스의 컬럼, 샘플 행, 행 수 정보를 정리한 값입니다.',
  },
  {
    term: '안전 조회',
    description: '운영자가 구조화 데이터를 정해진 조건으로 검색하는 기능입니다. 등록된 데이터셋 범위에서 미리보기와 실행을 지원합니다.',
  },
  {
    term: '조회 기록',
    description: '질문이 어떤 답변으로 매칭됐는지, 후보 점수와 처리 지연이 어땠는지를 남긴 운영 기록입니다.',
  },
  {
    term: '신뢰도',
    description: '선택된 답변의 최종 점수입니다. 운영 기준에 따라 최소 점수를 올리면 오답 선택 위험을 줄일 수 있습니다.',
  },
]

const screenshotGuides = [
  {
    title: '답변 라이브러리',
    caption: '답변을 만들고, 게시하고, 상세 편집과 이전 버전 복구를 수행하는 운영 화면입니다.',
    tab: 'answers' as AppTab,
  },
  {
    title: '소스 위저드',
    caption: '원자료를 미리보기로 분석하고 제목, 요약, 태그, 매칭 힌트 후보를 검토한 뒤 답변 초안으로 바꾸는 화면입니다.',
    tab: 'answer-sources' as AppTab,
  },
  {
    title: '매칭 관리',
    caption: '답변별 질문, 키워드, 동의어, 제외어를 한곳에서 추가/삭제하고 빠른 매칭 테스트를 수행하는 화면입니다.',
    tab: 'answer-matching' as AppTab,
  },
  {
    title: '구조화 데이터',
    caption: '소스의 필드와 샘플 행을 확인하고 안전 조회를 미리보기/실행하는 화면입니다.',
    tab: 'structured-data' as AppTab,
  },
  {
    title: '테스트 콘솔',
    caption: '사용자 질문을 넣고 선택된 답변, 후보, 점수 구성요소를 확인하는 검증 화면입니다.',
    tab: 'answer-test' as AppTab,
  },
  {
    title: '분석',
    caption: '조회 기록, 매칭 안 된 질문, 평균 지연, 상위 선택 답변을 확인하고 운영 보강 대상을 찾는 화면입니다.',
    tab: 'answer-analytics' as AppTab,
  },
]

const featureGuides = [
  {
    title: '답변',
    purpose: '승인된 답변의 본문, 요약, 게시 상태, 유효기간, 표시 방식을 관리합니다.',
    when: '운영자가 최종 답변을 검토하거나 이전 버전으로 복구해야 할 때 사용합니다.',
  },
  {
    title: '소스',
    purpose: '텍스트, 파일, URL, 표 샘플, DB/NoSQL 샘플을 답변 초안으로 바꿉니다.',
    when: '새 답변을 대량 등록하거나 원자료에서 후보 답변을 만들 때 사용합니다.',
  },
  {
    title: '매칭',
    purpose: '대표 질문, 키워드, 제외어 같은 매칭 힌트를 답변별로 관리합니다.',
    when: '질문이 엉뚱한 답변으로 연결되거나 후보 점수를 더 높여야 할 때 사용합니다.',
  },
  {
    title: '구조화 데이터',
    purpose: 'CSV/JSON 같은 표 데이터를 분석하고 데이터셋으로 만들어 조건 검색합니다.',
    when: '정해진 컬럼과 행을 기준으로 빠르고 일관된 조회가 필요할 때 사용합니다.',
  },
  {
    title: '테스트 콘솔',
    purpose: '실제 질문을 넣어 선택 답변, 후보 목록, 점수 근거를 확인합니다.',
    when: '답변을 게시하기 전 품질을 검증하거나 최소 점수 기준을 조정할 때 사용합니다.',
  },
  {
    title: '분석',
    purpose: '조회 기록, 매칭 안 된 질문, 많이 선택된 답변, 지연 시간을 확인합니다.',
    when: '운영 중 보강해야 할 답변과 매칭 힌트를 찾을 때 사용합니다.',
  },
]

export default function AnswerHelp() {
  const { t } = useTranslation()
  const [activeStep, setActiveStep] = useState(0)

  const tutorialSteps = useMemo<GuideStep[]>(() => [
    {
      title: t('answerCatalog.help.steps.create.title', '1. 답변 초안 만들기'),
      description: t('answerCatalog.help.steps.create.description', '직접 답변을 만들거나 소스 위저드에서 원자료를 미리보기로 분석한 뒤 답변 초안으로 변환합니다. 초안은 바로 서비스되지 않습니다.'),
      tab: 'answer-sources',
      action: t('answerCatalog.help.steps.create.action', '소스 탭 열기'),
    },
    {
      title: t('answerCatalog.help.steps.review.title', '2. 답변 검토 및 정책 설정'),
      description: t('answerCatalog.help.steps.review.description', '본문, 승인 요약, 표시 방식, 우선순위, 유효기간, 태그를 확인합니다. 잘못 저장해도 변경 이력에서 이전 버전으로 복구할 수 있습니다.'),
      tab: 'answers',
      action: t('answerCatalog.help.steps.review.action', '답변 탭 열기'),
    },
    {
      title: t('answerCatalog.help.steps.guidance.title', '3. 매칭 규칙과 제외어 정리'),
      description: t('answerCatalog.help.steps.guidance.description', '매칭 관리 화면에서 대표 질문과 키워드를 추가하고, 잘못 연결될 수 있는 질문은 제외어로 막습니다. 빠른 테스트로 후보 점수를 즉시 확인합니다.'),
      tab: 'answer-matching',
      action: t('answerCatalog.help.steps.guidance.action', '매칭 탭 열기'),
    },
    {
      title: t('answerCatalog.help.steps.structured.title', '4. 구조화 데이터 확인'),
      description: t('answerCatalog.help.steps.structured.description', 'JSON, CSV, DB/NoSQL 샘플에서 감지된 필드와 샘플 행을 확인하고, 안전 조회로 조건 검색을 미리보기/실행합니다.'),
      tab: 'structured-data',
      action: t('answerCatalog.help.steps.structured.action', '구조화 데이터 열기'),
    },
    {
      title: t('answerCatalog.help.steps.test.title', '5. 테스트 콘솔에서 검증'),
      description: t('answerCatalog.help.steps.test.description', '실제 사용자 질문을 넣어 선택된 답변, 후보 점수, 점수 구성요소를 확인합니다. 최소 점수 기준도 함께 조정합니다.'),
      tab: 'answer-test',
      action: t('answerCatalog.help.steps.test.action', '테스트 콘솔 열기'),
    },
    {
      title: t('answerCatalog.help.steps.publish.title', '6. 게시 후 운영 분석'),
      description: t('answerCatalog.help.steps.publish.description', '충분히 검증된 답변만 게시합니다. 운영 중에는 조회 기록, 매칭 안 된 질문, 평균 지연, 상위 선택 답변을 보고 매칭 힌트를 보강합니다.'),
      tab: 'answer-analytics',
      action: t('answerCatalog.help.steps.publish.action', '분석 탭 열기'),
    },
  ], [t])

  const currentStep = tutorialSteps[activeStep]
  const goToTab = (tab: AppTab) => useSettingsStore.getState().setCurrentTab(tab)

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HelpCircleIcon className="h-5 w-5 text-emerald-500" />
              <h1 className="text-2xl font-bold">{t('answerCatalog.help.title', 'FAQ 고정답변 도움말')}</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t('answerCatalog.help.description', '운영자가 승인 답변을 만들고, 매칭 기준을 관리하고, 실제 질문에서 어떤 답변이 선택되는지 검증하는 흐름을 단계별로 안내합니다.')}
            </p>
          </div>
          <Button onClick={() => goToTab(currentStep.tab)}>
            <PlayCircleIcon className="h-4 w-4" />
            {currentStep.action}
          </Button>
        </section>

        <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="rounded-md border p-4">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardListIcon className="h-4 w-4" />
              <h2 className="font-semibold">{t('answerCatalog.help.tutorial', '단계별 안내')}</h2>
            </div>
            <div className="space-y-2">
              {tutorialSteps.map((step, index) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setActiveStep(index)}
                  className={`w-full rounded-md border p-3 text-left transition ${
                    activeStep === index ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-50' : 'hover:bg-muted/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{step.title}</span>
                    {activeStep === index && <CheckCircle2Icon className="h-4 w-4" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border p-4">
            <div className="mb-3 flex items-center gap-2">
              <MousePointerClickIcon className="h-4 w-4" />
              <h2 className="font-semibold">{currentStep.title}</h2>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{currentStep.description}</p>
            <div className="mt-4 rounded-md border bg-muted/30 p-4">
              <ScreenshotMock step={activeStep} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => goToTab(currentStep.tab)}>
                <MousePointerClickIcon className="h-4 w-4" />
                {currentStep.action}
              </Button>
              <Button
                variant="outline"
                onClick={() => setActiveStep((value) => Math.min(value + 1, tutorialSteps.length - 1))}
                disabled={activeStep === tutorialSteps.length - 1}
              >
                {t('answerCatalog.help.nextStep', '다음 단계')}
              </Button>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <BookOpenIcon className="h-4 w-4" />
            <h2 className="font-semibold">{t('answerCatalog.help.screenGuide', '화면별 캡처형 안내')}</h2>
            <Badge variant="outline">{t('answerCatalog.help.replaceable', '화면 구성 예시')}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {screenshotGuides.map((guide) => (
              <div key={guide.title} className="rounded-md border p-4">
                <div className="mb-3 rounded-md border bg-background p-3">
                  <MiniScreen title={guide.title} />
                </div>
                <div className="text-sm font-medium">{guide.title}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{guide.caption}</p>
                <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => goToTab(guide.tab)}>
                  {t('answerCatalog.help.openScreen', '화면 열기')}
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <ClipboardListIcon className="h-4 w-4" />
            <h2 className="font-semibold">{t('answerCatalog.help.featureGuide', '기능별 사용 가이드')}</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {featureGuides.map((item) => (
              <div key={item.title} className="rounded-md border p-4">
                <div className="text-sm font-semibold">{item.title}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.purpose}</p>
                <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">{item.when}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <LibraryIcon className="h-4 w-4" />
            <h2 className="font-semibold">{t('answerCatalog.help.glossary', '용어 설명')}</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {terms.map((item) => (
              <div key={item.term} className="rounded-md border p-4">
                <div className="text-sm font-semibold">{item.term}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border p-4">
          <div className="mb-3 flex items-center gap-2">
            <SearchCheckIcon className="h-4 w-4" />
            <h2 className="font-semibold">{t('answerCatalog.help.scoreReading', '매칭 점수 읽는 법')}</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ScoreHint icon={<BadgeCheckIcon className="h-4 w-4" />} title="높은 점수" text="대표 질문 또는 핵심 키워드가 잘 맞는 경우입니다. 게시 전 실제 질문 여러 개로 반복 확인합니다." />
            <ScoreHint icon={<SlidersHorizontalIcon className="h-4 w-4" />} title="애매한 점수" text="후보가 여러 개 비슷하게 뜨면 매칭 힌트를 더 구체화하거나 제외어를 추가합니다." />
            <ScoreHint icon={<FileInputIcon className="h-4 w-4" />} title="매칭 없음" text="정답 후보가 없으면 소스 초안을 새로 만들거나 기존 답변의 질문/키워드를 보강합니다." />
            <ScoreHint icon={<SearchCheckIcon className="h-4 w-4" />} title="안전 조회" text="구조화 데이터는 먼저 SQL 모양을 미리보고, 조건과 반환 행 수가 맞을 때만 실행합니다." />
          </div>
        </section>
      </div>
    </div>
  )
}

function ScreenshotMock({ step }: { step: number }) {
  const labels = [
    ['소스 선택', '미리보기', '후보 검토'],
    ['답변 상세', '정책 설정', '저장'],
    ['질문 추가', '제외어 추가', '빠른 테스트'],
    ['필드 확인', 'SQL 미리보기', '실행'],
    ['질문 입력', '후보 확인', '점수 해석'],
    ['게시', '분석', '보강'],
  ][step] ?? ['확인', '검토', '실행']

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <div className="ml-2 h-5 flex-1 rounded bg-muted" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {labels.map((label, index) => (
          <div key={label} className="rounded-md border bg-background p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">{index + 1}</span>
              <span className="text-sm font-medium">{label}</span>
            </div>
            <div className="space-y-2">
              <div className="h-2 rounded bg-muted" />
              <div className="h-2 w-4/5 rounded bg-muted" />
              <div className="h-7 rounded border bg-muted/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniScreen({ title }: { title: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-6 w-16 rounded border bg-muted/40" />
      </div>
      <div className="h-16 rounded-md border bg-muted/30 p-2">
        <div className="mb-2 h-2 w-1/2 rounded bg-muted" />
        <div className="h-2 w-4/5 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-8 rounded border bg-background" />
        <div className="h-8 rounded border bg-background" />
        <div className="h-8 rounded border bg-background" />
      </div>
      <div className="sr-only">{title}</div>
    </div>
  )
}

function ScoreHint({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  )
}
