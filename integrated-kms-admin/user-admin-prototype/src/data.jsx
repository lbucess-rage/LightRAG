// data.jsx — mock data for the integrated KMS admin (contact-center / BPO scenario)

const CATEGORIES = [
  { id: 'c1', parent: null, name: '주문·결제', path: '주문·결제', count: 142, active: true },
  { id: 'c1a', parent: 'c1', name: '결제수단', path: '주문·결제/결제수단', count: 38, active: true },
  { id: 'c1b', parent: 'c1', name: '결제오류', path: '주문·결제/결제오류', count: 24, active: true },
  { id: 'c2', parent: null, name: '배송', path: '배송', count: 96, active: true },
  { id: 'c2a', parent: 'c2', name: '배송조회', path: '배송/배송조회', count: 41, active: true },
  { id: 'c2b', parent: 'c2', name: '배송지연', path: '배송/배송지연', count: 33, active: true },
  { id: 'c3', parent: null, name: '환불·교환', path: '환불·교환', count: 118, active: true },
  { id: 'c3a', parent: 'c3', name: '환불정책', path: '환불·교환/환불정책', count: 52, active: true },
  { id: 'c3b', parent: 'c3', name: '교환절차', path: '환불·교환/교환절차', count: 29, active: true },
  { id: 'c4', parent: null, name: '요금·청구', path: '요금·청구', count: 74, active: true },
  { id: 'c4a', parent: 'c4', name: '요금제', path: '요금·청구/요금제', count: 31, active: true },
  { id: 'c5', parent: null, name: '회원·계정', path: '회원·계정', count: 63, active: true },
  { id: 'c6', parent: null, name: '단종(레거시)', path: '단종(레거시)', count: 12, active: false },
];

const KNOWLEDGE = [
  { id: 'k1', type: 'faq', title: '환불은 언제 처리되나요?', cat: 'c3a', status: 'ready', enabled: true, ws: 'cs-faq', from: '2026.01.01', until: '2026.12.31', updated: '2026.06.08 14:22', keywords: ['환불', '처리기간', '카드취소'], hits: 1284, owner: '김상담' },
  { id: 'k2', type: 'text', source: 'upload', title: '2026 상반기 배송정책 개정안.pdf', cat: 'c2', status: 'ready', enabled: true, ws: 'cs-kms', from: '2026.03.01', until: null, updated: '2026.06.07 09:10', keywords: ['배송', '도서산간', '추가운임'], hits: 642, owner: '이지식', docs: 1, chunks: 38, entities: 71 },
  { id: 'k3', type: 'faq', title: '결제가 중복으로 됐어요', cat: 'c1b', status: 'ready', enabled: true, ws: 'cs-faq', from: '2026.01.01', until: null, updated: '2026.06.06 17:40', keywords: ['중복결제', '환불', '승인취소'], hits: 921, owner: '김상담' },
  { id: 'k4', type: 'text', source: 'multimodal', title: '요금제 안내 매뉴얼 v3.docx', cat: 'c4a', status: 'processing', enabled: false, ws: 'cs-kms', from: '2026.06.01', until: null, updated: '2026.06.09 10:02', keywords: ['요금제', '약정', '할인'], hits: 0, owner: '박운영', docs: 1, chunks: 0, entities: 0 },
  { id: 'k5', type: 'faq', title: '배송 조회는 어디서 하나요?', cat: 'c2a', status: 'ready', enabled: true, ws: 'cs-faq', from: '2026.01.01', until: null, updated: '2026.06.05 11:15', keywords: ['배송조회', '송장번호', '택배사'], hits: 1772, owner: '김상담' },
  { id: 'k6', type: 'faq', title: '회원 탈퇴 후 재가입이 가능한가요?', cat: 'c5', status: 'ready', enabled: true, ws: 'cs-faq', from: '2026.01.01', until: '2026.06.30', updated: '2026.06.02 16:30', keywords: ['탈퇴', '재가입', '개인정보'], hits: 410, owner: '최지원' },
  { id: 'k7', type: 'text', source: 'url', title: '카드 결제 오류코드 대응 가이드', cat: 'c1b', status: 'error', enabled: false, ws: 'cs-kms', from: '2026.05.01', until: null, updated: '2026.06.09 09:48', keywords: ['결제오류', '오류코드', 'PG'], hits: 0, owner: '박운영', docs: 1, chunks: 12, entities: 0 },
  { id: 'k8', type: 'faq', title: '교환 신청 절차가 궁금합니다', cat: 'c3b', status: 'review', enabled: false, ws: 'cs-faq', from: '2026.06.10', until: null, updated: '2026.06.09 08:20', keywords: ['교환', '반품', '회수'], hits: 0, owner: '최지원' },
  { id: 'k9', type: 'faq', title: '무통장입금 입금자명이 다를 때', cat: 'c1a', status: 'ready', enabled: true, ws: 'cs-faq', from: '2026.01.01', until: null, updated: '2026.05.30 13:05', keywords: ['무통장', '입금확인', '가상계좌'], hits: 588, owner: '김상담' },
  { id: 'k10', type: 'text', source: 'board', title: '도서산간 배송비 산정표 2026', cat: 'c2b', status: 'ready', enabled: true, ws: 'cs-kms', from: '2026.01.01', until: '2026.12.31', updated: '2026.05.28 10:00', keywords: ['도서산간', '배송비', '제주'], hits: 233, owner: '이지식', docs: 1, chunks: 22, entities: 44 },
  { id: 'k11', type: 'faq', title: '결제 영수증·현금영수증 발급', cat: 'c4', status: 'ready', enabled: true, ws: 'cs-faq', from: '2026.01.01', until: null, updated: '2026.05.25 15:40', keywords: ['영수증', '현금영수증', '세금계산서'], hits: 339, owner: '최지원' },
  { id: 'k12', type: 'faq', title: '환불 계좌를 변경하고 싶어요', cat: 'c3a', status: 'ready', enabled: true, ws: 'cs-faq', from: '2026.01.01', until: null, updated: '2026.05.20 09:12', keywords: ['환불계좌', '계좌변경', '본인인증'], hits: 461, owner: '김상담' },
];

