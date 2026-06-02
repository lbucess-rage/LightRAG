import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  BarChart3Icon,
  BookOpenIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  FileInputIcon,
  FileQuestionIcon,
  GaugeIcon,
  HelpCircleIcon,
  InfoIcon,
  LibraryIcon,
  MousePointerClickIcon,
  PlayCircleIcon,
  SearchCheckIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  WorkflowIcon,
} from 'lucide-react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { webuiPrefix } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { AppTab } from '@/lib/workspaceMode'
import { useSettingsStore } from '@/stores/settings'

type GuideStep = {
  title: string
  description: string
  tab: AppTab
  action: string
}

type HelpTopic = 'overview' | 'screens' | 'matching' | 'testing' | 'detailedAnalytics' | 'operations' | 'glossary'

type TopicConfig = {
  id: HelpTopic
  title: string
  description: string
  icon: ReactNode
  actionTab: AppTab
  actionLabel: string
  summaryTitle: string
  summaryBullets: string[]
}

const terms = [
  {
    term: '승인 답변',
    description: '운영자가 검토하고 게시한 원문 또는 요약 답변입니다. 검색 시 새 답변을 만들지 않고 이 답변을 정확히 찾는 것이 목표입니다.',
  },
  {
    term: '원본 자료',
    description: '답변 후보를 만들기 위해 입력하는 텍스트, HTML, Markdown, URL, Excel, 파일, DB/NoSQL 샘플 같은 원자료입니다.',
  },
  {
    term: 'Excel 원본',
    description: '최대 200MB의 .xlsx/.xlsm 파일을 업로드해 시트를 선택하고, 컬럼을 제목/질문/본문/분류/상태/유효기간으로 매핑한 뒤 행별 답변 후보로 바꾸는 입력 방식입니다.',
  },
  {
    term: '반복 입력',
    description: '같은 DB, NoSQL, 웹, 수동 테이블 샘플을 여러 번 불러오거나 매핑해 답변 후보를 만들기 위해 저장해 두는 선택 기능입니다. 한 번만 쓰는 입력이라면 등록하지 않아도 됩니다.',
  },
  {
    term: '답변 후보',
    description: '아직 게시되지 않은 개별 답변입니다. 소스에서 여러 개를 만들 수 있고, 답변 메뉴에서 검토한 뒤 게시해야 서비스됩니다.',
  },
  {
    term: '공통 적용 정보',
    description: '소스에서 여러 답변 후보를 만들 때 모든 후보에 같이 들어가는 태그, 우선순위, 생성 묶음 이름 같은 값입니다.',
  },
  {
    term: '행별 매핑',
    description: 'Excel이나 표의 각 행을 답변 후보로 바꿀 때 어떤 컬럼을 제목, 질문, 본문, 분류, 상태, 유효기간으로 사용할지 정하는 규칙입니다.',
  },
  {
    term: '매핑 템플릿',
    description: '답변 자체가 아니라 컬럼 매핑 규칙을 재사용하기 위한 개념입니다. 같은 형식의 Excel이나 DB 샘플을 반복 처리할 때 사용합니다.',
  },
  {
    term: '찾기 힌트',
    description: '답변을 찾기 쉽게 만드는 질문, 키워드, 동의어, 메모입니다. 대표 질문은 더 높은 기준으로 선택됩니다.',
  },
  {
    term: '제외어',
    description: '특정 질문이 이 답변이 선택되면 안 되는 단서입니다. 예를 들어 환불 답변에 배송 지연 제외어를 넣을 수 있습니다.',
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
    term: '답변 항목 점수',
    description: '제목, 요약, 본문, 태그, 찾기 힌트, 우선순위가 질문과 얼마나 맞는지 합산한 점수입니다.',
  },
  {
    term: '빠른 키워드 방식',
    description: '현재 기본 방식입니다. 대표 질문, 키워드, 동의어, 제외어를 가중치로 계산해 빠르게 후보 답변을 찾습니다.',
  },
  {
    term: '의미 보강 검색',
    description: '키워드가 정확히 같지 않아도 뜻이 비슷한 답변을 찾기 위해 답변별 벡터를 함께 비교하는 선택 방식입니다.',
  },
  {
    term: 'LLM ID 선택',
    description: '상위 후보가 애매할 때만 LLM이 후보 답변 ID 중 하나를 고릅니다. 답변 본문은 새로 만들지 않습니다.',
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
    description: '질문이 어떤 답변이 선택됐는지, 후보 점수와 처리 지연이 어땠는지를 남긴 운영 기록입니다.',
  },
  {
    term: '신뢰도',
    description: '선택된 답변의 최종 점수입니다. 운영 기준에 따라 최소 점수를 올리면 오답 선택 위험을 줄일 수 있습니다.',
  },
  {
    term: '상세 분석',
    description: '기간, 기록 유형, 답변 항목 선택 결과, 소스, 조회 방식, 최소 신뢰도, 최대 응답시간을 조건으로 조회 기록을 분석하는 화면입니다.',
  },
  {
    term: '이벤트 상세',
    description: '사용자 질문 1건이 어떤 답변으로 선택됐는지, 후보 답변과 주요 근거, 처리 시간, 원본 메타데이터를 확인하는 팝업입니다.',
  },
  {
    term: '최대 응답시간',
    description: '지정한 시간(ms)보다 오래 걸린 조회 기록을 찾기 위한 조건입니다. 느린 검색 API나 LLM ID 선택 요청을 점검할 때 사용합니다.',
  },
  {
    term: '분석 관점',
    description: '개요, 답변별, 질문별, 소스별, 조회 방식, 시간대, 실패 분석처럼 같은 이벤트를 다른 기준으로 묶어 보는 방식입니다.',
  },
]

