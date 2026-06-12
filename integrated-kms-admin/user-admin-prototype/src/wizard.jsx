// wizard.jsx — 지식 추가 마법사 (source type 기반). LightRAG 지식화 경로 전체 반영.
const { useState: useStateW } = React;

// source key -> { label, icon, group, api, pipeline, ws, action }
const SOURCES = [
  { key: 'upload', label: '문서 업로드', icon: 'upload', group: '문서·텍스트', api: 'POST /documents/upload', pipeline: 'upload', ws: 'kms', desc: 'PDF·DOCX·TXT 파일을 업로드해 지식화합니다.' },
  { key: 'text', label: '텍스트 입력', icon: 'msg', group: '문서·텍스트', api: '/documents/text · /texts', pipeline: 'ingest-text', ws: 'kms', desc: '본문을 직접 입력합니다. 단일·다중 모두 지원.' },
  { key: 'scan', label: 'Input 폴더 스캔', icon: 'scan', group: '문서·텍스트', api: 'POST /documents/scan', pipeline: 'scan', ws: 'kms', desc: '서버 입력 폴더의 신규 파일을 일괄 지식화합니다.', op: true },
  { key: 'url', label: 'URL', icon: 'globe', group: '웹·연동', api: '/api/url/validate · ingest', pipeline: 'url', ws: 'kms', desc: '웹페이지를 검증 후 본문을 추출해 지식화합니다.' },
  { key: 'url-batch', label: 'URL 일괄', icon: 'listplus', group: '웹·연동', api: '/api/url/ingest-batch', pipeline: 'url-batch', ws: 'kms', desc: '여러 URL을 한 번에 등록합니다.' },
  { key: 'board', label: 'Board API', icon: 'grid', group: '웹·연동', api: '/api/board/explore · ingest', pipeline: 'board', ws: 'kms', desc: '게시판 API를 탐색하고 필드를 매핑해 수집합니다.' },
  { key: 'multimodal', label: '멀티모달 문서', icon: 'wand', group: '멀티모달', api: '/api/multimodal/parse · process', pipeline: 'multimodal', ws: 'kms', desc: '이미지·표·수식이 포함된 문서를 처리합니다.' },
  { key: 'quick-image', label: '이미지 빠른 등록', icon: 'image', group: '멀티모달', api: 'POST /documents/quick-image', pipeline: 'quick-image', ws: 'kms', desc: '이미지 1장과 설명을 즉시 지식화합니다.' },
  { key: 'faq', label: 'FAQ 답변', icon: 'book', group: 'FAQ', api: 'POST /api/answers', pipeline: 'faq-publish', ws: 'faq', desc: 'FAQ 전용 답변·가이드·상태를 설정합니다.' },
];
const GROUPS = ['문서·텍스트', '웹·연동', '멀티모달', 'FAQ'];