const catName = (id) => (CATEGORIES.find((c) => c.id === id) || {}).path || '미지정';

const SOURCE_LABELS = {
  faq: 'FAQ 답변', text: '단일 텍스트', texts: '다중 텍스트', upload: '문서 업로드',
  url: 'URL', 'url-batch': 'URL 일괄', board: 'Board API', multimodal: '멀티모달', 'quick-image': '이미지', scan: 'Input Scan',
};
const sourceOf = (item) => item.source || (item.type === 'faq' ? 'faq' : 'upload');

const ROLES = {
  admin:   { label: '시스템 관리자', tone: 'blue',  allWs: true,  nav: 'all', desc: '전체 기능 + 사용자·API·시스템 관리' },
  manager: { label: '지식 관리자', tone: 'green', allWs: false, nav: ['search', 'knowledge', 'categories', 'stats', 'jobs'], desc: '지식 관리·카테고리·현황·작업이력' },
  viewer:  { label: '지식 조회자', tone: 'gray',  allWs: false, nav: ['search'], desc: '통합 검색 조회 전용' },
};

const USERS = [
  { id: 'admin', name: '시스템 관리자', role: 'admin', active: true, kms: 'cs-kms', faq: 'cs-faq', last: '2026.06.09 09:31', created: '2025.11.02' },
  { id: 'ejisik', name: '이지식', role: 'manager', active: true, kms: 'cs-kms', faq: 'cs-faq', last: '2026.06.08 18:20', created: '2026.02.03' },
  { id: 'pwoonyoung', name: '박운영', role: 'manager', active: true, kms: 'ops-kms', faq: 'ops-faq', last: '2026.06.09 10:02', created: '2026.03.21' },
  { id: 'ksangdam', name: '김상담', role: 'viewer', active: true, kms: 'cs-kms', faq: 'cs-faq', last: '2026.06.09 08:55', created: '2026.01.15' },
  { id: 'cjiwon', name: '최지원', role: 'viewer', active: true, kms: 'cs-kms', faq: 'cs-faq', last: '2026.06.07 14:48', created: '2026.04.10' },
  { id: 'leaver01', name: '퇴사자A', role: 'viewer', active: false, kms: 'cs-kms', faq: 'cs-faq', last: '2026.05.02 11:00', created: '2025.12.01' },
];

