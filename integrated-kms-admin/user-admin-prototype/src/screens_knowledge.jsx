// screens_knowledge.jsx — 지식 관리 (목록 테이블/카드 + 지식화 진행·롤백 + KMS 탐색 + FAQ 항목 설정)
const { useState: useStateK, useEffect: useEffectK, useRef: useRefK } = React;

const STATUS_MAP = {
  ready: { tone: 'green', label: '활성', dot: true },
  processing: { tone: 'blue', label: '지식화 중', dot: true },
  review: { tone: 'amber', label: '검수 대기', dot: true },
  error: { tone: 'red', label: '실패', dot: true },
};
function StatusBadge({ s }) { const m = STATUS_MAP[s] || STATUS_MAP.ready; return <Badge tone={m.tone} dot={m.dot}>{m.label}</Badge>; }
function TypeBadge({ ty }) { return ty === 'faq' ? <Badge tone="blue"><Icon name="book" size={11} /> FAQ</Badge> : <Badge tone="gray"><Icon name="file" size={11} /> 문서</Badge>; }

function ValidCell({ from, until }) {
  return (
    <span className="num muted" style={{ fontSize: 12 }}>
      {from || '—'}{until ? ` ~ ${until}` : ' ~ 무기한'}
    </span>
  );
}

/* ---------------- Ingestion progress + rollback ---------------- */
const PIPELINES = {
  'upload': [
    { name: '파일 수신', done: 'PDF 2.4MB · 업로드 완료', live: '파일 업로드 중' },
    { name: '작업 큐 등록', done: 'track_id 발급 · /documents/upload 202', live: '큐 등록 중' },
    { name: '문서 파싱', done: '텍스트 추출 · 18,420 tokens', live: '문서 파싱 중' },
    { name: '청크 분할', done: '38개 청크 · 평균 485 tokens', live: '청크 분할 중' },
    { name: '임베딩 생성', done: '38 벡터 · 1,536 dim', live: '벡터 생성 24/38' },
    { name: '엔티티·관계 추출', done: '엔티티 71 · 관계 124', live: 'LLM 그래프 추출 중' },
    { name: '인덱스 반영', done: '그래프·벡터 인덱스 커밋', live: '인덱스 반영 중' },
  ],
  'ingest-text': [
    { name: '텍스트 수신', done: '4,210 tokens', live: '텍스트 수신 중' },
    { name: '작업 큐 등록', done: 'track_id 발급 · /documents/text 202', live: '큐 등록 중' },
    { name: '청크 분할', done: '9개 청크 · 평균 468 tokens', live: '청크 분할 중' },
    { name: '임베딩 생성', done: '9 벡터 · 1,536 dim', live: '벡터 생성 중' },
    { name: '엔티티·관계 추출', done: '엔티티 18 · 관계 27', live: '그래프 추출 중' },
    { name: '인덱스 반영', done: '그래프·벡터 커밋', live: '인덱스 반영 중' },
  ],
  'texts': [
    { name: '다중 텍스트 수신', done: '3건 · 12,640 tokens', live: '텍스트 수신 중' },
    { name: '작업 큐 등록', done: 'track_id 발급 · /documents/texts 202', live: '큐 등록 중' },
    { name: '청크 분할', done: '27개 청크', live: '청크 분할 중' },
    { name: '임베딩 생성', done: '27 벡터 · 1,536 dim', live: '벡터 생성 중' },
    { name: '엔티티·관계 추출', done: '엔티티 44 · 관계 71', live: '그래프 추출 중' },
    { name: '인덱스 반영', done: '그래프·벡터 커밋', live: '인덱스 반영 중' },
  ],
  'url': [
    { name: 'URL 검증', done: '200 OK · text/html', live: '/api/url/validate 호출' },
    { name: '본문 추출', done: '본문 6,820 tokens 추출', live: '/api/url/extract 호출' },
    { name: '청크 분할', done: '14개 청크', live: '청크 분할 중' },
    { name: '임베딩 생성', done: '14 벡터 · 1,536 dim', live: '벡터 생성 중' },
    { name: '엔티티·관계 추출', done: '엔티티 31 · 관계 48', live: '그래프 추출 중' },
    { name: '인덱스 반영', done: '/api/url/ingest 완료', live: '인덱스 반영 중' },
  ],
  'url-batch': [
    { name: 'URL 목록 검증', done: '8건 검증 · 유효 7 / 실패 1', live: 'URL 검증 중' },
    { name: '중복 필터', done: '기존 색인 2건 제외', live: '중복 확인 중' },
    { name: '본문 추출', done: '5건 추출 완료', live: '본문 추출 3/5' },
    { name: '임베딩 생성', done: '63 벡터 · 1,536 dim', live: '벡터 생성 중' },
    { name: '엔티티·관계 추출', done: '엔티티 112 · 관계 188', live: '그래프 추출 중' },
    { name: '인덱스 반영', done: '/api/url/ingest-batch 완료', live: '인덱스 반영 중' },
  ],
  'board': [
    { name: '게시판 탐색', done: '142건 레코드 발견', live: '/api/board/explore 호출' },
    { name: '필드 매핑 적용', done: 'title·body·date·author 매핑', live: '매핑 검증 중' },
    { name: '레코드 수집', done: '142건 수집 완료', live: '레코드 수집 중' },
    { name: '청크 분할', done: '210개 청크', live: '청크 분할 중' },
    { name: '임베딩 생성', done: '210 벡터 · 1,536 dim', live: '벡터 생성 중' },
    { name: '인덱스 반영', done: '/api/board/ingest 완료', live: '인덱스 반영 중' },
  ],
  'multimodal': [
    { name: '문서 파싱', done: 'MinerU · 24페이지', live: '/api/multimodal/parse 호출' },
    { name: '이미지·표·수식 추출', done: '이미지 12 · 표 6 · 수식 9', live: '멀티모달 추출 중' },
    { name: '멀티모달 임베딩', done: '텍스트+비전 벡터 생성', live: '/api/multimodal/process 호출' },
    { name: '청크 분할', done: '52개 청크', live: '청크 분할 중' },
    { name: '엔티티·관계 추출', done: '엔티티 88 · 관계 140', live: '그래프 추출 중' },
    { name: '인덱스 반영', done: '그래프·벡터 커밋', live: '인덱스 반영 중' },
  ],
  'quick-image': [
    { name: '이미지 수신', done: 'PNG 1.2MB', live: '이미지 업로드 중' },
    { name: '비전 캡션 생성', done: 'image prompt 기반 설명 생성', live: '/documents/quick-image 호출' },
    { name: '임베딩 생성', done: '비전+텍스트 벡터 1건', live: '벡터 생성 중' },
    { name: '인덱스 반영', done: '벡터 인덱스 커밋', live: '인덱스 반영 중' },
  ],
  'scan': [
    { name: '디렉터리 스캔', done: 'input/ · 12개 파일', live: '/documents/scan 호출' },
    { name: '신규 파일 식별', done: '신규 5건 · 기존 7건 제외', live: '변경 비교 중' },
    { name: '일괄 큐 등록', done: '5건 track_id 발급', live: '큐 등록 중' },
    { name: '지식화 진행', done: '5건 지식화 완료', live: '지식화 진행 3/5' },
  ],
  're-ingest': [
    { name: '롤백 지점 생성', done: '이전 버전 스냅샷 저장', live: '스냅샷 생성 중' },
    { name: '변경 본문 검증', done: '본문 diff · 2개 단락 변경', live: '변경 검증 중' },
    { name: '임베딩 재생성', done: '청크 6개 갱신 · 1,536 dim', live: '임베딩 재생성 중' },
    { name: '그래프 갱신', done: '엔티티 11 · 관계 9 갱신', live: '그래프 갱신 중' },
    { name: '인덱스 반영', done: '벡터 인덱스 스왑 완료', live: '인덱스 스왑 중' },
  ],
  'faq-publish': [
    { name: '검수 상태 확인', done: 'review → published', live: '검수 상태 확인' },
    { name: '답변 게시', done: 'POST /api/answers · 200', live: '답변 게시 중' },
    { name: '벡터 인덱싱', done: 'FAQ 임베딩 1건 반영', live: '벡터 인덱싱 중' },
  ],
};
const PIPE_META = {
  'upload': [['청크', '38'], ['임베딩', '38'], ['엔티티·관계', '71·124'], ['소요', '6.4s']],
  'ingest-text': [['청크', '9'], ['임베딩', '9'], ['엔티티·관계', '18·27'], ['소요', '2.1s']],
  'texts': [['텍스트', '3'], ['청크', '27'], ['엔티티·관계', '44·71'], ['소요', '4.0s']],
  'url': [['청크', '14'], ['임베딩', '14'], ['엔티티·관계', '31·48'], ['소요', '3.6s']],
  'url-batch': [['URL', '7'], ['청크', '63'], ['엔티티·관계', '112·188'], ['소요', '11.2s']],
  'board': [['레코드', '142'], ['청크', '210'], ['임베딩', '210'], ['소요', '18.7s']],
  'multimodal': [['이미지·표·수식', '12·6·9'], ['청크', '52'], ['엔티티·관계', '88·140'], ['소요', '22.3s']],
  'quick-image': [['이미지', '1'], ['임베딩', '1'], ['모델', 'vision'], ['소요', '1.9s']],
  'scan': [['발견', '12'], ['신규', '5'], ['완료', '5'], ['소요', '14.5s']],
  're-ingest': [['갱신 청크', '6'], ['엔티티·관계', '11·9'], ['벡터 dim', '1,536'], ['소요', '3.1s']],
  'faq-publish': [['답변', '1'], ['임베딩', '1'], ['워크스페이스', 'cs-faq'], ['소요', '0.8s']],
};
const fmtTime = (base, add) => {
  const [h, m] = (base.split(' ')[1] || '09:41').split(':').map(Number);
  let tot = h * 3600 + m * 60 + add;
  const hh = String(Math.floor(tot / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(tot / 60) % 60).padStart(2, '0');
  const ss = String(tot % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

function IngestionDetail({ job, onClose }) {
  const steps = PIPELINES[job.type] || (job.steps || []).map((s) => ({ name: s, done: '완료', live: '처리 중' }));
  const meta = PIPE_META[job.type] || [];
  const init = job.status === 'success' ? steps.length : Math.round((job.progress / 100) * steps.length);
  const [prog, setProg] = useStateK(job.progress);
  const [phase, setPhase] = useStateK(init);
  const [state, setState] = useStateK(job.status);

  useEffectK(() => {
    if (state !== 'running') return;
    const tick = setInterval(() => {
      setProg((p) => {
        const np = Math.min(100, p + 4);
        setPhase(Math.min(steps.length, Math.round((np / 100) * steps.length)));
        if (np >= 100) { clearInterval(tick); setState('success'); }
        return np;
      });
    }, 550);
    return () => clearInterval(tick);
  }, [state]);

  const terminal = state !== 'running';
  const m = {
    running: { tone: 'blue', label: '지식화 진행 중' },
    success: { tone: 'green', label: '완료' },
    failed: { tone: 'red', label: '실패' },
    rolledback: { tone: 'amber', label: '롤백됨' },
  }[state];
  const barTone = state === 'failed' ? 'red' : state === 'rolledback' ? 'amber' : state === 'success' ? 'green' : '';
  const curStage = state === 'running' ? (steps[phase] || steps[steps.length - 1]).name : state === 'success' ? '모든 단계 완료' : steps[phase] ? steps[phase].name + ' 단계에서 중단' : '중단됨';

  // build realistic log tail
  const logs = [];
  let sec = 0;
  steps.forEach((s, i) => {
    if (i < phase) { logs.push({ t: fmtTime(job.when, sec), lvl: 'INFO', msg: `${s.name} — ${s.done}` }); sec += 2 + (i % 2); }
    else if (i === phase && state === 'running') logs.push({ t: fmtTime(job.when, sec), lvl: 'INFO', msg: `${s.name} … ${s.live}` });
    else if (i === phase && state === 'failed') { logs.push({ t: fmtTime(job.when, sec), lvl: 'ERROR', msg: `${s.name} 실패 — ${job.msg}` }); sec += 1; }
  });
  if (state === 'failed' || state === 'rolledback') logs.push({ t: fmtTime(job.when, sec + 1), lvl: 'WARN', msg: '부분 생성 데이터 롤백 시작' }, { t: fmtTime(job.when, sec + 2), lvl: 'INFO', msg: '롤백 완료 · 이전 상태로 복구' });

  return (
    <Modal lg title="지식화 작업" icon="clipboard" onClose={onClose} footer={
      <>
        {state === 'running' && <Btn variant="danger" icon="pause" onClick={() => setState('rolledback')}>중단 · 롤백</Btn>}
        {(state === 'failed' || state === 'rolledback') && <Btn variant="secondary" icon="refresh">다시 실행</Btn>}
        <Btn variant="primary" onClick={onClose}>닫기</Btn>
      </>
    }>
      {/* header */}
      <div className="row" style={{ gap: 11, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--bg-subtle)', color: 'var(--fg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={job.type === 'faq-publish' ? 'book' : 'file'} size={18} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{job.title}</div>
          <div className="muted mono" style={{ fontSize: 11.5, marginTop: 1 }}>job#{job.id} · {job.type} · {job.by} · {job.when}</div>
        </div>
        <Badge tone={m.tone} dot>{m.label}</Badge>
      </div>

      {/* summary tiles */}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${meta.length || 4},1fr)`, gap: 8, marginBottom: 14 }}>
        {meta.map(([k, v], i) => {
          const known = terminal && state !== 'failed' && state !== 'rolledback' ? true : (i < 2 ? phase > i + 1 : false);
          return (
            <div key={k} style={{ padding: '9px 11px', borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 3 }}>{k}</div>
              <div className="num" style={{ fontSize: 15, fontWeight: 700, color: known || terminal ? 'var(--fg-primary)' : 'var(--fg-muted)' }}>{known || terminal ? v : '…'}</div>
            </div>
          );
        })}
      </div>

      {/* progress */}
      <div className="row" style={{ gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{curStage}</span>
        <div className="grow" />
        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: state === 'failed' ? 'var(--danger)' : state === 'rolledback' ? 'var(--warning)' : 'var(--accent)' }}>{prog}%</span>
      </div>
      <div className={'bar ' + barTone} style={{ height: 8, marginBottom: 16 }}><i style={{ width: prog + '%' }} /></div>

      {/* two columns: steps + log */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>처리 단계</div>
          <div className="col" style={{ gap: 2 }}>
            {steps.map((s, i) => {
              const doneStep = i < phase;
              const active = i === phase && state === 'running';
              const failedStep = state === 'failed' && i === phase;
              const rolled = state === 'rolledback' && i >= phase;
              return (
                <div key={s.name} className="row" style={{ gap: 9, padding: '7px 9px', borderRadius: 'var(--radius-sm)', background: active ? 'var(--accent-soft)' : 'transparent', alignItems: 'flex-start' }}>
                  <span style={{ width: 19, height: 19, borderRadius: '50%', marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: failedStep ? 'var(--danger)' : doneStep ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-subtle)',
                    color: (doneStep || active || failedStep) ? '#fff' : 'var(--fg-muted)' }}>
                    {failedStep ? <Icon name="x" size={11} /> : doneStep ? <Icon name="check" size={11} /> : active ? <span className="spin"><Icon name="loader" size={11} /></span> : <span style={{ fontSize: 10, fontWeight: 700 }}>{i + 1}</span>}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: active ? 600 : 500, color: doneStep || active ? 'var(--fg-primary)' : rolled ? 'var(--fg-muted)' : 'var(--fg-secondary)' }}>{s.name}</div>
                    <div style={{ fontSize: 11, marginTop: 1, color: failedStep ? 'var(--danger)' : active ? 'var(--accent)' : doneStep ? 'var(--fg-secondary)' : 'var(--fg-muted)' }}>
                      {failedStep ? '오류 발생 — 중단됨' : active ? s.live : doneStep ? s.done : rolled ? '롤백됨' : '대기'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>실시간 로그</div>
          <div style={{ background: 'var(--c-primary)', borderRadius: 'var(--radius-md)', padding: '11px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.85, maxHeight: 200, overflow: 'auto' }}>
            {logs.map((l, i) => (
              <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ color: '#7a8ba0' }}>{l.t}</span>{' '}
                <span style={{ color: l.lvl === 'ERROR' ? '#e06b6b' : l.lvl === 'WARN' ? '#e0894a' : '#5fd08a' }}>{l.lvl}</span>{' '}
                <span style={{ color: '#cdd6e6' }}>{l.msg}</span>
              </div>
            ))}
            {state === 'running' && <div style={{ color: '#5fd08a' }}><span className="spin" style={{ display: 'inline-block' }}>▍</span></div>}
          </div>
        </div>
      </div>

      {/* rollback notice */}
      {(state === 'rolledback' || state === 'failed') && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--warning-soft)', border: '1px solid #f1ddb8' }}>
          <Icon name="rollback" size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: '#9a5b08', lineHeight: 1.55 }}>
            <b>롤백 완료</b> — 부분 생성된 청크·임베딩·그래프 노드가 제거되고 지식 항목이 이전 상태로 복구되었습니다. 데이터 정합성에는 영향이 없습니다.
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Generative KMS explorer ---------------- */
function KmsExplorer({ doc, onClose }) {
  const [tab, setTab] = useStateK('doc');
  return (
    <Modal lg title="생성형 KMS 탐색" icon="layers" onClose={onClose} footer={<Btn variant="primary" onClick={onClose}>닫기</Btn>}>
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="file" size={20} /></div>
        <div className="grow">
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)' }}>{doc.title}</div>
          <div className="muted mono" style={{ fontSize: 12 }}>{doc.docId} · {doc.chunks} chunks · {doc.tokens.toLocaleString()} tokens</div>
        </div>
        <Badge tone="green" dot>처리완료</Badge>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')}><Icon name="file" size={14} /> 문서</button>
        <button className={tab === 'chunk' ? 'on' : ''} onClick={() => setTab('chunk')}><Icon name="layers" size={14} /> 청크 <span className="ct">{doc.chunks}</span></button>
        <button className={tab === 'graph' ? 'on' : ''} onClick={() => setTab('graph')}><Icon name="network" size={14} /> 엔티티·관계</button>
        {doc.multimodal && <button className={tab === 'mm' ? 'on' : ''} onClick={() => setTab('mm')}><Icon name="wand" size={14} /> 멀티모달</button>}
      </div>

      {tab === 'doc' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[['문서 ID', doc.docId, 'mono'], ['청크 수', doc.chunks, 'num'], ['토큰', doc.tokens.toLocaleString(), 'num'], ['상태', '처리완료', ''], ['생성일', doc.created, 'num'], ['파이프라인', 'LightRAG /documents', 'mono']].map(([k, v, cls]) => (
            <div key={k} style={{ padding: 14, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{k}</div>
              <div className={cls} style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)', wordBreak: 'break-all' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'chunk' && (
        <div className="col" style={{ gap: 10 }}>
          {doc.chunkList.map((c) => (
            <div key={c.id} style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div className="row" style={{ gap: 8, padding: '9px 12px', background: 'var(--bg-subtle)', fontSize: 12 }}>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{c.id}</span>
                <span className="muted">순서 {c.order}</span>
                <div className="grow" />
                <span className="num muted">{c.tokens} tokens</span>
              </div>
              <div style={{ padding: '11px 13px', fontSize: 13, lineHeight: 1.6, color: 'var(--fg-primary-soft)' }}>{c.text}</div>
            </div>
          ))}
          <div className="empty" style={{ padding: 14 }}>+{doc.chunks - doc.chunkList.length}개 청크 더 보기</div>
        </div>
      )}

      {tab === 'graph' && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>엔티티 {doc.entities.length}</div>
            <div className="col" style={{ gap: 7 }}>
              {doc.entities.map((e) => (
                <div key={e.name} className="row" style={{ gap: 9, padding: '8px 11px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>{e.name}</span>
                  <Badge tone="gray">{e.type}</Badge>
                  <div className="grow" />
                  <span className="muted num" style={{ fontSize: 11.5 }}>연결 {e.deg}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>관계 {doc.relations.length}</div>
            <div className="col" style={{ gap: 7 }}>
              {doc.relations.map((r, i) => (
                <div key={i} className="col" style={{ gap: 6, padding: '10px 12px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="badge blue">{r.src}</span>
                    <span className="muted" style={{ fontSize: 11 }}>──</span>
                    <span style={{ color: 'var(--fg-secondary)', fontWeight: 600 }}>{r.rel}</span>
                    <Icon name="chevR" size={12} className="muted" />
                    <span className="badge gray">{r.tgt}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {tab === 'mm' && doc.multimodal && (
        <div className="col" style={{ gap: 18 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>추출 이미지 {doc.multimodal.images.length}</div>
            <div className="row wrap" style={{ gap: 10 }}>
              {doc.multimodal.images.map((im, i) => <RefImage key={i} label={im.label} src={im.src} size="thumb" />)}
            </div>
          </div>
          {doc.multimodal.tables.map((tb, i) => (
            <div key={i}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>표 — {tb.caption}</div>
              <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr>{tb.head.map((h, j) => <th key={j} style={{ textAlign: j === 0 ? 'left' : 'right', padding: '8px 12px', background: 'var(--bg-subtle)', fontWeight: 600, color: 'var(--fg-primary)', borderBottom: '1px solid var(--border-default)' }}>{h}</th>)}</tr></thead>
                  <tbody>{tb.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className={ci > 0 ? 'num' : ''} style={{ textAlign: ci === 0 ? 'left' : 'right', padding: '8px 12px', borderBottom: ri < tb.rows.length - 1 ? '1px solid var(--border-subtle)' : 0, color: ci === 0 ? 'var(--fg-primary)' : 'var(--fg-primary-soft)', fontWeight: ci === 0 ? 600 : 400 }}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          ))}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>수식 {doc.multimodal.formulas.length}</div>
            <div className="col" style={{ gap: 8 }}>
              {doc.multimodal.formulas.map((f, i) => (
                <div key={i} style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--bg-elevated)' }}>
                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{f.label}</div>
                  <div className="mono" style={{ fontSize: 13.5, color: 'var(--fg-primary)' }}>{f.tex}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 8, fontSize: 11.5, color: 'var(--fg-secondary)' }}>
            <Icon name="info" size={13} /> 멀티모달 파서가 추출한 이미지·표·수식이며, 텍스트와 함께 임베딩되어 검색에 활용됩니다.
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- FAQ item settings ---------------- */
function FaqDetail({ item, onClose, onReingest }) {
  const [tags, setTags] = useStateK(item.tags);
  const [body, setBody] = useStateK(item.body);
  const [fmt, setFmt] = useStateK(item.format || 'markdown');
  const [preview, setPreview] = useStateK(false);
  const [dirty, setDirty] = useStateK(false);
  const removeTag = (t) => { setTags(tags.filter((x) => x !== t)); setDirty(true); };
  return (
    <Modal lg title="FAQ 답변 항목 설정" icon="book" onClose={onClose} footer={
      <>
        <Btn variant="secondary" icon="rollback">변경 취소</Btn>
        <Btn variant="primary" icon="save" onClick={() => { onReingest(item); }}>{dirty ? '저장 · 재지식화' : '저장'}</Btn>
      </>
    }>
      <div className="row" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Badge tone="green" dot>게시됨</Badge>
        <Badge tone="blue"><Icon name="layers" size={11} /> 벡터 인덱스 반영</Badge>
        <span className="muted mono" style={{ fontSize: 12 }}>{item.answerId}</span>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>벡터 갱신 {item.vectorAt}</span>
      </div>

      <Field label="질문 (대표)"><input className="input" defaultValue={item.title} onChange={() => setDirty(true)} /></Field>
      <div style={{ height: 14 }} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="카테고리">
          <select className="select" defaultValue={item.cat}>
            {CATEGORIES.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
          </select>
        </Field>
        <Field label="게시 상태">
          <select className="select" defaultValue="published"><option value="published">게시</option><option value="review">검수</option><option value="archived">보관</option></select>
        </Field>
        <Field label="유효 시작"><input className="input" type="date" defaultValue="2026-01-01" /></Field>
        <Field label="유효 종료"><input className="input" type="date" defaultValue="2026-12-31" /></Field>
      </div>

      <div style={{ height: 16 }} />
      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>답변 본문</span>
        <div className="grow" />
        <div className="seg" style={{ marginRight: 8 }}>
          {[['text', '텍스트'], ['markdown', '마크다운'], ['html', 'HTML']].map(([k, l]) => (
            <button key={k} className={fmt === k ? 'on' : ''} onClick={() => { setFmt(k); setDirty(true); }}>{l}</button>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setPreview((p) => !p)}><Icon name={preview ? 'edit' : 'eye'} size={14} /> {preview ? '편집' : '미리보기'}</button>
      </div>
      {preview ? (
        <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 14, minHeight: 120, background: 'var(--bg-elevated)' }}>
          <RichText source={body} format={fmt} imgSize="inline" />
        </div>
      ) : (
        <MarkdownEditor value={body} onChange={(v) => { setBody(v); setDirty(true); }} format={fmt} minHeight={140} />
      )}
      <div className="row" style={{ gap: 7, marginTop: 8, fontSize: 11.5, color: 'var(--fg-secondary)' }}>
        <Icon name="info" size={13} /> {fmt === 'markdown' ? '마크다운 문법(**굵게**, # 제목, - 목록, ![설명](이미지))을 지원합니다.' : fmt === 'html' ? 'HTML 태그를 그대로 사용합니다. 저장 시 안전 태그만 허용(sanitize)됩니다.' : '서식 없는 일반 텍스트로 저장됩니다.'}
      </div>

      <div style={{ height: 16 }} />
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="eyebrow">첨부 이미지 {item.images ? item.images.length : 0}</span>
        <div className="grow" />
        <button className="btn btn-secondary btn-sm" onClick={() => setDirty(true)}><Icon name="image" size={14} /> 이미지 추가</button>
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        {(item.images || []).map((im, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <RefImage label={im.label} src={im.src} size="thumb" />
          </div>
        ))}
        <div style={{ width: 138, height: 86, border: '2px dashed var(--border-default)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--fg-secondary)', cursor: 'pointer', background: 'var(--bg-subtle)' }}>
          <Icon name="upload" size={18} /><span style={{ fontSize: 11 }}>업로드</span>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 7 }}>본문에 <span className="mono">![설명](이미지)</span> 형식으로 삽입하면 답변·검색 결과에 함께 노출됩니다.</div>

      <div style={{ height: 16 }} />
      <Field label="요약 (답변 후보 매칭용)"><textarea className="textarea" style={{ minHeight: 60 }} defaultValue={item.summary} onChange={() => setDirty(true)} /></Field>

      <div style={{ height: 16 }} />
      <div className="eyebrow" style={{ marginBottom: 8 }}>매칭 가이드</div>
      <div className="col" style={{ gap: 7 }}>
        {item.guidance.map((g, i) => (
          <div key={i} className="row" style={{ gap: 9, padding: '9px 11px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
            <Icon name="bulb" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} /> <span className="grow">{g}</span>
          </div>
        ))}
      </div>

      <div style={{ height: 16 }} />
      <div className="eyebrow" style={{ marginBottom: 8 }}>유사 질문 변형 {item.variants.length}</div>
      <div className="row wrap" style={{ gap: 7 }}>
        {item.variants.map((v) => <span key={v} className="badge gray">{v}</span>)}
        <button className="chip btn-sm"><Icon name="plus" size={12} /> 추가</button>
      </div>

      <div style={{ height: 16 }} />
      <div className="eyebrow" style={{ marginBottom: 8 }}>태그·키워드</div>
      <div className="row wrap" style={{ gap: 7 }}>
        {tags.map((tg) => <span key={tg} className="chip on">{tg} <span className="x" onClick={() => removeTag(tg)}><Icon name="x" size={12} /></span></span>)}
        <button className="chip btn-sm"><Icon name="plus" size={12} /> 추가</button>
      </div>

      {dirty && (
        <div style={{ display: 'flex', gap: 11, marginTop: 18, padding: 13, borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)', border: '1px solid #c9d8f7' }}>
          <Icon name="refresh" size={17} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--fg-primary-soft)', lineHeight: 1.55 }}>
            <b style={{ color: 'var(--accent)' }}>변경 감지됨.</b> 저장 시 이 답변과 연결된 벡터 인덱스가 자동으로 <b>재지식화</b>되어 검색 결과에 반영됩니다.
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Main screen ---------------- */
function KnowledgeManagement({ t, toast }) {
  const [view, setView] = useStateK('table'); // table | card
  const [ty, setTy] = useStateK('all');
  const [items, setItems] = useStateK(KNOWLEDGE);
  const [adding, setAdding] = useStateK(false);
  const [job, setJob] = useStateK(null);
  const [explore, setExplore] = useStateK(null);
  const [faq, setFaq] = useStateK(null);

  const filtered = items.filter((i) => ty === 'all' || i.type === ty);

  const openItem = (i) => {
    if (i.status === 'processing') { setJob(JOBS.find((j) => j.status === 'running') || JOBS[1]); return; }
    if (i.status === 'error') { setJob(JOBS.find((j) => j.status === 'failed') || JOBS[2]); return; }
    if (i.type === 'faq') { setFaq(FAQ_ITEM); return; }
    setExplore(KMS_DOC);
  };

  const counts = { all: items.length, faq: items.filter((i) => i.type === 'faq').length, text: items.filter((i) => i.type === 'text').length };

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div><h1>지식 관리</h1><p>FAQ·문서 지식을 등록하고 유효 기간·카테고리·지식화 상태를 관리합니다.</p></div>
        <div className="sp" />
        <div className="seg">
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><Icon name="clipboard" size={14} /> 테이블</button>
          <button className={view === 'card' ? 'on' : ''} onClick={() => setView('card')}><Icon name="layers" size={14} /> 카드</button>
        </div>
        <Btn variant="primary" icon="plus" onClick={() => setAdding(true)}>지식 추가</Btn>
      </div>

      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={ty === 'all' ? 'on' : ''} onClick={() => setTy('all')}>전체 <span className="ct">{counts.all}</span></button>
        <button className={ty === 'faq' ? 'on' : ''} onClick={() => setTy('faq')}><Icon name="book" size={14} /> FAQ 지식 <span className="ct">{counts.faq}</span></button>
        <button className={ty === 'text' ? 'on' : ''} onClick={() => setTy('text')}><Icon name="file" size={14} /> 문서 지식 <span className="ct">{counts.text}</span></button>
      </div>

      {view === 'table' ? (
        <div className="card" style={{ padding: '16px 8px 8px' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ paddingLeft: 14 }}>제목</th><th>유형</th><th>출처</th><th>카테고리</th><th>상태</th><th>사용</th><th>유효기간</th><th className="num">조회</th><th>수정일</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => openItem(i)}>
                  <td><div className="ttl">{i.title}</div><div className="muted mono" style={{ fontSize: 11 }}>{i.id} · {i.ws}</div></td>
                  <td><TypeBadge ty={i.type} /></td>
                  <td><Badge tone="gray">{SOURCE_LABELS[sourceOf(i)]}</Badge></td>
                  <td className="muted">{catName(i.cat)}</td>
                  <td><StatusBadge s={i.status} /></td>
                  <td>{i.enabled ? <Badge tone="green" dot>사용</Badge> : <Badge tone="gray">미사용</Badge>}</td>
                  <td><ValidCell from={i.from} until={i.until} /></td>
                  <td className="num" style={{ fontWeight: 600, color: 'var(--fg-primary)' }}>{i.hits.toLocaleString()}</td>
                  <td className="num muted" style={{ fontSize: 12 }}>{i.updated}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openItem(i); }}><Icon name={i.type === 'faq' ? 'edit' : 'eye'} size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' }}>
          {filtered.map((i) => (
            <div key={i.id} className="card" style={{ padding: 'var(--pad-card)', cursor: 'pointer' }} onClick={() => openItem(i)}>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <TypeBadge ty={i.type} /><StatusBadge s={i.status} /><div className="grow" />
                {i.enabled ? <Badge tone="green" dot>사용</Badge> : <Badge tone="gray">미사용</Badge>}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)', lineHeight: 1.45 }}>{i.title}</div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}><Icon name="tree" size={12} /> {catName(i.cat)}</span>
                <div className="grow" />
                <span className="badge outline" style={{ fontSize: 10.5 }}>{SOURCE_LABELS[sourceOf(i)]}</span>
              </div>
              {i.status === 'processing' && <div className="bar" style={{ marginTop: 12 }}><i style={{ width: '62%' }} /></div>}
              <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
                {i.keywords.slice(0, 3).map((k) => <span key={k} className="badge outline">{k}</span>)}
              </div>
              <hr className="hr" style={{ margin: '14px 0 12px' }} />
              <div className="row" style={{ fontSize: 11.5 }}>
                <span className="muted"><Icon name="eye" size={12} /> {i.hits.toLocaleString()}</span>
                <div className="grow" />
                <span className="num muted">{i.updated}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && <KnowledgeWizard onClose={() => setAdding(false)} onStart={(pipeline, title) => {
        setAdding(false);
        setJob({ id: 'job-' + Date.now(), title, type: pipeline, status: 'running', progress: 8, when: '2026.06.09 10:18', by: 'admin', steps: [] });
        toast(pipeline === 'faq-publish' ? 'FAQ 답변을 추가했습니다.' : '지식화를 시작했습니다.');
      }} />}
      {job && <IngestionDetail key={job.id} job={job} onClose={() => setJob(null)} />}
      {explore && <KmsExplorer doc={explore} onClose={() => setExplore(null)} />}
      {faq && <FaqDetail item={faq} onClose={() => setFaq(null)} onReingest={() => { setFaq(null); setJob(JOBS[0]); toast('재지식화 작업을 시작했습니다.'); }} />}
    </div>
  );
}

Object.assign(window, { KnowledgeManagement, IngestionDetail });