function Drop({ label, sub, icon = 'upload', files }) {
  return (
    <div style={{ border: '2px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', padding: 22, textAlign: 'center', background: 'var(--bg-subtle)' }}>
      <Icon name={icon} size={24} style={{ color: 'var(--fg-secondary)' }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', marginTop: 8 }}>{label}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>
      {files && (
        <div className="col" style={{ gap: 6, marginTop: 14 }}>
          {files.map((f) => (
            <div key={f.n} className="row" style={{ gap: 9, padding: '8px 11px', background: '#fff', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
              <Icon name="file" size={15} style={{ color: 'var(--accent)' }} /><span style={{ fontWeight: 600, color: 'var(--fg-primary)' }}>{f.n}</span><span className="muted">{f.s}</span>
              <div className="grow" /><Icon name="x" size={14} className="muted" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, hint }) {
  return <div className="row" style={{ marginBottom: 10, marginTop: 4 }}><span className="eyebrow">{children}</span>{hint && <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{hint}</span>}</div>;
}

function SourcePanel({ src }) {
  const [textMode, setTextMode] = useStateW('single');
  const [urlOk, setUrlOk] = useStateW(false);
  const [scanned, setScanned] = useStateW(false);
  const [explored, setExplored] = useStateW(false);
  const [faqFmt, setFaqFmt] = useStateW('markdown');
  const [faqBody, setFaqBody] = useStateW('');

  switch (src.key) {
    case 'upload':
      return <Drop label="파일을 끌어다 놓거나 클릭하여 업로드" sub="PDF, DOCX, TXT, MD · 다중 선택 · 최대 50MB" files={[{ n: '2026 배송정책.pdf', s: '2.4MB' }, { n: '환불규정.docx', s: '180KB' }]} />;

    case 'text':
      return (
        <div className="col" style={{ gap: 14 }}>
          <div className="seg" style={{ width: '100%' }}>
            <button style={{ flex: 1 }} className={textMode === 'single' ? 'on' : ''} onClick={() => setTextMode('single')}>단일 텍스트</button>
            <button style={{ flex: 1 }} className={textMode === 'multi' ? 'on' : ''} onClick={() => setTextMode('multi')}>다중 텍스트</button>
          </div>
          {textMode === 'single' ? (
            <><Field label="제목"><input className="input" placeholder="예) 환불 처리 기준" /></Field>
              <Field label="본문"><textarea className="textarea" placeholder="지식 본문을 입력하세요." /></Field></>
          ) : (
            <div className="col" style={{ gap: 10 }}>
              {[1, 2].map((n) => (
                <div key={n} style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                  <div className="row" style={{ marginBottom: 8 }}><span style={{ fontSize: 12, fontWeight: 600 }}>텍스트 {n}</span><div className="grow" /><Icon name="x" size={14} className="muted" /></div>
                  <input className="input" placeholder="제목" style={{ marginBottom: 8 }} />
                  <textarea className="textarea" style={{ minHeight: 60 }} placeholder="본문" />
                </div>
              ))}
              <button className="chip" style={{ alignSelf: 'flex-start' }}><Icon name="plus" size={13} /> 텍스트 추가</button>
              <div className="muted" style={{ fontSize: 12 }}>POST /documents/texts 로 일괄 전송됩니다.</div>
            </div>
          )}
        </div>
      );

    case 'scan':
      return (
        <div className="col" style={{ gap: 14 }}>
          <Field label="입력 폴더 (서버 설정값)"><input className="input mono" defaultValue="/data/lightrag/inputs" readOnly style={{ background: 'var(--bg-subtle)' }} /></Field>
          <Btn variant="secondary" icon="scan" onClick={() => setScanned(true)} style={{ alignSelf: 'flex-start' }}>스캔 실행</Btn>
          {scanned && (
            <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 14 }}>
              <div className="row" style={{ gap: 14, marginBottom: 10 }}>
                <Badge tone="blue">발견 12</Badge><Badge tone="green" dot>신규 5</Badge><Badge tone="gray">기존 7</Badge>
              </div>
              <div className="col" style={{ gap: 6 }}>
                {['2026Q2_상담매뉴얼.pdf', '요금제_개정.docx', 'FAQ_export.txt'].map((f) => (
                  <label key={f} className="row" style={{ gap: 9, fontSize: 12.5 }}><input type="checkbox" defaultChecked style={{ accentColor: 'var(--accent)' }} /> <Icon name="file" size={14} className="muted" /> {f}</label>
                ))}
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 8, padding: 11, background: 'var(--warning-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: '#9a5b08' }}>
            <Icon name="info" size={14} style={{ flexShrink: 0 }} /> 운영자 전용 기능입니다. 폴더 경로는 서버 환경변수로 고정됩니다.
          </div>
        </div>
      );

    case 'url':
      return (
        <div className="col" style={{ gap: 14 }}>
          <Field label="URL">
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow mono" defaultValue="https://help.example.com/refund" />
              <Btn variant="secondary" icon="squareCheck" onClick={() => setUrlOk(true)}>검증</Btn>
            </div>
          </Field>
          {urlOk && (
            <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 13 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}><Badge tone="green" dot>200 OK</Badge><span className="muted" style={{ fontSize: 12 }}>text/html · 6,820 tokens</span></div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>환불 정책 안내 — 고객센터</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>카드 결제 환불은 영업일 기준 3~5일 이내 처리되며, 무통장입금은…</div>
            </div>
          )}
          <SectionLabel>추출 옵션</SectionLabel>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="추출 범위"><select className="select"><option>본문만 추출</option><option>전체 HTML</option></select></Field>
            <Field label="하위 링크 깊이"><select className="select"><option>0 (현재 페이지)</option><option>1단계</option><option>2단계</option></select></Field>
          </div>
        </div>
      );

    case 'url-batch':
      return (
        <div className="col" style={{ gap: 14 }}>
          <Field label="URL 목록 (줄바꿈으로 구분)">
            <textarea className="textarea mono" style={{ minHeight: 110, fontSize: 12.5 }} defaultValue={'https://help.example.com/refund\nhttps://help.example.com/delivery\nhttps://help.example.com/payment'} />
          </Field>
          <div className="col" style={{ gap: 10 }}>
            <label className="row" style={{ gap: 10 }}><Switch checked={true} onChange={() => {}} /> <div><div style={{ fontSize: 13, fontWeight: 500 }}>중복 URL 건너뛰기</div><div className="muted" style={{ fontSize: 11.5 }}>이미 색인된 URL은 제외합니다.</div></div></label>
            <label className="row" style={{ gap: 10 }}><Switch checked={false} onChange={() => {}} /> <div><div style={{ fontSize: 13, fontWeight: 500 }}>기존 문서 재색인</div><div className="muted" style={{ fontSize: 11.5 }}>동일 URL을 최신 본문으로 다시 지식화합니다.</div></div></label>
          </div>
        </div>
      );

    case 'board':
      return (
        <div className="col" style={{ gap: 14 }}>
          <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Field label="Board API URL"><input className="input mono" defaultValue="https://board.example.com/api/posts" /></Field>
            <Field label="페이지 크기"><input className="input num" type="number" defaultValue="100" /></Field>
          </div>
          <Btn variant="secondary" icon="grid" onClick={() => setExplored(true)} style={{ alignSelf: 'flex-start' }}>탐색</Btn>
          {explored && (
            <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div className="row" style={{ gap: 8, padding: '10px 13px', background: 'var(--bg-subtle)' }}><Icon name="check2" size={14} style={{ color: 'var(--success)' }} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>142건 레코드 발견 · 필드 매핑 확인</span></div>
              <div style={{ padding: 13 }}>
                <SectionLabel hint="LightRAG 필드  ←  Board 필드">필드 매핑</SectionLabel>
                <div className="col" style={{ gap: 8 }}>
                  {[['제목 (title)', 'subject'], ['본문 (content)', 'body_html'], ['작성일 (date)', 'reg_date'], ['작성자 (author)', 'writer']].map(([lr, bd]) => (
                    <div key={lr} className="row" style={{ gap: 10 }}>
                      <span style={{ width: 130, fontSize: 12.5, fontWeight: 500, flexShrink: 0 }}>{lr}</span>
                      <Icon name="chevR" size={13} className="muted" />
                      <select className="select grow" defaultValue={bd}><option value={bd}>{bd}</option><option>title</option><option>desc</option><option>created_at</option></select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      );

    case 'multimodal':
      return (
        <div className="col" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 8 }}><Badge tone="green" dot>멀티모달 엔진 사용 가능</Badge><span className="muted" style={{ fontSize: 11.5 }}>GET /api/multimodal/status · GPU</span></div>
          <Drop label="이미지·표·수식 포함 문서 업로드" sub="PDF, PPTX, 스캔 문서 · 최대 100MB" files={[{ n: '제품사양서_도표.pdf', s: '8.1MB' }]} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="파서"><select className="select"><option>MinerU</option><option>docling</option><option>unstructured</option></select></Field>
            <Field label="OCR 언어"><select className="select"><option>한국어 + 영어</option><option>한국어</option><option>영어</option></select></Field>
          </div>
          <SectionLabel>처리 대상</SectionLabel>
          <div className="row wrap" style={{ gap: 16 }}>
            <label className="check"><input type="checkbox" defaultChecked /> 이미지 캡션</label>
            <label className="check"><input type="checkbox" defaultChecked /> 표 추출</label>
            <label className="check"><input type="checkbox" defaultChecked /> 수식 인식</label>
          </div>
        </div>
      );

    case 'quick-image':
      return (
        <div className="col" style={{ gap: 14 }}>
          <Drop label="이미지를 끌어다 놓거나 클릭" sub="PNG, JPG, WEBP · 1장" icon="image" files={[{ n: '요금제_비교표.png', s: '1.2MB' }]} />
          <Field label="제목"><input className="input" placeholder="예) 요금제 비교표" /></Field>
          <Field label="이미지 설명 프롬프트"><textarea className="textarea" style={{ minHeight: 70 }} placeholder="이미지에서 추출할 정보를 안내하세요. 예) 표의 요금제별 월정액과 혜택을 정리" /></Field>
        </div>
      );

    case 'faq':
      return (
        <div className="col" style={{ gap: 14 }}>
          <Field label="질문 (대표)"><input className="input" placeholder="예) 환불은 며칠 걸리나요?" /></Field>
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>답변 본문</span>
              <div className="grow" />
              <div className="seg">
                {[['text', '텍스트'], ['markdown', '마크다운'], ['html', 'HTML']].map(([k, l]) => (
                  <button key={k} className={faqFmt === k ? 'on' : ''} onClick={() => setFaqFmt(k)}>{l}</button>
                ))}
              </div>
            </div>
            <MarkdownEditor value={faqBody} onChange={setFaqBody} format={faqFmt} minHeight={120} placeholder={faqFmt === 'markdown' ? '## 제목\n\n- **굵게** 항목\n\n![설명](이미지)' : faqFmt === 'html' ? '<h3>제목</h3>\n<ul><li>항목</li></ul>' : '고객에게 제공할 답변을 입력하세요.'} />
            <div className="row" style={{ gap: 7, marginTop: 7, fontSize: 11.5, color: 'var(--fg-secondary)' }}>
              <Icon name="info" size={13} /> {faqFmt === 'markdown' ? '마크다운(굵게·목록·제목·이미지)을 지원합니다.' : faqFmt === 'html' ? 'HTML 태그를 사용합니다. 저장 시 sanitize 처리됩니다.' : '서식 없는 일반 텍스트.'}
            </div>
          </div>
          <div>
            <div className="row" style={{ marginBottom: 8 }}><span className="eyebrow">이미지 첨부</span></div>
            <div className="row wrap" style={{ gap: 10 }}>
              <div style={{ width: 138, height: 86, border: '2px dashed var(--border-default)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--fg-secondary)', cursor: 'pointer', background: 'var(--bg-subtle)' }}>
                <Icon name="image" size={18} /><span style={{ fontSize: 11 }}>이미지 업로드</span>
              </div>
            </div>
          </div>
          <Field label="요약 (답변 후보 매칭용)"><textarea className="textarea" style={{ minHeight: 56 }} placeholder="검색 매칭에 쓰일 핵심 요약" /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="게시 상태"><select className="select"><option>검수 대기</option><option>게시</option><option>임시저장</option></select></Field>
            <Field label="태그 (쉼표 구분)"><input className="input" placeholder="환불, 처리기간" /></Field>
          </div>
          <Field label="매칭 가이드 (한 줄에 하나)"><textarea className="textarea" style={{ minHeight: 56 }} placeholder={'기간을 묻는 질문에 우선 매칭\n결제수단을 먼저 확인하도록 안내'} /></Field>
        </div>
      );
    default:
      return null;
  }
}

function KnowledgeWizard({ onClose, onStart }) {
  const [key, setKey] = useStateW('upload');
  const src = SOURCES.find((s) => s.key === key);
  const isFaq = src.ws === 'faq';
  const [enabled, setEnabled] = useStateW(true);

  const actionLabel = isFaq ? '답변 추가' : '지식화 시작';
  const pipelineFor = () => key === 'text' ? 'ingest-text' : src.pipeline;
  const titleFor = () => ({ upload: '2026 배송정책.pdf', text: '새 텍스트 지식', scan: 'Input 폴더 스캔 (5건)', url: 'help.example.com/refund', 'url-batch': 'URL 일괄 등록 (7건)', board: 'Board 게시판 수집 (142건)', multimodal: '제품사양서_도표.pdf', 'quick-image': '요금제 비교표', faq: '환불은 며칠 걸리나요?' }[key] || '새 지식');

  return (
    <Modal xl title="지식 추가" icon="plus" onClose={onClose} footer={
      <><Btn variant="secondary" onClick={onClose}>취소</Btn><Btn variant="primary" icon={isFaq ? 'plus' : 'zap'} onClick={() => onStart(pipelineFor(), titleFor())}>{actionLabel}</Btn></>
    }>
      <div className="grid" style={{ gridTemplateColumns: '232px 1fr', gap: 18, alignItems: 'start' }}>
        {/* source list */}
        <div className="col" style={{ gap: 2 }}>
          {GROUPS.map((g) => (
            <React.Fragment key={g}>
              <div className="eyebrow" style={{ fontSize: 9.5, padding: '10px 6px 4px' }}>{g}</div>
              {SOURCES.filter((s) => s.group === g).map((s) => (
                <button key={s.key} onClick={() => setKey(s.key)} className="row" style={{
                  gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-md)', border: '1px solid ' + (key === s.key ? 'var(--accent)' : 'transparent'),
                  background: key === s.key ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                  <Icon name={s.icon} size={17} style={{ color: key === s.key ? 'var(--accent)' : 'var(--fg-secondary)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: key === s.key ? 600 : 500, color: key === s.key ? 'var(--accent)' : 'var(--fg-primary-soft)' }}>{s.label}</span>
                  {s.op && <Badge tone="gray">운영</Badge>}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>

        {/* right: source-specific + policy */}
        <div className="col" style={{ gap: 18, minWidth: 0 }}>
          <div className="row" style={{ gap: 10, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={src.icon} size={19} /></div>
            <div className="grow"><div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)' }}>{src.label}</div><div className="muted" style={{ fontSize: 12 }}>{src.desc}</div></div>
            <span className="badge outline mono" style={{ fontSize: 10.5 }}>{src.api}</span>
          </div>

          <SourcePanel key={key} src={src} />

          {/* shared policy */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <SectionLabel hint="LightRAG 호출 전 어드민 원장에 저장">지식 정책</SectionLabel>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="카테고리"><select className="select"><option>선택 안 함</option>{CATEGORIES.filter((c) => c.active).map((c) => <option key={c.id}>{c.path}</option>)}</select></Field>
              <Field label={isFaq ? 'FAQ 워크스페이스' : 'KMS 워크스페이스'}><select className="select">{isFaq ? <><option>cs-faq</option><option>ops-faq</option></> : <><option>cs-kms</option><option>ops-kms</option></>}</select></Field>
              <Field label="유효 시작"><input className="input" type="date" /></Field>
              <Field label="유효 종료"><input className="input" type="date" /></Field>
            </div>
            <div className="row" style={{ marginTop: 12, gap: 10, padding: 12, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div className="grow"><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>답변 후보로 사용</div><div className="muted" style={{ fontSize: 12 }}>유효 기간 내에서만 검색 답변 후보로 활용됩니다.</div></div>
              <Switch checked={enabled} onChange={setEnabled} />
            </div>
          </div>

          {/* ledger flow note */}
          <div style={{ display: 'flex', gap: 10, padding: 13, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', border: '1px solid #c9d8f7' }}>
            <Icon name="info" size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.6 }}>
              <b style={{ color: 'var(--accent)' }}>정책 적용 방식</b> — 카테고리·유효기간·사용여부는 어드민 원장(KMS_ADMIN)에 먼저 저장되고, 지식화 완료 후 LightRAG 문서 ID가 연결됩니다. 통합 검색 시 <span className="mono">유효한 지식만</span> <span className="mono">allowed_doc_ids</span>/<span className="mono">allowed_answer_ids</span>로 전달되므로, 외부 시스템도 반드시 어드민 검색 API를 통해야 정책이 적용됩니다.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

window.KnowledgeWizard = KnowledgeWizard;