const USER_HISTORY = [
  { t: '2026.06.09 09:31', action: '로그인', target: '-', ip: '10.20.1.14' },
  { t: '2026.06.09 09:33', action: '통합 검색', target: '"환불 처리 기간"', ip: '10.20.1.14' },
  { t: '2026.06.09 09:40', action: '지식 수정', target: 'k1 · 환불은 언제 처리되나요?', ip: '10.20.1.14' },
  { t: '2026.06.09 09:41', action: '재지식화 실행', target: 'k1 · job#a93f', ip: '10.20.1.14' },
  { t: '2026.06.09 09:55', action: '사용자 생성', target: 'cjiwon', ip: '10.20.1.14' },
  { t: '2026.06.09 10:10', action: 'API Key 발급', target: 'CRM 연동', ip: '10.20.1.14' },
];

const API_CLIENTS = [
  { id: 'cl1', name: '상담사 CRM 연동', hint: 'kmsadm_••••••8f3a', active: true, kms: 'cs-kms', faq: 'cs-faq', scopes: ['search'], rate: 240, last: '2026.06.09 10:11', calls: 18422 },
  { id: 'cl2', name: '챗봇 (홈페이지)', hint: 'kmsadm_••••••1c7d', active: true, kms: 'cs-kms', faq: 'cs-faq', scopes: ['search'], rate: 600, last: '2026.06.09 10:09', calls: 91038 },
  { id: 'cl3', name: '사내 위키 사이드바', hint: 'kmsadm_••••••44b1', active: false, kms: 'ops-kms', faq: 'ops-faq', scopes: ['search'], rate: 60, last: '2026.05.21 17:30', calls: 1204 },
];

const JOBS = [
  { id: 'j1', title: '환불은 언제 처리되나요?', type: 're-ingest', status: 'success', progress: 100, rollback: null, msg: '재지식화 완료 · 청크 6, 엔티티 11 갱신', when: '2026.06.09 09:41', by: 'admin', steps: ['검증', '임베딩', '그래프 갱신', '인덱스 반영'] },
  { id: 'j2', title: '요금제 안내 매뉴얼 v3.docx', type: 'ingest-text', status: 'running', progress: 62, rollback: null, msg: '엔티티-관계 추출 중… (24/38 청크)', when: '2026.06.09 10:02', by: 'pwoonyoung', steps: ['업로드', '청크 분할', '임베딩', '그래프 추출', '인덱스 반영'] },
  { id: 'j3', title: '카드 결제 오류코드 대응 가이드', type: 'ingest-text', status: 'failed', progress: 38, rollback: 'done', msg: 'LightRAG /documents/text 504 timeout · 롤백 완료', when: '2026.06.09 09:48', by: 'pwoonyoung', steps: ['업로드', '청크 분할', '임베딩', '그래프 추출', '인덱스 반영'] },
  { id: 'j4', title: '교환 신청 절차가 궁금합니다', type: 'faq-publish', status: 'success', progress: 100, rollback: null, msg: 'FAQ 답변 게시 · 벡터 인덱스 반영', when: '2026.06.08 17:55', by: 'cjiwon', steps: ['검수', '게시', '벡터 반영'] },
  { id: 'j5', title: '도서산간 배송비 산정표 2026', type: 're-ingest', status: 'rolledback', progress: 70, rollback: 'done', msg: '관리자 중단 요청 · 이전 버전으로 롤백', when: '2026.06.08 11:20', by: 'admin', steps: ['검증', '임베딩', '그래프 갱신', '인덱스 반영'] },
];