const screenshotGuides = [
  {
    title: '답변 조회',
    caption: '답변을 만들고, 게시하고, 상세 편집과 이전 버전 복구를 수행하는 운영 화면입니다.',
    image: 'help/answer-catalog/answers-screen.png',
    points: ['게시 상태', '답변 상세', '변경 이력'],
    example: '예: “유심 불량 무상 교체 기준” 답변을 후보로 만들고, 검토 후 게시 상태로 전환합니다.',
    tab: 'answers' as AppTab,
  },
  {
    title: '답변 추가',
    caption: '빠른 답변 추가로 텍스트, URL, Excel 같은 원본을 바로 미리보고, 반복/대량 추가 설정은 필요한 경우에만 등록해 재사용하는 화면입니다.',
    image: 'help/answer-catalog/sources-screen.png',
    points: ['Excel 업로드와 시트 선택', '컬럼 매핑', '반복/대량 추가 설정'],
    example: '예: 응대가이드 Excel 파일을 업로드하고 “질문/답변/분류/키워드” 컬럼을 매핑한 뒤 행마다 FAQ 답변 후보를 생성합니다.',
    tab: 'answer-sources' as AppTab,
  },
  {
    title: '답변 항목 설정',
    caption: '답변별 질문, 키워드, 동의어, 제외어를 관리하고 키워드/벡터/LLM ID 선택 방식으로 빠른 테스트를 수행하는 화면입니다.',
    image: 'help/answer-catalog/matching-screen.png',
    points: ['찾기 힌트', '벡터 갱신', '빠른 테스트'],
    example: '예: “SIM 교체”, “유심 변경”, “유심 인식 불가”를 같은 답변의 대표 질문과 동의어로 등록합니다.',
    tab: 'answer-matching' as AppTab,
  },
  {
    title: '구조화 데이터',
    caption: '소스의 필드와 샘플 행을 확인하고 안전 조회를 미리보기/실행하는 화면입니다.',
    image: 'help/answer-catalog/structured-data-screen.png',
    points: ['필드 역할', '안전 조회', '샘플 행'],
    example: '예: 요금제 표의 “상품명”, “월정액”, “제공량” 필드를 분석하고 조건 검색으로 정확한 행을 찾습니다.',
    tab: 'structured-data' as AppTab,
  },
  {
    title: '테스트 콘솔',
    caption: '사용자 질문을 넣고 선택된 답변, 후보, 점수 구성요소를 확인하는 검증 화면입니다.',
    image: 'help/answer-catalog/test-console-screen.png',
    points: ['사용자 질문', '조회 방식', '후보 점수'],
    example: '예: “유심이 고장난 것 같아요”를 키워드+벡터로 조회해 어떤 답변이 선택되는지 확인합니다.',
    tab: 'answer-test' as AppTab,
  },
  {
    title: '분석',
    caption: '조회 기록, 답변을 찾지 못한 질문, 평균 지연, 상위 선택 답변을 확인하고 운영 보강 대상을 찾는 화면입니다.',
    image: 'help/answer-catalog/analytics-screen.png',
    points: ['조회 기록', '답변을 찾지 못한 질문', '상위 답변'],
    example: '예: 답변을 찾지 못한 질문을 모아 새 답변을 만들거나 기존 답변의 제외어와 동의어를 보강합니다.',
    tab: 'answer-analytics' as AppTab,
  },
  {
    title: '상세 분석',
    caption: '기간과 조건을 정해 조회한 뒤 답변 선택률, 답변 없음, 응답시간, LLM 선택 비율을 보고 각 이벤트의 상세 근거까지 확인하는 화면입니다.',
    image: 'help/answer-catalog/detailed-analytics-screen.png',
    points: ['조건 조회', '요약 카드', '분석 관점', '이벤트 상세'],
    example: '예: 최근 7일 중 “찾은 답변 없음” 카드만 선택해 반복 실패 질문을 확인하고, 해당 질문의 후보 점수를 상세 팝업에서 검토합니다.',
    tab: 'answer-detailed-analytics' as AppTab,
  },
]

const featureGuides = [
  {
    title: '답변',
    purpose: '승인된 답변의 본문, 요약, 게시 상태, 유효기간, 표시 방식을 관리합니다.',
    when: '운영자가 최종 답변을 검토하거나 이전 버전으로 복구해야 할 때 사용합니다.',
    example: '예: 상담사가 그대로 읽어도 되는 공식 안내문을 게시하고, 기간이 지난 프로모션 답변은 만료 처리합니다.',
    tab: 'answers' as AppTab,
  },
  {
    title: '답변 추가',
    purpose: '텍스트, Excel, 파일, URL, 표 샘플, DB/NoSQL 샘플을 검토 가능한 답변 후보로 바꿉니다.',
    when: '한 번성 입력은 빠른 답변 추가에서 처리하고, 반복해서 쓰는 DB/NoSQL/웹/테이블 입력만 반복/대량 추가 설정에 저장합니다.',
    example: '예: 고객센터 백과사전 Excel의 “응대가이드” 시트를 빠른 답변 추가에서 업로드하고 행별 답변 후보로 변환합니다.',
    tab: 'answer-sources' as AppTab,
  },
  {
    title: '답변 항목 설정',
    purpose: '대표 질문, 키워드, 제외어 같은 찾기 힌트를 답변별로 관리하고, 필요하면 벡터와 LLM ID 선택을 함께 테스트합니다.',
    when: '질문이 엉뚱한 답변으로 연결되거나 표현 차이 때문에 후보 점수를 더 높여야 할 때 사용합니다.',
    example: '예: “번호 이동” 질문이 “기기 변경” 답변으로 연결되면 제외어를 추가하고 대표 질문을 분리합니다.',
    tab: 'answer-matching' as AppTab,
  },
  {
    title: '구조화 데이터',
    purpose: 'CSV/JSON 같은 표 데이터를 분석하고 데이터셋으로 만들어 조건 검색합니다.',
    when: '정해진 컬럼과 행을 기준으로 빠르고 일관된 조회가 필요할 때 사용합니다.',
    example: '예: 요금제, 부가서비스, 지점 목록처럼 표로 관리되는 데이터를 조건 검색 가능한 데이터셋으로 만듭니다.',
    tab: 'structured-data' as AppTab,
  },
  {
    title: '테스트 콘솔',
    purpose: '실제 질문을 넣어 선택 답변, 후보 목록, 점수 근거를 확인합니다.',
    when: '답변을 게시하기 전 품질을 검증하거나 최소 점수 기준을 조정할 때 사용합니다.',
    example: '예: 같은 질문을 키워드, 키워드+벡터, LLM ID 선택으로 비교해 운영 기본 방식을 결정합니다.',
    tab: 'answer-test' as AppTab,
  },
  {
    title: '분석',
    purpose: '조회 기록, 답변을 찾지 못한 질문, 많이 선택된 답변, 지연 시간을 확인합니다.',
    when: '운영 중 보강해야 할 답변과 찾기 힌트를 찾을 때 사용합니다.',
    example: '예: 많이 조회되지만 신뢰도가 낮은 답변을 찾아 대표 질문과 동의어를 추가합니다.',
    tab: 'answer-analytics' as AppTab,
  },
  {
    title: '상세 분석',
    purpose: '조건 기반으로 이벤트를 다시 조회하고, 요약 카드와 탭을 선택해 운영 리포트를 세부 목록까지 확인합니다.',
    when: '기간별 품질 점검, 실패 질문 분석, 느린 응답 확인, LLM 사용 비율 점검이 필요할 때 사용합니다.',
    example: '예: “최소 신뢰도 0.5 이상, 최대 응답시간 1000ms 이하” 조건으로 조회한 뒤 찾은 답변 없음 이벤트만 골라 원인을 확인합니다.',
    tab: 'answer-detailed-analytics' as AppTab,
  },
]

