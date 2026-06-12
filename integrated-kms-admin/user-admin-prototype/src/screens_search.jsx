// screens_search.jsx — 통합 검색 (구글 AI Overview 스타일 + 레이아웃 변형)
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

function ScoreBar({ score }) {
  const pct = Math.round(score * 100);
  const tone = score >= 0.85 ? 'green' : score >= 0.7 ? 'blue' : 'amber';
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className={'bar ' + tone} style={{ width: 64 }}><i style={{ width: pct + '%' }} /></div>
      <span className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-secondary)' }}>{pct}%</span>
    </div>
  );
}

function AiAnswer({ text, cites, keywords, refs, streaming }) {
  const plain = stripMd(text);
  const [shown, setShown] = useStateS(streaming ? '' : plain);
  const [done, setDone] = useStateS(!streaming);
  useEffectS(() => {
    if (!streaming) { setShown(plain); setDone(true); return; }
    setShown(''); setDone(false);
    const words = plain.split(' ');
    let i = 0;
    const tick = setInterval(() => {
      i += 2;
      setShown(words.slice(0, i).join(' '));
      if (i >= words.length) { clearInterval(tick); setDone(true); }
    }, 38);
    return () => clearInterval(tick);
  }, [text, streaming]);

  return (
    <div className="card" style={{ overflow: 'hidden', borderColor: '#c9d8f7' }}>
      <div style={{ background: 'linear-gradient(180deg, var(--accent-soft), #fff)', padding: 'var(--pad-card)' }}>
        <div className="row" style={{ gap: 9, marginBottom: 12 }}>
          <span className="row" style={{ gap: 7, color: 'var(--accent)', fontWeight: 700, fontSize: 13, letterSpacing: '0.02em' }}>
            <Icon name="sparkles" size={17} /> AI 생성형 답변
          </span>
          {!done && <Badge tone="blue" dot>생성 중</Badge>}
          {done && <Badge tone="green"><Icon name="check" size={12} /> 완료</Badge>}
          <div className="grow" />
          <span className="badge outline">생성형 KMS · cs-kms</span>
        </div>
        {done ? (
          <RichText source={text} format="markdown" imgSize="inline" />
        ) : (
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.72, color: 'var(--fg-primary)' }}>
            {shown}<span style={{ color: 'var(--accent)', fontWeight: 700 }}>▍</span>
          </p>
        )}
        {done && (
          <>
            <RefStrip images={refs} title="참조 자료" />
            <div style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>주요 키워드</div>
              <div className="row wrap" style={{ gap: 7 }}>
                {keywords.map((k) => <span key={k} className="badge blue"><Icon name="tag" size={11} /> {k}</span>)}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>근거 지식 {cites.length}건</div>
              <div className="col" style={{ gap: 7 }}>
                {cites.map((c, i) => (
                  <a key={c.id} className="row" href="#" onClick={(e) => e.preventDefault()} style={{ gap: 10, padding: '9px 11px', background: '#fff', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', textDecoration: 'none' }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>{c.title}</span>
                    <span className="muted" style={{ fontSize: 12 }}>· {c.cat}</span>
                    <div className="grow" />
                    <Icon name="arrowUR" size={14} className="muted" />
                  </a>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 14, fontSize: 11.5, color: 'var(--fg-muted)' }}>
              <Icon name="info" size={13} /> AI 생성형 답변은 등록된 지식을 바탕으로 작성되며, 정확성 검토가 필요할 수 있습니다.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FaqResult({ item, rank }) {
  return (
    <div className="card" style={{ padding: 'var(--pad-card)' }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--bg-subtle)', color: 'var(--fg-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{rank}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>{item.title}</a>
            <Badge tone="gray">{item.cat}</Badge>
            {item.format && item.format !== 'text' && <Badge tone="blue">{item.format === 'html' ? 'HTML' : 'Markdown'}</Badge>}
          </div>
          <div style={{ margin: '8px 0 0' }}>
            <RichText source={(item.body || '').replace(/^!\[.*?\]\(.*?\)\s*$/gm, '').trim()} format={item.format || 'text'} imgSize="thumb" />
          </div>
          {item.images && item.images.length > 0 && <RefStrip images={item.images} title="참조 이미지" />}
          <div className="row wrap" style={{ gap: 12, marginTop: 12 }}>
            <ScoreBar score={item.score} />
            <span className="muted" style={{ fontSize: 12 }}><Icon name="eye" size={12} /> 조회 {item.hits.toLocaleString()}</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {item.keywords.map((k) => <span key={k} className="badge outline">{k}</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegratedSearch({ t }) {
  const [query, setQuery] = useStateS(SEARCH_DEMO.query);
  const [submitted, setSubmitted] = useStateS(true);
  const [runId, setRunId] = useStateS(1);
  const [layout, setLayout] = useStateS('rail'); // rail | overview | tabs
  const [tab, setTab] = useStateS('all');
  const [incAi, setIncAi] = useStateS(true);
  const [incFaq, setIncFaq] = useStateS(true);
  const [cats, setCats] = useStateS([]);

  const run = (e) => { e && e.preventDefault(); if (!query.trim()) return; setSubmitted(true); setRunId((n) => n + 1); };
  const toggleCat = (id) => setCats((v) => v.includes(id) ? v.filter((x) => x !== id) : [...v, id]);

  const ai = <AiAnswer key={runId + '-ai'} text={SEARCH_DEMO.ai} cites={SEARCH_DEMO.aiCites} keywords={SEARCH_DEMO.keywords} refs={SEARCH_DEMO.aiRefs} streaming={t.aiStream} />;
  const faqList = SEARCH_DEMO.faq.map((f, i) => <FaqResult key={f.id} item={f} rank={i + 1} />);
  const faqBlock = (
    <div className="col" style={{ gap: 'var(--gap)' }}>
      <div className="row" style={{ gap: 8 }}>
        <Icon name="book" size={16} style={{ color: 'var(--fg-secondary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>FAQ 답변</span>
        <Badge tone="gray">{SEARCH_DEMO.faq.length}건</Badge>
      </div>
      {faqList}
    </div>
  );

  return (
    <div className="content-inner fadein">
      <div className="page-head">
        <div>
          <h1>통합 검색</h1>
          <p>질문 하나로 생성형 AI 답변과 FAQ 답변을 함께 조회합니다.</p>
        </div>
        <div className="sp" />
        <div className="seg">
          {[['rail', '출처 패널'], ['overview', 'AI 오버뷰'], ['tabs', '탭 전환']].map(([k, l]) => (
            <button key={k} className={layout === k ? 'on' : ''} onClick={() => setLayout(k)}>{l}</button>
          ))}
        </div>
      </div>

      {/* search bar */}
      <form onSubmit={run} className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="grow" style={{ position: 'relative' }}>
            <Icon name="search" size={18} style={{ position: 'absolute', left: 13, top: 10, color: 'var(--fg-secondary)' }} />
            <input className="input" style={{ paddingLeft: 40, height: 42, fontSize: 15 }} value={query}
              onChange={(e) => setQuery(e.target.value)} placeholder="질문을 입력하세요. 예) 환불은 며칠 걸리나요?" />
          </div>
          <Btn variant="primary" type="submit" icon="search" style={{ height: 42, padding: '0 22px' }}>검색</Btn>
        </div>
        <div className="row wrap" style={{ gap: 16, marginTop: 12 }}>
          <label className="check"><input type="checkbox" checked={incAi} onChange={(e) => setIncAi(e.target.checked)} /> <Icon name="sparkles" size={14} style={{ color: 'var(--accent)' }} /> AI 생성형 답변</label>
          <label className="check"><input type="checkbox" checked={incFaq} onChange={(e) => setIncFaq(e.target.checked)} /> <Icon name="book" size={14} style={{ color: 'var(--fg-secondary)' }} /> FAQ 답변</label>
          <div style={{ width: 1, height: 18, background: 'var(--border-default)' }} />
          <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="filter" size={13} /> 카테고리</span>
          {CATEGORIES.filter((c) => c.active && !c.parent).map((c) => (
            <button type="button" key={c.id} className={'chip' + (cats.includes(c.id) ? ' on' : '')} onClick={() => toggleCat(c.id)}>{c.name}</button>
          ))}
          {cats.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCats([])}>해제</button>}
        </div>
      </form>

      {submitted && (
        <div key={runId} className="fadein">
          <div className="row" style={{ marginBottom: 14, gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>"<b style={{ color: 'var(--fg-primary)' }}>{query}</b>" 검색 결과</span>
            <span className="muted" style={{ fontSize: 12.5 }}>· 약 0.42초</span>
          </div>

          {layout === 'overview' && (
            <div className="col" style={{ gap: 'var(--gap)' }}>
              {incAi && ai}
              {incFaq && faqBlock}
            </div>
          )}

          {layout === 'rail' && (
            <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', alignItems: 'start' }}>
              <div className="col" style={{ gap: 'var(--gap)' }}>
                {incAi && ai}
                {incFaq && faqBlock}
              </div>
              <div className="col" style={{ gap: 'var(--gap)', position: 'sticky', top: 0 }}>
                <Card title="추출 키워드">
                  <div className="row wrap" style={{ gap: 7 }}>
                    {SEARCH_DEMO.keywords.map((k) => <span key={k} className="badge blue"><Icon name="tag" size={11} /> {k}</span>)}
                  </div>
                </Card>
                <Card title="근거 출처">
                  <div className="col" style={{ gap: 9 }}>
                    {SEARCH_DEMO.aiCites.map((c, i) => (
                      <a key={c.id} href="#" onClick={(e) => e.preventDefault()} className="col" style={{ gap: 3, textDecoration: 'none', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-subtle)' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{i + 1}. {c.title}</span>
                        <span className="muted" style={{ fontSize: 11.5 }}>{c.cat}</span>
                      </a>
                    ))}
                  </div>
                </Card>
                <Card title="검색 범위">
                  <div className="col" style={{ gap: 8, fontSize: 12.5 }}>
                    <div className="row"><Icon name="sparkles" size={13} style={{ color: 'var(--accent)' }} /> <span className="grow">생성형 KMS</span> <Badge tone="green" dot>ON</Badge></div>
                    <div className="row"><Icon name="book" size={13} style={{ color: 'var(--fg-secondary)' }} /> <span className="grow">FAQ KMS</span> <Badge tone="green" dot>ON</Badge></div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {layout === 'tabs' && (
            <div>
              <div className="tabs" style={{ marginBottom: 16 }}>
                <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>전체</button>
                <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}><Icon name="sparkles" size={14} /> AI 답변</button>
                <button className={tab === 'faq' ? 'on' : ''} onClick={() => setTab('faq')}><Icon name="book" size={14} /> FAQ <span className="ct">{SEARCH_DEMO.faq.length}</span></button>
              </div>
              <div className="col" style={{ gap: 'var(--gap)' }}>
                {(tab === 'all' || tab === 'ai') && incAi && ai}
                {(tab === 'all' || tab === 'faq') && incFaq && faqBlock}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.IntegratedSearch = IntegratedSearch;