const STATS = {
  kpis: [
    { k: '총 지식 수', v: '1,420', u: '건', d: '+38', up: true, ic: 'database' },
    { k: '오늘 검색', v: '3,182', u: '회', d: '+12%', up: true, ic: 'search' },
    { k: 'AI 답변 채택률', v: '87.4', u: '%', d: '+2.1%', up: true, ic: 'sparkles' },
    { k: '평균 응답', v: '1.4', u: '초', d: '-0.2s', up: true, ic: 'clock' },
  ],
  byDate: [
    { label: '6/3', count: 2410 }, { label: '6/4', count: 2680 }, { label: '6/5', count: 2900 },
    { label: '6/6', count: 2210 }, { label: '6/7', count: 1980 }, { label: '6/8', count: 2740 }, { label: '6/9', count: 3182 },
  ],
  byHour: [
    { label: '0', count: 120 }, { label: '3', count: 60 }, { label: '6', count: 180 }, { label: '9', count: 880 },
    { label: '11', count: 1240 }, { label: '13', count: 1100 }, { label: '15', count: 1320 }, { label: '17', count: 940 },
    { label: '19', count: 520 }, { label: '21', count: 360 }, { label: '23', count: 210 },
  ],
  byCategory: [
    { label: '환불·교환', count: 4120, color: '#2563eb' },
    { label: '배송', count: 3380, color: '#7a8ba0' },
    { label: '주문·결제', count: 2940, color: '#16a34a' },
    { label: '요금·청구', count: 1680, color: '#d97706' },
    { label: '회원·계정', count: 1120, color: '#bcc6da' },
  ],
  keywords: [
    { label: '환불 기간', count: 842, trend: 'up' }, { label: '배송 조회', count: 731, trend: 'up' },
    { label: '중복 결제', count: 522, trend: 'flat' }, { label: '교환 절차', count: 488, trend: 'up' },
    { label: '현금영수증', count: 401, trend: 'down' }, { label: '요금제 변경', count: 377, trend: 'up' },
    { label: '도서산간 배송비', count: 290, trend: 'flat' }, { label: '계좌 변경', count: 244, trend: 'down' },
  ],
};

// integrated search demo result
const SEARCH_DEMO = {
  query: '환불은 보통 며칠 걸리나요?',
  ai: '카드 결제 환불은 **영업일 기준 3~5일** 이내에 처리됩니다. 환불 요청이 승인되면 결제하신 카드사로 승인 취소가 접수되며, 실제 반영 시점은 카드사 정산 일정에 따라 다소 차이가 있을 수 있습니다.\n\n- **카드 결제**: 영업일 기준 3~5일\n- **무통장입금(가상계좌)**: 영업일 기준 1~2일\n\n환불은 등록된 환불 계좌로 입금되며, 진행 중에는 계좌 변경이 제한됩니다.',
  aiCites: [
    { id: 'k1', title: '환불은 언제 처리되나요?', cat: '환불·교환/환불정책' },
    { id: 'k12', title: '환불 계좌를 변경하고 싶어요', cat: '환불·교환/환불정책' },
  ],
  aiRefs: [
    { label: '환불 처리 흐름도', src: 'ph:flow' },
    { label: '카드사 승인취소 안내', src: 'ph:card' },
  ],
  keywords: ['환불 처리기간', '카드 승인취소', '가상계좌 환불', '영업일'],
  faq: [
    { id: 'k1', title: '환불은 언제 처리되나요?', cat: '환불·교환/환불정책', format: 'markdown', body: '## 환불 처리 기간\n\n- **카드 결제**: 영업일 기준 3~5일\n- **무통장입금**: 영업일 기준 1~2일\n\n카드사 정산 일정에 따라 반영이 지연될 수 있습니다.\n\n![환불 처리 흐름도](ph:flow)', score: 0.94, keywords: ['환불', '처리기간'], hits: 1284, images: [{ label: '환불 처리 흐름도', src: 'ph:flow' }] },
    { id: 'k12', title: '환불 계좌를 변경하고 싶어요', cat: '환불·교환/환불정책', format: 'markdown', body: '마이페이지 > **환불계좌 관리**에서 본인인증 후 변경할 수 있습니다. 환불이 진행 중인 경우 변경이 제한됩니다.', score: 0.81, keywords: ['환불계좌', '계좌변경'], hits: 461, images: [{ label: '환불계좌 변경 화면', src: 'ph:screen' }] },
    { id: 'k3', title: '결제가 중복으로 됐어요', cat: '주문·결제/결제오류', format: 'text', body: '중복 승인 건은 자동 감지되어 익영업일 내 승인 취소됩니다. 취소 후 카드사 반영까지 3~5일이 소요됩니다.', score: 0.66, keywords: ['중복결제', '승인취소'], hits: 921, images: [] },
  ],
};