const advancedMatchingGuideTemplates = [
  {
    key: 'prepare',
    title: '1. 답변 항목 설정 화면에서 벡터와 힌트 준비',
    tab: 'answer-matching' as AppTab,
    image: 'help/answer-catalog/matching-hybrid-controls.png',
    alt: '답변 항목 설정 화면의 벡터 갱신, 힌트 추천, 조회 방식 선택 영역',
    summary: '기본 키워드 방식을 유지하면서, 필요할 때만 의미 보강 검색과 LLM ID 선택을 켤 수 있습니다.',
    points: ['벡터 갱신', '힌트 추천', '조회 방식'],
    bullets: [
      '벡터 갱신은 답변 제목, 요약, 본문 일부, 태그, 찾기 힌트를 합쳐 답변별 검색 벡터를 다시 만듭니다.',
      '힌트 추천은 대표 질문, 키워드, 동의어 후보를 제안합니다. 추천 결과는 자동 반영되지 않고 운영자가 추가해야 반영됩니다.',
      '조회 방식은 키워드, 키워드+벡터, LLM ID 선택으로 나뉩니다. 기본값은 가장 빠른 키워드 방식입니다.',
    ],
    note: '답변을 대량 등록했거나 찾기 힌트를 많이 수정한 뒤에는 벡터 갱신을 먼저 실행한 다음 하이브리드 테스트를 진행하는 흐름이 안정적입니다.',
  },
  {
    key: 'hybrid',
    title: '2. 키워드+벡터 결과 해석',
    tab: 'answer-test' as AppTab,
    image: 'help/answer-catalog/test-console-hybrid-result.png',
    alt: '테스트 콘솔에서 키워드+벡터 조회 결과와 후보 점수 상세를 확인하는 화면',
    summary: '하이브리드 모드는 기존 키워드 점수와 의미 유사도 점수를 함께 사용해 후보를 정렬합니다.',
    points: ['선택 답변', '후보 점수', '점수 상세'],
    bullets: [
      'keyword_score는 기존 가중치 방식의 점수입니다. 대표 질문, 키워드, 동의어, 제목, 본문, 태그가 반영됩니다.',
      'vector_score는 질문과 답변 벡터의 의미 유사도입니다. “SIM 교체”처럼 표현이 달라도 가까운 답변을 보강합니다.',
      'hybrid_score는 최종 점수입니다. 후보 카드에서 keyword_score, vector_score, hybrid_score를 함께 보고 판단합니다.',
    ],
    note: 'selected_by가 vector로 표시되면 의미 유사도 보강이 후보 선택에 더 크게 작용했다는 뜻입니다. 이때 오답이면 동의어보다 제외어와 대표 질문을 먼저 조정하는 것이 좋습니다.',
  },
  {
    key: 'llm',
    title: '3. LLM ID 선택은 마지막 확인 단계',
    tab: 'answer-test' as AppTab,
    image: 'help/answer-catalog/test-console-llm-id-select.png',
    alt: '테스트 콘솔에서 LLM ID 선택 방식으로 후보 답변 ID만 선택한 화면',
    summary: 'LLM ID 선택은 본문을 생성하지 않고, 이미 검색된 후보 답변 ID 중 하나만 고르게 제한합니다.',
    points: ['후보 제한', 'ID 검증', '선택 근거'],
    bullets: [
      '후보 목록 밖의 ID를 LLM이 반환하면 서버에서 거부합니다. 따라서 승인 답변 본문을 새로 만들어 내는 방식이 아닙니다.',
      '속도와 비용이 키워드/벡터보다 크므로 모든 요청의 기본값으로 쓰기보다는 애매한 질문에서만 사용합니다.',
      'selected_by가 llm_id_selector로 표시되면 LLM이 후보 중 최종 ID를 골랐다는 뜻입니다.',
    ],
    note: '운영 권장 흐름은 키워드 방식으로 빠르게 찾고, 표현 차이가 있는 질문은 키워드+벡터로 보강하며, 후보가 비슷한 경우에만 LLM ID 선택을 쓰는 방식입니다.',
  },
]

export default function AnswerHelp() {
  const { t } = useTranslation()
  const [activeTopic, setActiveTopic] = useState<HelpTopic>('overview')
  const [activeStep, setActiveStep] = useState(0)
  const [termQuery, setTermQuery] = useState('')

  const tutorialSteps = useMemo<GuideStep[]>(() => [
    {
      title: t('answerCatalog.help.steps.create.title', '1. 답변 후보 만들기'),
      description: t('answerCatalog.help.steps.create.description', '직접 답변을 만들거나 빠른 답변 추가에서 원자료를 미리보기로 분석한 뒤 답변 후보로 변환합니다. 후보는 바로 서비스되지 않습니다.'),
      tab: 'answer-sources',
      action: t('answerCatalog.help.steps.create.action', '답변 추가 열기'),
    },
    {
      title: t('answerCatalog.help.steps.review.title', '2. 답변 검토 및 정책 설정'),
      description: t('answerCatalog.help.steps.review.description', '본문, 답변 메모, 표시 방식, 우선순위, 유효기간, 태그를 확인합니다. 잘못 저장해도 변경 이력에서 이전 버전으로 복구할 수 있습니다.'),
      tab: 'answers',
      action: t('answerCatalog.help.steps.review.action', '답변 조회 열기'),
    },
    {
      title: t('answerCatalog.help.steps.guidance.title', '3. 답변 항목 규칙과 제외어 정리'),
      description: t('answerCatalog.help.steps.guidance.description', '답변 항목 설정 화면에서 대표 질문과 키워드를 추가하고, 잘못 연결될 수 있는 질문은 제외어로 막습니다. 빠른 테스트로 후보 점수를 즉시 확인합니다.'),
      tab: 'answer-matching',
      action: t('answerCatalog.help.steps.guidance.action', '답변 항목 설정 열기'),
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
      description: t('answerCatalog.help.steps.publish.description', '충분히 검증된 답변만 게시합니다. 운영 중에는 조회 기록, 답변을 찾지 못한 질문, 평균 지연, 상위 선택 답변을 보고 찾기 힌트를 보강합니다.'),
      tab: 'answer-analytics',
      action: t('answerCatalog.help.steps.publish.action', '분석 탭 열기'),
    },
  ], [t])

  const topics = useMemo<TopicConfig[]>(() => [
    {
      id: 'overview',
      title: '빠른 시작',
      description: '처음 운영할 때 따라야 할 전체 순서입니다.',
      icon: <PlayCircleIcon className="h-4 w-4" />,
      actionTab: tutorialSteps[activeStep].tab,
      actionLabel: tutorialSteps[activeStep].action,
      summaryTitle: '현재 단계 핵심',
      summaryBullets: [
        '답변 후보는 바로 서비스되지 않으므로 검토 후 게시합니다.',
        '찾기 힌트와 제외어를 정리한 뒤 테스트 콘솔에서 검증합니다.',
        '운영 중에는 분석 화면에서 답변을 찾지 못한 질문을 보강합니다.',
      ],
    },
    {
      id: 'screens',
      title: '화면 안내',
      description: '각 메뉴가 어떤 작업을 담당하는지 빠르게 확인합니다.',
      icon: <BookOpenIcon className="h-4 w-4" />,
      actionTab: 'answers',
      actionLabel: '답변 조회 열기',
      summaryTitle: '화면을 고르는 기준',
      summaryBullets: [
        '새 자료를 넣을 때는 답변 추가 화면의 빠른 답변 추가에서 시작합니다. Excel은 업로드 후 시트와 컬럼 매핑을 확인합니다.',
        '답변 품질을 다듬을 때는 답변과 답변 항목 설정 화면을 함께 봅니다.',
        '상세 분석에서는 조건 조회 후 요약 카드나 탭을 선택해 세부 목록을 확인합니다.',
      ],
    },
    {
      id: 'matching',
      title: '답변 항목 설정 방식',
      description: '키워드, 벡터, LLM ID 선택의 차이와 사용 순서를 설명합니다.',
      icon: <SearchCheckIcon className="h-4 w-4" />,
      actionTab: 'answer-matching',
      actionLabel: '답변 항목 설정 열기',
      summaryTitle: '권장 사용 순서',
      summaryBullets: [
        '기본값은 빠르고 예측 가능한 키워드 방식입니다.',
        '표현 차이가 큰 질문은 키워드+벡터로 후보를 보강합니다.',
        '후보가 비슷하게 갈릴 때만 LLM ID 선택을 사용합니다.',
      ],
    },
    {
      id: 'testing',
      title: '테스트와 점수',
      description: '테스트 콘솔에서 선택 답변과 후보 점수를 읽는 방법입니다.',
      icon: <GaugeIcon className="h-4 w-4" />,
      actionTab: 'answer-test',
      actionLabel: '테스트 콘솔 열기',
      summaryTitle: '검증할 항목',
      summaryBullets: [
        '질문별 selected_by와 score_details를 함께 확인합니다.',
        '최소 점수 기준을 너무 낮게 두면 오답 선택 위험이 커집니다.',
        '답변을 찾지 못한 질문은 답변 추가 또는 힌트 보강 대상으로 남깁니다.',
      ],
    },
    {
      id: 'detailedAnalytics',
      title: '상세 분석',
      description: '조건 조회, 요약 카드, 탭별 리포트, 이벤트 상세 해석 방법입니다.',
      icon: <BarChart3Icon className="h-4 w-4" />,
      actionTab: 'answer-detailed-analytics',
      actionLabel: '상세 분석 열기',
      summaryTitle: '상세 분석 핵심',
      summaryBullets: [
        '조건을 바꾼 뒤에는 조회 버튼 또는 Enter로 직접 실행합니다.',
        '답변 선택률, 찾은 답변 없음, LLM 선택 비율 카드는 클릭하면 해당 이벤트 목록으로 좁혀집니다.',
        '이벤트 상세에서는 후보 점수보다 주요 근거와 선택 결과를 먼저 봅니다.',
      ],
    },
    {
      id: 'operations',
      title: '운영 관리',
      description: '답변 게시, 소스, 구조화 데이터, 분석 화면의 운영 흐름입니다.',
      icon: <BarChart3Icon className="h-4 w-4" />,
      actionTab: 'answer-analytics',
      actionLabel: '분석 탭 열기',
      summaryTitle: '운영 루틴',
      summaryBullets: [
        '게시 전에는 테스트 콘솔로 대표 질문을 확인합니다.',
        '조회 기록과 답변을 찾지 못한 질문을 기준으로 힌트를 보강합니다.',
        '구조화 데이터는 안전 조회로 조건 검색 품질을 확인합니다.',
      ],
    },
    {
      id: 'glossary',
      title: '용어 찾기',
      description: '자주 쓰는 용어와 점수 이름을 검색합니다.',
      icon: <LibraryIcon className="h-4 w-4" />,
      actionTab: 'answer-help',
      actionLabel: '도움말 유지',
      summaryTitle: '용어를 볼 때',
      summaryBullets: [
        '운영 화면의 용어와 API 응답 필드명을 함께 연결해 이해합니다.',
        '점수 이름은 테스트 콘솔 후보 카드와 같은 기준으로 읽습니다.',
        '헷갈리는 용어는 답변 항목 설정 방식 페이지의 예시와 함께 확인합니다.',
      ],
    },
  ], [activeStep, tutorialSteps])

  const advancedMatchingGuides = useMemo(() => advancedMatchingGuideTemplates.map((guide) => ({
    ...guide,
    title: t(`answerCatalog.help.advanced.${guide.key}.title`, guide.title),
    alt: t(`answerCatalog.help.advanced.${guide.key}.alt`, guide.alt),
    summary: t(`answerCatalog.help.advanced.${guide.key}.summary`, guide.summary),
    bullets: guide.bullets.map((bullet, index) => (
      t(`answerCatalog.help.advanced.${guide.key}.bullets.${index}`, bullet)
    )),
    note: t(`answerCatalog.help.advanced.${guide.key}.note`, guide.note),
  })), [t])

  const filteredTerms = useMemo(() => {
    const query = termQuery.trim().toLowerCase()
    if (!query) return terms
    return terms.filter((item) => (
      item.term.toLowerCase().includes(query) || item.description.toLowerCase().includes(query)
    ))
  }, [termQuery])

  const currentTopic = topics.find((topic) => topic.id === activeTopic) ?? topics[0]
  const currentStep = tutorialSteps[activeStep]
  const goToTab = (tab: AppTab) => useSettingsStore.getState().setCurrentTab(tab)

  const renderTopicContent = () => {
    switch (activeTopic) {
      case 'screens':
        return (
          <ScreensTopic goToTab={goToTab} />
        )
      case 'matching':
        return (
          <MatchingTopic
            advancedMatchingGuides={advancedMatchingGuides}
            goToTab={goToTab}
          />
        )
      case 'testing':
        return (
          <TestingTopic goToTab={goToTab} />
        )
      case 'detailedAnalytics':
        return (
          <DetailedAnalyticsTopic goToTab={goToTab} />
        )
      case 'operations':
        return (
          <OperationsTopic goToTab={goToTab} />
        )
      case 'glossary':
        return (
          <GlossaryTopic
            termQuery={termQuery}
            filteredTerms={filteredTerms}
            onTermQueryChange={setTermQuery}
          />
        )
      case 'overview':
      default:
        return (
          <OverviewTopic
            activeStep={activeStep}
            currentStep={currentStep}
            tutorialSteps={tutorialSteps}
            setActiveStep={setActiveStep}
            goToTab={goToTab}
          />
        )
    }
  }

  return (
    <div className="h-full overflow-auto bg-background lg:overflow-hidden">
      <div className="flex min-h-full flex-col lg:h-full">
        <header className="border-b bg-background px-4 py-4 2xl:px-6">
          <div className="flex w-full flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <HelpCircleIcon className="h-5 w-5 text-emerald-500" />
                <h1 className="text-2xl font-bold">{t('answerCatalog.help.title', 'FAQ 고정답변 도움말')}</h1>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                필요한 주제를 왼쪽에서 선택해 짧게 확인하고, 관련 화면으로 바로 이동할 수 있습니다. 긴 문서형 설명 대신 운영 흐름, 화면 캡처, 점수 해석을 분리했습니다.
              </p>
            </div>
            <Button onClick={() => goToTab(currentTopic.actionTab)}>
              <MousePointerClickIcon className="h-4 w-4" />
              {currentTopic.actionLabel}
            </Button>
          </div>

          <div className="mt-4 grid w-full gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
            {topics.map((topic) => (
              <QuickTopicCard
                key={topic.id}
                topic={topic}
                active={activeTopic === topic.id}
                onClick={() => setActiveTopic(topic.id)}
              />
            ))}
          </div>
        </header>

        <div className="grid w-full flex-1 gap-4 p-4 2xl:p-6 lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_320px] 2xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <aside className="rounded-md border bg-card p-2 lg:min-h-0 lg:overflow-auto">
            <div className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">도움말 목차</div>
            <nav className="grid gap-1">
              {topics.map((topic) => (
                <TopicNavButton
                  key={topic.id}
                  topic={topic}
                  active={activeTopic === topic.id}
                  onClick={() => setActiveTopic(topic.id)}
                />
              ))}
            </nav>
          </aside>

          <main className="min-w-0 overflow-x-hidden overflow-y-auto rounded-md border bg-card lg:min-h-0">
            <div className="p-4 md:p-5">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    {currentTopic.icon}
                    <h2 className="text-xl font-semibold">{currentTopic.title}</h2>
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{currentTopic.description}</p>
                </div>
                <Badge variant="outline">선택한 주제만 표시</Badge>
              </div>
              {renderTopicContent()}
            </div>
          </main>

          <SummaryPanel
            currentTopic={currentTopic}
            currentStep={currentStep}
            goToTab={goToTab}
          />
        </div>
      </div>
    </div>
  )
}