// generative KMS explore: doc -> chunks -> entities/relations
const KMS_DOC = {
  docId: 'doc-2f8a91',
  title: '2026 상반기 배송정책 개정안.pdf',
  status: 'processed',
  chunks: 38, tokens: 18420, created: '2026.06.07 09:10',
  chunkList: [
    { id: 'chunk-0', order: 1, tokens: 512, text: '제1조 (목적) 본 정책은 도서·산간 지역 배송 및 추가 운임 부과 기준을 정의한다. 기존 정책 대비 제주 지역 추가운임이 3,000원에서 3,500원으로 조정된다.' },
    { id: 'chunk-1', order: 2, tokens: 498, text: '제2조 (배송 지연 보상) 천재지변을 제외한 사유로 배송이 3영업일 이상 지연될 경우, 주문 금액의 5%를 적립금으로 보상한다.' },
    { id: 'chunk-2', order: 3, tokens: 530, text: '제3조 (반품 회수) 단순 변심 반품의 경우 회수 운임은 고객 부담이며, 상품 하자 시 당사 부담으로 처리한다.' },
  ],
  entities: [
    { name: '제주 추가운임', type: '정책항목', deg: 5 },
    { name: '도서산간 배송', type: '서비스', deg: 8 },
    { name: '배송 지연 보상', type: '정책항목', deg: 4 },
    { name: '적립금', type: '보상수단', deg: 3 },
    { name: '반품 회수 운임', type: '비용', deg: 4 },
  ],
  relations: [
    { src: '도서산간 배송', rel: '추가운임 부과', tgt: '제주 추가운임' },
    { src: '배송 지연 보상', rel: '보상수단', tgt: '적립금' },
    { src: '반품 회수 운임', rel: '귀책사유에 따라', tgt: '도서산간 배송' },
  ],
  multimodal: {
    images: [
      { label: '배송 권역 지도', src: 'ph:map' },
      { label: '운임 비교 도표', src: 'ph:chart' },
      { label: '반품 회수 흐름도', src: 'ph:flow2' },
    ],
    tables: [
      { caption: '권역별 추가 운임 (개정)', head: ['권역', '기존', '개정', '증감'], rows: [['제주', '3,000원', '3,500원', '+500'], ['도서산간', '4,000원', '4,500원', '+500'], ['일반', '0원', '0원', '—']] },
    ],
    formulas: [
      { label: '총 배송비 산정', tex: '배송비 = 기본운임 + Σ ( 권역별 추가운임 × 박스 수 )' },
      { label: '지연 보상 적립', tex: '적립금 = 주문금액 × 0.05   ( 지연 3영업일 이상 )' },
    ],
  },
};

// FAQ answer item detail
const FAQ_ITEM = {
  id: 'k1', answerId: 'ans-c81f',
  title: '환불은 언제 처리되나요?',
  status: 'published',
  cat: 'c3a',
  format: 'markdown',
  body: '## 환불 처리 기간\n\n결제 수단에 따라 처리 기간이 다릅니다.\n\n- **카드 결제**: 영업일 기준 **3~5일**\n- **무통장입금(가상계좌)**: 영업일 기준 **1~2일**\n\n환불 요청 승인 후 카드사로 승인 취소가 접수되며, 실제 반영 시점은 카드사 정산 일정에 따라 차이가 있을 수 있습니다.\n\n![환불 처리 흐름도](ph:flow)\n\n자세한 내용은 [환불 정책 페이지](https://help.example.com/refund)를 참고하세요.',
  images: [{ label: '환불 처리 흐름도', src: 'ph:flow' }],
  summary: '카드: 영업일 3~5일 / 무통장: 1~2일. 카드사 정산에 따라 지연 가능.',
  guidance: ['"언제까지 환불되나요" 와 같이 기간을 묻는 질문에 우선 매칭', '결제수단(카드/무통장)을 먼저 확인하도록 안내', '5일 초과 시 결제오류 카테고리로 에스컬레이션'],
  tags: ['환불', '처리기간', '카드취소', '가상계좌'],
  variants: ['환불 며칠 걸려요', '환불 언제 들어와요', '카드 취소 얼마나 걸리나요', '입금 환불 기간'],
  from: '2026.01.01', until: '2026.12.31',
  vectorStatus: 'indexed', vectorAt: '2026.06.08 14:23',
};

Object.assign(window, {
  CATEGORIES, KNOWLEDGE, catName, SOURCE_LABELS, sourceOf, ROLES, USERS, USER_HISTORY, API_CLIENTS, JOBS, STATS,
  SEARCH_DEMO, KMS_DOC, FAQ_ITEM,
});