function OverviewTopic({
  activeStep,
  currentStep,
  tutorialSteps,
  setActiveStep,
  goToTab,
}: {
  activeStep: number
  currentStep: GuideStep
  tutorialSteps: GuideStep[]
  setActiveStep: (step: number) => void
  goToTab: (tab: AppTab) => void
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <section className="rounded-md border p-4">
        <SectionTitle
          icon={<ClipboardListIcon className="h-4 w-4" />}
          title="6단계 운영 튜터"
          description="처음 설정하거나 새 답변 묶음을 만들 때는 이 순서대로 확인합니다."
        />
        <div className="mt-4 grid gap-2">
          {tutorialSteps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => setActiveStep(index)}
              className={cn(
                'rounded-md border p-3 text-left transition',
                activeStep === index
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-50'
                  : 'hover:bg-muted/60'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{step.title}</span>
                {activeStep === index && <CheckCircle2Icon className="h-4 w-4" />}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-md border p-4">
        <SectionTitle
          icon={<MousePointerClickIcon className="h-4 w-4" />}
          title={currentStep.title}
          description={currentStep.description}
        />
        <div className="mt-4 rounded-md border bg-muted/30 p-4">
          <ScreenshotMock step={activeStep} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            ['1', '원자료 또는 답변을 준비합니다.'],
            ['2', '운영자가 정책과 답변 항목 설정을 검토합니다.'],
            ['3', '테스트 콘솔과 분석 화면에서 계속 보강합니다.'],
          ].map(([number, text]) => (
            <div key={number} className="rounded-md border bg-background p-3 text-sm leading-6">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">{number}</span>
              {text}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => goToTab(currentStep.tab)}>
            <MousePointerClickIcon className="h-4 w-4" />
            {currentStep.action}
          </Button>
          <Button
            variant="outline"
            onClick={() => setActiveStep(Math.min(activeStep + 1, tutorialSteps.length - 1))}
            disabled={activeStep === tutorialSteps.length - 1}
          >
            다음 단계
          </Button>
        </div>
      </section>
    </div>
  )
}

function ScreensTopic({ goToTab }: { goToTab: (tab: AppTab) => void }) {
  return (
    <div className="grid gap-4">
      <section className="grid gap-4">
        {screenshotGuides.map((guide) => (
          <ScreenGuideCard key={guide.title} guide={guide} goToTab={goToTab} />
        ))}
      </section>

      <section className="rounded-md border bg-muted/20 p-4">
        <SectionTitle
          icon={<InfoIcon className="h-4 w-4" />}
          title="화면을 오가는 기준"
          description="FAQ 워크스페이스에서는 모든 메뉴가 한 흐름으로 연결됩니다."
        />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <FlowCard title="등록" text="답변 추가의 빠른 답변 추가에서 텍스트나 Excel을 미리보고 답변 후보를 만들며, 답변 화면에서 본문과 유효기간을 검토합니다." />
          <FlowCard title="답변 항목 설정" text="답변 항목 설정 화면에서 대표 질문, 동의어, 제외어를 보강하고 벡터를 갱신합니다." />
          <FlowCard title="반복/대량 추가" text="같은 DB, NoSQL, 웹, 테이블 입력을 계속 사용할 때만 반복/대량 추가 설정에 저장합니다." />
        </div>
      </section>
    </div>
  )
}

function MatchingTopic({
  advancedMatchingGuides,
  goToTab,
}: {
  advancedMatchingGuides: Array<{
    title: string
    tab: AppTab
    image: string
    alt: string
    summary: string
    points: string[]
    bullets: string[]
    note: string
  }>
  goToTab: (tab: AppTab) => void
}) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-3 xl:grid-cols-3">
        <MatchingModeCard
          icon={<BadgeCheckIcon className="h-4 w-4" />}
          title="빠른 키워드"
          badge="기본값"
          text="대표 질문, 키워드, 동의어, 제목, 태그를 가중치로 계산합니다. 가장 빠르고 운영자가 예측하기 쉽습니다."
          bestFor="표현이 비교적 고정된 고객센터 FAQ, 메뉴명/상품명처럼 정확한 단어가 중요한 질문"
        />
        <MatchingModeCard
          icon={<SlidersHorizontalIcon className="h-4 w-4" />}
          title="키워드+벡터"
          badge="의미 보강"
          text="키워드 점수에 답변 벡터 유사도를 더해 표현이 다른 질문도 후보로 올립니다."
          bestFor="유심 변경/SIM 교체처럼 같은 뜻을 여러 표현으로 묻는 질문"
        />
        <MatchingModeCard
          icon={<SparklesIcon className="h-4 w-4" />}
          title="LLM ID 선택"
          badge="후보 최종 선택"
          text="LLM은 본문을 만들지 않고, 검색된 후보 답변 ID 중 하나만 선택합니다."
          bestFor="상위 후보 점수가 비슷해 운영 테스트에서 추가 판단이 필요한 질문"
        />
      </section>

      <section className="rounded-md border p-4">
        <SectionTitle
          icon={<SearchCheckIcon className="h-4 w-4" />}
          title="벡터/하이브리드 답변 항목 설정 상세 가이드"
          description="아래 캡처는 실제 테스트 워크스페이스에서 확인한 화면입니다. 번호를 따라 어떤 값을 봐야 하는지 확인하세요."
          trailing={<Badge variant="outline">실제 화면 캡처</Badge>}
        />
        <div className="mt-4 grid gap-5">
          {advancedMatchingGuides.map((guide) => (
            <AnnotatedScreenshotCard key={guide.title} guide={guide} goToTab={goToTab} />
          ))}
        </div>
      </section>

      <section className="rounded-md border bg-muted/20 p-4">
        <SectionTitle
          icon={<FileQuestionIcon className="h-4 w-4" />}
          title="자주 발생하는 상황"
          description="답변 항목 선택 결과가 기대와 다를 때는 아래 순서로 조정하는 것이 좋습니다."
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TroubleshootingItem title="엉뚱한 답변이 선택됩니다" text="먼저 제외어를 추가하고, 대표 질문을 더 구체적으로 분리합니다. 그 다음 동의어를 보강합니다." />
          <TroubleshootingItem title="표현이 다르면 답변을 못 찾습니다" text="키워드+벡터 모드로 테스트하고, 벡터 점수가 낮으면 대표 질문과 요약 문장을 보강한 뒤 벡터를 갱신합니다." />
          <TroubleshootingItem title="LLM ID 선택이 느립니다" text="모든 요청에 쓰지 말고 후보가 애매한 질문에만 사용합니다. top-k와 후보 수를 줄이면 지연을 낮출 수 있습니다." />
          <TroubleshootingItem title="후보가 전혀 없습니다" text="답변이 게시 상태인지, 유효기간이 맞는지, 최소 점수가 너무 높지 않은지 확인합니다." />
        </div>
      </section>
    </div>
  )
}

function TestingTopic({ goToTab }: { goToTab: (tab: AppTab) => void }) {
  return (
    <div className="grid gap-5">
      <section className="rounded-md border p-4">
        <SectionTitle
          icon={<GaugeIcon className="h-4 w-4" />}
          title="테스트 콘솔에서 보는 순서"
          description="질문을 넣은 뒤 선택 답변만 보지 말고 후보 점수와 선택 방식을 함께 확인합니다."
        />
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {[
            ['질문 입력', '운영에서 실제 들어올 문장으로 테스트합니다.'],
            ['조회 방식', '키워드, 키워드+벡터, LLM ID 선택을 비교합니다.'],
            ['최소 점수', '오답을 줄이려면 기준을 너무 낮게 두지 않습니다.'],
            ['후보 확인', '선택된 답변 외의 상위 후보도 같이 봅니다.'],
            ['점수 상세', 'keyword/vector/hybrid 점수와 selected_by를 확인합니다.'],
          ].map(([title, text], index) => (
            <div key={title} className="rounded-md border bg-background p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">{index + 1}</span>
                <span className="text-sm font-semibold">{title}</span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
        <Button className="mt-4" onClick={() => goToTab('answer-test')}>
          <MousePointerClickIcon className="h-4 w-4" />
          테스트 콘솔 열기
        </Button>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ScoreHint icon={<BadgeCheckIcon className="h-4 w-4" />} title="키워드 점수" text="대표 질문 또는 핵심 키워드가 잘 맞는 경우입니다. 기본값이며 가장 빠르고 예측하기 쉽습니다." />
        <ScoreHint icon={<SlidersHorizontalIcon className="h-4 w-4" />} title="벡터 점수" text="표현은 다르지만 의미가 비슷한 후보를 보강합니다. 벡터 갱신 후 하이브리드 모드에서 확인합니다." />
        <ScoreHint icon={<FileInputIcon className="h-4 w-4" />} title="LLM ID 선택" text="후보가 여러 개 비슷할 때만 사용합니다. LLM은 후보 ID만 선택하고 본문을 새로 만들지 않습니다." />
        <ScoreHint icon={<SearchCheckIcon className="h-4 w-4" />} title="찾은 답변 없음" text="정답 후보가 없으면 답변 후보를 추가하거나 기존 답변의 대표 질문, 동의어, 제외어를 보강합니다." />
      </section>
    </div>
  )
}

function DetailedAnalyticsTopic({ goToTab }: { goToTab: (tab: AppTab) => void }) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-4 rounded-md border bg-background p-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="min-w-0 overflow-hidden rounded-md border bg-muted/20">
          <img
            src={`${webuiPrefix}help/answer-catalog/detailed-analytics-screen.png`}
            alt="상세 분석 화면 캡처"
            className="h-auto w-full object-contain"
            loading="lazy"
          />
        </div>
        <div className="min-w-0">
          <SectionTitle
            icon={<BarChart3Icon className="h-4 w-4" />}
            title="상세 분석 화면을 읽는 순서"
            description="조회 조건을 먼저 확정한 뒤, 요약 카드와 탭을 선택해 오른쪽 이벤트 목록을 확인합니다."
            trailing={<Badge variant="outline">조건 기반 조회</Badge>}
          />
          <div className="mt-4 grid gap-3">
            <AnalyticsHelpItem
              number="1"
              title="조건 영역"
              text="1행에는 기간, 시작일, 종료일, 기록 유형, 답변 항목 선택 결과, 소스, 최소 신뢰도, 최대 응답시간이 있습니다. 2행에는 모드, 검색어, 조건 초기화, 조회 버튼이 있습니다."
            />
            <AnalyticsHelpItem
              number="2"
              title="수동 조회"
              text="조건을 바꿔도 즉시 조회하지 않습니다. 조회 버튼을 누르거나 검색어 입력 중 Enter를 눌러야 결과가 갱신됩니다."
            />
            <AnalyticsHelpItem
              number="3"
              title="요약 카드 선택"
              text="답변 선택률, 찾은 답변 없음, LLM 선택 비율 카드는 클릭 가능한 필터입니다. 선택하면 해당 조건에 맞는 이벤트 목록만 오른쪽에 표시됩니다."
            />
            <AnalyticsHelpItem
              number="4"
              title="탭별 리포트"
              text="답변별, 질문별, 소스별, 조회 방식, 시간대, 실패 분석 탭을 바꾸면 같은 조회 조건을 다른 기준으로 묶어 봅니다."
            />
          </div>
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-5 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-50">
            <span className="font-semibold">예시: </span>
            최근 7일을 선택하고 찾은 답변 없음 카드를 누른 뒤 조회하면, 답변을 찾지 못한 질문만 모아 새 답변 또는 찾기 힌트 보강 대상으로 검토할 수 있습니다.
          </div>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => goToTab('answer-detailed-analytics')}>
            <MousePointerClickIcon className="h-4 w-4" />
            상세 분석 열기
          </Button>
        </div>
      </section>

      <section className="grid gap-4 rounded-md border bg-background p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="min-w-0">
          <SectionTitle
            icon={<MousePointerClickIcon className="h-4 w-4" />}
            title="이벤트 상세 팝업 해석"
            description="목록의 이벤트를 클릭하면 한 번의 질문 처리 결과를 운영자가 읽기 쉬운 구조로 확인합니다."
            trailing={<Badge variant="outline">상세 근거</Badge>}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <FlowCard title="기본 정보" text="기록 유형, 신뢰도, 평균 응답 시간, 후보 수를 먼저 봅니다. 운영 품질을 빠르게 판단하는 요약 값입니다." />
            <FlowCard title="사용자 질문" text="실제 입력된 문장입니다. 동일 의미의 다른 표현이 반복되면 대표 질문이나 동의어를 보강합니다." />
            <FlowCard title="선택된 답변" text="최종 선택된 답변 ID와 제목입니다. 게시 상태와 유효기간이 맞는지도 함께 확인합니다." />
            <FlowCard title="후보 답변" text="후보별 최종 점수와 주요 근거만 먼저 보여줍니다. 태그, 메타데이터 같은 세부 정보는 필요할 때 펼쳐 확인합니다." />
          </div>
          <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            후보 목록의 점수는 운영자가 원인을 파악하기 위한 진단 값입니다. 일반 사용자가 이해해야 하는 값이 아니므로, 도움말에서는 “왜 이 답변이 후보가 되었는지”를 주요 근거 중심으로 설명합니다.
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-md border bg-muted/20">
          <img
            src={`${webuiPrefix}help/answer-catalog/detailed-analytics-event-detail.png`}
            alt="상세 분석 이벤트 상세 팝업 캡처"
            className="h-auto w-full object-contain"
            loading="lazy"
          />
        </div>
      </section>

      <section className="rounded-md border bg-muted/20 p-4">
        <SectionTitle
          icon={<SearchCheckIcon className="h-4 w-4" />}
          title="운영에서 자주 쓰는 조회 패턴"
          description="상세 분석은 단순 통계보다 조건을 좁혀 원인을 찾는 용도로 사용하는 것이 좋습니다."
        />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <ChecklistItem title="답변을 찾지 못한 질문 찾기" text="답변 항목 선택 결과를 찾은 답변 없음으로 두고 조회합니다. 반복 질문은 새 답변 후보 또는 기존 답변의 대표 질문 후보입니다." />
          <ChecklistItem title="느린 요청 찾기" text="최대 응답시간을 지정해 기준보다 느린 이벤트를 제외하거나, 값 없이 조회해 평균 응답 시간이 높은 모드와 소스를 확인합니다." />
          <ChecklistItem title="LLM 사용 점검" text="조회 방식 또는 LLM 선택 비율 카드를 통해 LLM ID 선택이 과도하게 사용되는지 확인합니다." />
        </div>
      </section>
    </div>
  )
}

function OperationsTopic({ goToTab }: { goToTab: (tab: AppTab) => void }) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {featureGuides.map((item) => (
          <div key={item.title} className="rounded-md border p-4">
            <div className="text-sm font-semibold">{item.title}</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.purpose}</p>
            <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">{item.when}</div>
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/70 p-2 text-xs leading-5 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-50">
              <span className="font-semibold">예시: </span>
              {item.example}
            </div>
            <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => goToTab(item.tab)}>
              이동
            </Button>
          </div>
        ))}
      </section>

      <section className="rounded-md border bg-muted/20 p-4">
        <SectionTitle
          icon={<WorkflowIcon className="h-4 w-4" />}
          title="운영 체크리스트"
          description="운영 중에는 답변 품질과 사용 현황을 함께 봐야 합니다."
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ChecklistItem title="게시 전 검증" text="대표 질문 5개 이상을 테스트 콘솔에서 확인하고, 표시 방식과 유효기간을 점검합니다." />
          <ChecklistItem title="답변을 찾지 못한 질문 관리" text="분석 화면에서 답변을 찾지 못한 질문을 보고 새 답변 또는 찾기 힌트를 추가합니다." />
          <ChecklistItem title="구조화 데이터 활용" text="표 형태의 원자료는 구조 분석 결과를 확인하고 안전 조회로 조건 검색을 검증합니다." />
          <ChecklistItem title="변경 이력 관리" text="답변을 수정한 뒤 문제가 생기면 변경 이력에서 이전 버전으로 복구합니다." />
        </div>
      </section>
    </div>
  )
}

function ScreenGuideCard({
  guide,
  goToTab,
}: {
  guide: typeof screenshotGuides[number]
  goToTab: (tab: AppTab) => void
}) {
  return (
    <article className="grid min-w-0 gap-4 rounded-md border bg-background p-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted/20">
        <img
          src={`${webuiPrefix}${guide.image}`}
          alt={`${guide.title} 화면 캡처`}
          className="aspect-video h-full w-full object-cover object-top"
          loading="lazy"
        />
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{guide.title}</h3>
          <Badge variant="outline">화면 캡처</Badge>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{guide.caption}</p>

        <div className="mt-3 grid gap-2">
          {guide.points.map((point, index) => (
            <div key={point} className="flex items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-semibold text-white">{index + 1}</span>
              <span>{point}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-5 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-50">
          <span className="font-semibold">예시: </span>
          {guide.example}
        </div>

        <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => goToTab(guide.tab)}>
          <MousePointerClickIcon className="h-4 w-4" />
          화면 열기
        </Button>
      </div>
    </article>
  )
}

function GlossaryTopic({
  termQuery,
  filteredTerms,
  onTermQueryChange,
}: {
  termQuery: string
  filteredTerms: typeof terms
  onTermQueryChange: (value: string) => void
}) {
  return (
    <div className="grid gap-5">
      <section className="rounded-md border p-4">
        <SectionTitle
          icon={<LibraryIcon className="h-4 w-4" />}
          title="용어 검색"
          description="화면에서 보이는 용어와 테스트 결과 필드명을 빠르게 찾아볼 수 있습니다."
        />
        <div className="relative mt-4">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={termQuery}
            onChange={(event) => onTermQueryChange(event.target.value)}
            placeholder="예: 벡터, selected_by, 신뢰도"
            className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredTerms.map((item) => (
          <div key={item.term} className="rounded-md border p-4">
            <div className="text-sm font-semibold">{item.term}</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
          </div>
        ))}
      </section>
    </div>
  )
}

function SummaryPanel({
  currentTopic,
  currentStep,
  goToTab,
}: {
  currentTopic: TopicConfig
  currentStep: GuideStep
  goToTab: (tab: AppTab) => void
}) {
  return (
    <aside className="rounded-md border bg-card p-4 lg:min-h-0 lg:overflow-auto">
      <div className="flex items-center gap-2">
        <InfoIcon className="h-4 w-4 text-emerald-500" />
        <h3 className="font-semibold">{currentTopic.summaryTitle}</h3>
      </div>
      <div className="mt-4 grid gap-3">
        {currentTopic.summaryBullets.map((item) => (
          <div key={item} className="flex gap-2 text-sm leading-6">
            <CheckCircle2Icon className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-md border bg-muted/20 p-3">
        <div className="text-xs font-medium text-muted-foreground">현재 튜터 단계</div>
        <div className="mt-1 text-sm font-semibold">{currentStep.title}</div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{currentStep.description}</p>
      </div>

      <div className="mt-5 grid gap-2">
        <Button onClick={() => goToTab(currentTopic.actionTab)}>
          <MousePointerClickIcon className="h-4 w-4" />
          {currentTopic.actionLabel}
        </Button>
        <Button variant="outline" onClick={() => goToTab(currentStep.tab)}>
          <ArrowRightIcon className="h-4 w-4" />
          튜터 단계 화면 열기
        </Button>
      </div>
    </aside>
  )
}

function QuickTopicCard({
  topic,
  active,
  onClick,
}: {
  topic: TopicConfig
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border bg-card p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20',
        active && 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-50'
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {topic.icon}
        {topic.title}
      </div>
      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{topic.description}</p>
    </button>
  )
}

function TopicNavButton({
  topic,
  active,
  onClick,
}: {
  topic: TopicConfig
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted',
        active && 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-50'
      )}
    >
      <span className="mt-0.5 shrink-0">{topic.icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{topic.title}</span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">{topic.description}</span>
      </span>
    </button>
  )
}

function AnnotatedScreenshotCard({
  guide,
  goToTab,
}: {
  guide: {
    title: string
    tab: AppTab
    image: string
    alt: string
    summary: string
    points: string[]
    bullets: string[]
    note: string
  }
  goToTab: (tab: AppTab) => void
}) {
  return (
    <article className="grid gap-4 rounded-md border bg-background p-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted/20">
        <img
          src={`${webuiPrefix}${guide.image}`}
          alt={guide.alt}
          className="h-auto w-full object-contain"
          loading="lazy"
        />
      </div>
      <div className="min-w-0">
        <h3 className="text-base font-semibold">{guide.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{guide.summary}</p>

        <div className="mt-4 grid gap-2">
          {guide.points.map((point, index) => (
            <div key={point} className="flex items-start gap-2 rounded-md border bg-muted/20 p-2 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">{index + 1}</span>
              <span>{point}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {guide.bullets.map((bullet) => (
            <div key={bullet} className="flex gap-2 text-sm leading-6">
              <CheckCircle2Icon className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
              <span>{bullet}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          {guide.note}
        </div>
        <Button className="mt-4" variant="outline" size="sm" onClick={() => goToTab(guide.tab)}>
          <MousePointerClickIcon className="h-4 w-4" />
          관련 화면 열기
        </Button>
      </div>
    </article>
  )
}

function MatchingModeCard({
  icon,
  title,
  badge,
  text,
  bestFor,
}: {
  icon: ReactNode
  title: string
  badge: string
  text: string
  bestFor: string
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {icon}
          <span className="break-keep">{title}</span>
        </div>
        <Badge variant="outline">{badge}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
      <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        <span className="font-medium text-foreground">적합한 경우: </span>
        {bestFor}
      </div>
    </div>
  )
}

function SectionTitle({
  icon,
  title,
  description,
  trailing,
}: {
  icon: ReactNode
  title: string
  description: string
  trailing?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-semibold">{title}</h3>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {trailing}
    </div>
  )
}

function FlowCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  )
}

function AnalyticsHelpItem({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">{number}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  )
}

function TroubleshootingItem({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <FileQuestionIcon className="h-4 w-4 text-amber-500" />
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  )
}

function ChecklistItem({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  )
}

function ScreenshotMock({ step }: { step: number }) {
  const labels = [
    ['입력 선택', '미리보기', '후보 검토'],
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
