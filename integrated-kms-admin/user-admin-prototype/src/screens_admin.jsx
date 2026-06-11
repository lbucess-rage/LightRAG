// screens_admin.jsx — 카테고리 / 현황·통계 / 사용자 / API 관리 / 작업 이력 / 시스템
const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA } = React;

/* =============================== Categories =============================== */
function Categories({ toast }) {
  const [cats, setCats] = useStateA(CATEGORIES);
  const [open, setOpen] = useStateA({ c1: true, c2: true, c3: true, c4: true });
  const [sel, setSel] = useStateA('c1');
  const [renameId, setRenameId] = useStateA(null);
  const [adding, setAdding] = useStateA(null); // { parent } | null

  const roots = cats.filter((c) => !c.parent);
  const childrenOf = (id) => cats.filter((c) => c.parent === id);
  const selected = cats.find((c) => c.id === sel);
  const pathOf = (c) => { const out = []; let n = c; while (n) { out.unshift(n.name); n = cats.find((x) => x.id === n.parent); } return out; };
  const isAncestor = (a, b) => { let n = cats.find((x) => x.id === b); while (n) { if (n.parent === a) return true; n = cats.find((x) => x.id === n.parent); } return false; };
  const directKnowledge = (id) => (window.KNOWLEDGE || []).filter((k) => k.cat === id);

  const commitAdd = (parent, name) => {
    const nm = (name || '').trim();
    setAdding(null);
    if (!nm) return;
    const id = 'c' + Date.now();
    setCats((prev) => [...prev, { id, parent: parent || null, name: nm, path: nm, count: 0, active: true, sort_order: 0 }]);
    setSel(id);
    toast('카테고리를 추가했습니다.');
  };
  const startAdd = (parent) => { if (parent) setOpen((o) => ({ ...o, [parent]: true })); setAdding({ parent: parent || null }); setRenameId(null); };
  const commitRename = (c, name) => {
    const nm = (name || '').trim();
    setRenameId(null);
    if (!nm || nm === c.name) return;
    setCats((prev) => prev.map((x) => x.id === c.id ? { ...x, name: nm } : x));
    toast('이름을 변경했습니다.');
  };
  const toggleActive = (c) => setCats((prev) => prev.map((x) => x.id === c.id ? { ...x, active: !x.active } : x));
  const remove = (c) => {
    const ids = new Set([c.id]); let changed = true;
    while (changed) { changed = false; cats.forEach((x) => { if (x.parent && ids.has(x.parent) && !ids.has(x.id)) { ids.add(x.id); changed = true; } }); }
    setCats((prev) => prev.filter((x) => !ids.has(x.id)));
    if (ids.has(sel)) setSel(null);
    toast('카테고리를 삭제했습니다.');
  };
  const move = (c, dir) => setCats((prev) => {
    const arr = [...prev];
    const sibs = arr.filter((x) => x.parent === c.parent);
    const si = sibs.findIndex((x) => x.id === c.id);
    const tgt = sibs[si + dir]; if (!tgt) return prev;
    const ia = arr.findIndex((x) => x.id === c.id), ib = arr.findIndex((x) => x.id === tgt.id);
    [arr[ia], arr[ib]] = [arr[ib], arr[ia]];
    return arr;
  });
  const reparent = (c, newParent) => setCats((prev) => prev.map((x) => x.id === c.id ? { ...x, parent: newParent || null } : x));

  const DraftRow = ({ parent, depth }) => (
    <div className="cat-row" style={{ background: 'var(--accent-soft)' }}>
      <span style={{ width: 20, flexShrink: 0 }} />
      <Icon name="tag" size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <input className="cat-input grow" autoFocus placeholder="새 카테고리명 입력 후 Enter"
        onKeyDown={(e) => { if (e.key === 'Enter') commitAdd(parent, e.target.value); if (e.key === 'Escape') setAdding(null); }}
        onBlur={(e) => commitAdd(parent, e.target.value)} />
    </div>
  );

  const Node = ({ c, depth }) => {
    const kids = childrenOf(c.id);
    const isOpen = open[c.id];
    const renaming = renameId === c.id;
    return (
      <div>
        <div className={'cat-row' + (sel === c.id ? ' sel' : '')} onClick={() => setSel(c.id)}>
          {kids.length ? (
            <button className="cat-tw" onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [c.id]: !o[c.id] })); }}>
              <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} />
            </button>
          ) : <span style={{ width: 20, flexShrink: 0 }} />}
          <Icon name={kids.length ? 'folder' : 'tag'} size={15} style={{ color: c.active ? 'var(--accent)' : 'var(--fg-muted)', flexShrink: 0 }} />
          {renaming ? (
            <input className="cat-input grow" autoFocus defaultValue={c.name} onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(c, e.target.value); if (e.key === 'Escape') setRenameId(null); }}
              onBlur={(e) => commitRename(c, e.target.value)} />
          ) : (
            <span className="cat-name grow" style={{ color: c.active ? undefined : 'var(--fg-muted)' }} onDoubleClick={(e) => { e.stopPropagation(); setRenameId(c.id); }}>{c.name}</span>
          )}
          {!c.active && <Badge tone="gray">비활성</Badge>}
          {!renaming && <span className="cat-count">{c.count}</span>}
          {!renaming && (
            <div className="cat-acts" onClick={(e) => e.stopPropagation()}>
              <button className="cat-act" title="하위 추가" onClick={() => startAdd(c.id)}><Icon name="plus" size={14} /></button>
              <button className="cat-act" title="이름 변경" onClick={() => { setRenameId(c.id); setAdding(null); }}><Icon name="edit" size={14} /></button>
              <button className="cat-act" title={c.active ? '비활성' : '활성'} onClick={() => toggleActive(c)}><Icon name={c.active ? 'eye' : 'dot'} size={14} /></button>
              <button className="cat-act danger" title="삭제" onClick={() => remove(c)}><Icon name="trash" size={14} /></button>
            </div>
          )}
        </div>
        {isOpen && (kids.length > 0 || adding && adding.parent === c.id) && (
          <div className="cat-children">
            {kids.map((k) => <Node key={k.id} c={k} depth={depth + 1} />)}
            {adding && adding.parent === c.id && <DraftRow parent={c.id} depth={depth + 1} />}
          </div>
        )}
      </div>
    );
  };

  const dirK = selected ? directKnowledge(selected.id) : [];
  const subCount = selected ? childrenOf(selected.id).length : 0;

  return (
    <div className="content-inner fadein">
      <div className="page-head"><div><h1>카테고리</h1><p>지식을 분류하는 트리입니다. 행에 마우스를 올려 하위 추가·이름 변경·삭제하고, 이름을 더블클릭해 바로 수정할 수 있습니다.</p></div></div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px', alignItems: 'start' }}>
        <Card title="카테고리 트리" sub={`${cats.length}개 · 활성 ${cats.filter((c) => c.active).length} · 지식 ${cats.reduce((s, c) => s + (childrenOf(c.id).length ? 0 : c.count), 0)}건`}
          actions={<div className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(Object.fromEntries(cats.map((c) => [c.id, true])))}>모두 펼치기</button>
            <Btn variant="primary" size="sm" icon="plus" onClick={() => startAdd(null)}>카테고리 추가</Btn>
          </div>}>
          <div className="cat-tree">
            {roots.map((c) => <Node key={c.id} c={c} depth={0} />)}
            {adding && adding.parent === null && <DraftRow parent={null} depth={0} />}
            {!roots.length && !adding && <div className="empty">카테고리가 없습니다. ‘카테고리 추가’로 시작하세요.</div>}
          </div>
        </Card>

        {selected ? (
          <Card title="카테고리 상세" sub="선택한 카테고리의 정보와 설정">
            <div className="col" style={{ gap: 16 }}>
              <div>
                <div className="row wrap" style={{ gap: 5, marginBottom: 8 }}>
                  {pathOf(selected).map((p, i, arr) => (
                    <React.Fragment key={i}>
                      <span style={{ fontSize: 12, fontWeight: i === arr.length - 1 ? 700 : 500, color: i === arr.length - 1 ? 'var(--fg-primary)' : 'var(--fg-secondary)' }}>{p}</span>
                      {i < arr.length - 1 && <Icon name="chevR" size={12} className="muted" />}
                    </React.Fragment>
                  ))}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)' }}>{selected.name}</span>
                  {selected.active ? <Badge tone="green" dot>활성</Badge> : <Badge tone="gray">비활성</Badge>}
                </div>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[['직접 지식', dirK.length], ['하위 카테고리', subCount], ['누적 지식', selected.count]].map(([k, v]) => (
                  <div key={k} style={{ padding: '11px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                    <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 5 }}>{k}</div>
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)' }}>{v}</div>
                  </div>
                ))}
              </div>

              <div className="row" style={{ gap: 10, padding: 12, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                <div className="grow"><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>사용 여부</div><div className="muted" style={{ fontSize: 12 }}>비활성 시 검색 필터에서 숨겨집니다.</div></div>
                <Switch checked={selected.active} onChange={() => toggleActive(selected)} />
              </div>

              <Field label="상위 카테고리">
                <select className="select" value={selected.parent || ''} onChange={(e) => reparent(selected, e.target.value)}>
                  <option value="">최상위</option>
                  {cats.filter((c) => c.id !== selected.id && !isAncestor(selected.id, c.id)).map((c) => (
                    <option key={c.id} value={c.id}>{pathOf(c).join(' › ')}</option>
                  ))}
                </select>
              </Field>

              <div className="field">
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>형제 간 순서</span>
                <div className="row" style={{ gap: 8 }}>
                  <Btn variant="secondary" size="sm" onClick={() => move(selected, -1)}><Icon name="chevD" size={14} style={{ transform: 'rotate(180deg)' }} /> 위로</Btn>
                  <Btn variant="secondary" size="sm" onClick={() => move(selected, 1)}><Icon name="chevD" size={14} /> 아래로</Btn>
                  <div className="grow" />
                  <Btn variant="secondary" size="sm" icon="plus" onClick={() => startAdd(selected.id)}>하위 추가</Btn>
                </div>
              </div>

              <div>
                <div className="row" style={{ marginBottom: 8 }}><span className="eyebrow">이 카테고리의 지식 {dirK.length}</span></div>
                {dirK.length ? (
                  <div className="col" style={{ gap: 6 }}>
                    {dirK.slice(0, 5).map((k) => (
                      <div key={k.id} className="row" style={{ gap: 8, padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
                        <Icon name={k.type === 'faq' ? 'book' : 'file'} size={14} style={{ color: 'var(--fg-secondary)', flexShrink: 0 }} />
                        <span className="grow" style={{ fontWeight: 500, color: 'var(--fg-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.title}</span>
                        {k.enabled ? <Badge tone="green" dot>사용</Badge> : <Badge tone="gray">미사용</Badge>}
                      </div>
                    ))}
                  </div>
                ) : <div className="muted" style={{ fontSize: 12.5, padding: '10px 0' }}>직접 연결된 지식이 없습니다.</div>}
              </div>

              <div className="row" style={{ gap: 8, paddingTop: 4 }}>
                <Btn variant="secondary" icon="edit" onClick={() => setRenameId(selected.id)}>이름 변경</Btn>
                <Btn variant="danger" icon="trash" onClick={() => remove(selected)}>삭제</Btn>
              </div>

              <div style={{ display: 'flex', gap: 10, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.5 }}>
                <Icon name="info" size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} /> 상위 변경·이름 변경 시 하위 경로가 자동 재계산되며, 순환 구조는 차단됩니다.
              </div>
            </div>
          </Card>
        ) : (
          <Card title="카테고리 상세">
            <div className="col" style={{ alignItems: 'center', gap: 12, padding: '32px 12px', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--bg-subtle)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="tree" size={24} /></div>
              <div className="muted" style={{ fontSize: 13 }}>왼쪽 트리에서 카테고리를 선택하면<br />상세 정보와 설정이 표시됩니다.</div>
              <Btn variant="primary" size="sm" icon="plus" onClick={() => startAdd(null)}>카테고리 추가</Btn>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* =============================== Stats dashboard =============================== */
function Stats() {
  const [period, setPeriod] = useStateA('7d');
  const [drill, setDrill] = useStateA(null);
  const trendIcon = (tr) => tr === 'up' ? <Icon name="arrowUR" size={12} style={{ color: 'var(--success)' }} /> : tr === 'down' ? <Icon name="arrowUR" size={12} style={{ color: 'var(--danger)', transform: 'rotate(90deg)' }} /> : <span className="muted">·</span>;
  const totalCat = STATS.byCategory.reduce((s, d) => s + d.count, 0);

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div><h1>현황 · 통계</h1><p>카테고리·일자·시간대·키워드별 검색 이용 현황을 분석합니다.</p></div>
        <div className="sp" />
        <div className="row" style={{ gap: 8 }}>
          <Btn variant="secondary" size="sm" icon="calendar">2026.06.03 ~ 06.09</Btn>
          <div className="seg">{[['24h', '오늘'], ['7d', '7일'], ['30d', '30일']].map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
          <Btn variant="secondary" size="sm" icon="download">내보내기</Btn>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 'var(--gap)' }}>
        {STATS.kpis.map((k) => (
          <div key={k.k} className="kpi">
            <div className="k"><span className="ic"><Icon name={k.ic} size={15} /></span> {k.k}</div>
            <div className="r"><span className="v">{k.v}</span><span className="u">{k.u}</span><span className={'d ' + (k.up ? 'up' : 'down')}>{k.d}</span></div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', marginBottom: 'var(--gap)' }}>
        <Card title="일자별 검색량" sub="최근 7일" actions={<Badge tone="green">+12% 전주 대비</Badge>}>
          <AreaChart data={STATS.byDate} height={170} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--fg-secondary)' }}>
            {STATS.byDate.map((d) => <span key={d.label} className="num">{d.label}</span>)}
          </div>
        </Card>
        <Card title="카테고리 비중">
          <div className="row" style={{ gap: 18, alignItems: 'center' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Donut data={STATS.byCategory} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-primary)' }}>{(totalCat / 1000).toFixed(1)}K</span>
                <span className="muted" style={{ fontSize: 11 }}>총 검색</span>
              </div>
            </div>
            <div className="col grow" style={{ gap: 8 }}>
              {STATS.byCategory.map((d) => (
                <div key={d.label} className="row" style={{ gap: 8, fontSize: 12.5, cursor: 'pointer' }} onClick={() => setDrill(d)}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                  <span className="grow">{d.label}</span>
                  <span className="num muted">{((d.count / totalCat) * 100).toFixed(0)}%</span>
                  <span className="num" style={{ fontWeight: 600, color: 'var(--fg-primary)', minWidth: 44, textAlign: 'right' }}>{d.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card title="시간대별 분포" sub="0~23시">
          <MiniBars data={STATS.byHour} color="var(--accent)" height={150} />
        </Card>
        <Card title="조회 키워드 TOP 8" actions={<span className="muted" style={{ fontSize: 12 }}>클릭 시 상세</span>}>
          <table className="tbl">
            <tbody>
              {STATS.keywords.map((k, i) => (
                <tr key={k.label} style={{ cursor: 'pointer' }} onClick={() => setDrill(k)}>
                  <td style={{ width: 26, paddingLeft: 6 }} className="muted num">{i + 1}</td>
                  <td><span style={{ fontWeight: 600, color: 'var(--fg-primary)' }}>{k.label}</span></td>
                  <td style={{ width: 30 }}>{trendIcon(k.trend)}</td>
                  <td style={{ width: 120 }}><div className="bar" style={{ width: '100%' }}><i style={{ width: (k.count / STATS.keywords[0].count) * 100 + '%' }} /></div></td>
                  <td className="num" style={{ width: 50, textAlign: 'right', fontWeight: 600, color: 'var(--fg-primary)' }}>{k.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {drill && (
        <Modal title={`상세: ${drill.label}`} icon="chart" onClose={() => setDrill(null)} footer={<Btn variant="primary" onClick={() => setDrill(null)}>닫기</Btn>}>
          <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 16 }}>
            <div className="kpi"><div className="k">총 조회</div><div className="r"><span className="v">{(drill.count || 0).toLocaleString()}</span></div></div>
            <div className="kpi"><div className="k">AI 채택률</div><div className="r"><span className="v">84</span><span className="u">%</span></div></div>
            <div className="kpi"><div className="k">FAQ 매칭률</div><div className="r"><span className="v">91</span><span className="u">%</span></div></div>
          </div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>일자별 추이</div>
          <AreaChart data={STATS.byDate} height={130} />
        </Modal>
      )}
    </div>
  );
}

/* =============================== Users =============================== */
function Users({ toast }) {
  const [users] = useStateA(USERS);
  const [creating, setCreating] = useStateA(false);
  const [editing, setEditing] = useStateA(null);
  const [history, setHistory] = useStateA(null);
  const [formRole, setFormRole] = useStateA('manager');

  const openCreate = () => { setFormRole('manager'); setCreating(true); };
  const openEdit = (u) => { setFormRole(u.role); setEditing(u); };
  const isAdminForm = formRole === 'admin';

  return (
    <div className="content-inner wide fadein">
      <div className="page-head"><div><h1>사용자 관리</h1><p>관리자 계정으로 사용자를 생성하고 권한(역할)·워크스페이스·사용 이력을 관리합니다.</p></div><div className="sp" /><Btn variant="primary" icon="plus" onClick={openCreate}>사용자 생성</Btn></div>

      {/* role legend */}
      <div className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        {Object.entries(ROLES).map(([k, r]) => (
          <div key={k} className="row" style={{ gap: 8, padding: '8px 12px', background: '#fff', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
            <Badge tone={r.tone}><Icon name={k === 'admin' ? 'shield' : k === 'manager' ? 'database' : 'eye'} size={11} /> {r.label}</Badge>
            <span className="muted" style={{ fontSize: 12 }}>{r.desc}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '16px 8px 8px' }}>
        <table className="tbl">
          <thead><tr><th style={{ paddingLeft: 14 }}>아이디 / 이름</th><th>역할(권한)</th><th>KMS 워크스페이스</th><th>FAQ 워크스페이스</th><th>상태</th><th>최근 로그인</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => {
              const r = ROLES[u.role] || ROLES.viewer;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="av" style={{ width: 30, height: 30, borderRadius: '50%', background: u.role === 'admin' ? 'var(--accent)' : 'var(--bg-subtle)', color: u.role === 'admin' ? '#fff' : 'var(--fg-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{u.name[0]}</span>
                      <div><div className="ttl">{u.name}</div><div className="muted mono" style={{ fontSize: 11 }}>{u.id}</div></div>
                    </div>
                  </td>
                  <td><Badge tone={r.tone}><Icon name={u.role === 'admin' ? 'shield' : u.role === 'manager' ? 'database' : 'eye'} size={11} /> {r.label}</Badge></td>
                  {r.allWs ? (
                    <td colSpan={2}><Badge tone="blue"><Icon name="check2" size={11} /> 전체 워크스페이스 접근</Badge></td>
                  ) : (
                    <><td className="mono muted" style={{ fontSize: 12 }}>{u.kms}</td><td className="mono muted" style={{ fontSize: 12 }}>{u.faq}</td></>
                  )}
                  <td>{u.active ? <Badge tone="green" dot>활성</Badge> : <Badge tone="gray">비활성</Badge>}</td>
                  <td className="num muted" style={{ fontSize: 12 }}>{u.last}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" title="수정" onClick={() => openEdit(u)}><Icon name="edit" size={15} /></button>
                      <button className="btn btn-ghost btn-sm" title="비밀번호" onClick={() => toast('비밀번호 변경 메일을 발송했습니다.')}><Icon name="lock" size={15} /></button>
                      <button className="btn btn-ghost btn-sm" title="이력" onClick={() => setHistory(u)}><Icon name="history" size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <Modal title={creating ? '사용자 생성' : `사용자 수정 · ${editing.name}`} icon="users" onClose={() => { setCreating(false); setEditing(null); }} footer={
          <><Btn variant="secondary" onClick={() => { setCreating(false); setEditing(null); }}>취소</Btn><Btn variant="primary" icon={creating ? 'plus' : 'save'} onClick={() => { setCreating(false); setEditing(null); toast(creating ? '사용자를 생성했습니다.' : '저장했습니다.'); }}>{creating ? '생성' : '저장'}</Btn></>
        }>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="아이디"><input className="input" defaultValue={editing ? editing.id : ''} disabled={!!editing} placeholder="영문·숫자" /></Field>
            <Field label="이름"><input className="input" defaultValue={editing ? editing.name : ''} /></Field>
          </div>
          {creating && <><div style={{ height: 14 }} /><Field label="초기 비밀번호 (8자 이상)"><input className="input" type="password" placeholder="••••••••" /></Field>
            <div style={{ display: 'flex', gap: 9, marginTop: 8, fontSize: 12, color: 'var(--fg-secondary)' }}><Icon name="shield" size={14} style={{ color: 'var(--success)', flexShrink: 0 }} /> 비밀번호는 서버 시드(pepper)와 함께 해시되어 저장됩니다.</div></>}
          <div style={{ height: 14 }} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="역할(권한)"><select className="select" value={formRole} onChange={(e) => setFormRole(e.target.value)}>
              <option value="admin">시스템 관리자</option>
              <option value="manager">지식 관리자</option>
              <option value="viewer">지식 조회자</option>
            </select></Field>
            <div className="field"><span style={{ fontSize: 12.5, fontWeight: 500 }}>사용 여부</span><div style={{ height: 38, display: 'flex', alignItems: 'center' }}><Switch checked={editing ? editing.active : true} onChange={() => {}} /></div></div>
          </div>
          <div style={{ height: 6 }} />
          <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 7, alignItems: 'center' }}>
            <Icon name="info" size={13} /> {ROLES[formRole].desc}
          </div>
          <div style={{ height: 14 }} />
          {isAdminForm ? (
            <div style={{ display: 'flex', gap: 10, padding: 13, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', border: '1px solid #c9d8f7' }}>
              <Icon name="check2" size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: 'var(--fg-primary-soft)', lineHeight: 1.55 }}>
                <b style={{ color: 'var(--accent)' }}>전체 접근</b> — 시스템 관리자는 워크스페이스 지정 없이 모든 KMS·FAQ 워크스페이스와 사용자·API·시스템 관리에 접근합니다.
              </div>
            </div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="KMS 워크스페이스"><select className="select" defaultValue={editing ? editing.kms : 'cs-kms'}><option>cs-kms</option><option>ops-kms</option></select></Field>
              <Field label="FAQ 워크스페이스"><select className="select" defaultValue={editing ? editing.faq : 'cs-faq'}><option>cs-faq</option><option>ops-faq</option></select></Field>
            </div>
          )}
        </Modal>
      )}

      {history && (
        <Modal lg title={`사용 이력 · ${history.name}`} icon="history" onClose={() => setHistory(null)} footer={<><Btn variant="secondary" icon="download" onClick={() => toast('CSV를 내려받았습니다.')}>CSV 다운로드</Btn><Btn variant="primary" onClick={() => setHistory(null)}>닫기</Btn></>}>
          <table className="tbl">
            <thead><tr><th style={{ paddingLeft: 6 }}>시각</th><th>동작</th><th>대상</th><th>IP</th></tr></thead>
            <tbody>
              {USER_HISTORY.map((h, i) => (
                <tr key={i}><td className="num muted" style={{ paddingLeft: 6, fontSize: 12 }}>{h.t}</td><td><Badge tone="gray">{h.action}</Badge></td><td style={{ color: 'var(--fg-primary)' }}>{h.target}</td><td className="mono muted" style={{ fontSize: 12 }}>{h.ip}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

/* =============================== API 관리 =============================== */
function ApiClients({ toast }) {
  const [clients] = useStateA(API_CLIENTS);
  const [issuing, setIssuing] = useStateA(false);
  const [key, setKey] = useStateA('');
  const sample = `curl -X POST http://127.0.0.1:9522/api/external/search \\
  -H 'Content-Type: application/json' \\
  -H 'X-KMS-ADMIN-API-Key: kmsadm_3f9c8e21d7b64a8f' \\
  -d '{"query":"환불은 며칠 걸리나요?","include_generative":true,"include_faq":true}'`;

  return (
    <div className="content-inner wide fadein">
      <div className="page-head"><div><h1>API 관리</h1><p>타 시스템이 통합 검색을 호출할 수 있도록 API Key를 발급하고 워크스페이스·호출 제한을 관리합니다.</p></div><div className="sp" /><Btn variant="primary" icon="key" onClick={() => { setIssuing(true); setKey('kmsadm_3f9c8e21d7b64a8f'); }}>API Key 발급</Btn></div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px', alignItems: 'start' }}>
        <div className="col" style={{ gap: 'var(--gap)' }}>
          {clients.map((c) => (
            <div key={c.id} className="card" style={{ padding: 'var(--pad-card)' }}>
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="link" size={18} /></div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}><span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)' }}>{c.name}</span>{c.active ? <Badge tone="green" dot>활성</Badge> : <Badge tone="gray">비활성</Badge>}</div>
                  <div className="mono muted" style={{ fontSize: 12, marginTop: 3 }}>{c.hint}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" title="키 재발급" onClick={() => toast('API Key를 재발급했습니다.')}><Icon name="refresh" size={15} /></button>
                  <button className="btn btn-ghost btn-sm" title="수정"><Icon name="edit" size={15} /></button>
                </div>
              </div>
              <div className="row wrap" style={{ gap: 18, marginTop: 14, fontSize: 12.5 }}>
                <span className="muted"><Icon name="database" size={12} /> {c.kms} / {c.faq}</span>
                <span className="muted"><Icon name="shield" size={12} /> {c.scopes.join(', ')}</span>
                <span className="muted"><Icon name="clock" size={12} /> {c.rate}/분</span>
                <span className="muted"><Icon name="chart" size={12} /> 누적 {c.calls.toLocaleString()}회</span>
                <div className="grow" /><span className="num muted">최근 {c.last}</span>
              </div>
            </div>
          ))}
        </div>

        <Card title="외부 호출 예시" sub="POST /api/external/search">
          <div style={{ background: 'var(--c-primary)', color: '#e4e9f3', borderRadius: 'var(--radius-md)', padding: 14, fontSize: 11.5, fontFamily: 'var(--font-mono)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{sample}</div>
          <Btn variant="secondary" size="sm" icon="copy" className="btn-block" style={{ marginTop: 12 }} onClick={() => toast('복사했습니다.')}>복사</Btn>
          <div style={{ display: 'flex', gap: 9, marginTop: 12, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.5 }}>
            <Icon name="info" size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} /> 스트리밍 응답은 <b className="mono">/api/external/search/stream</b> (NDJSON)을 사용하세요.
          </div>
          <div style={{ display: 'flex', gap: 9, marginTop: 10, padding: 12, background: 'var(--warning-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: '#9a5b08', lineHeight: 1.55 }}>
            <Icon name="shield" size={14} style={{ flexShrink: 0, marginTop: 1 }} /> 유효기간·카테고리·사용여부 정책은 어드민 API에서만 적용됩니다. 어드민이 유효한 지식만 <b className="mono">allowed_doc_ids</b>/<b className="mono">allowed_answer_ids</b>로 LightRAG에 전달하므로, 외부 시스템은 LightRAG를 직접 호출하지 말고 반드시 이 API를 사용해야 합니다.
          </div>
        </Card>
      </div>

      {issuing && (
        <Modal title="API Key 발급" icon="key" onClose={() => setIssuing(false)} footer={<><Btn variant="secondary" onClick={() => setIssuing(false)}>닫기</Btn><Btn variant="primary" icon="key" onClick={() => { setIssuing(false); toast('API Key를 발급했습니다.'); }}>발급</Btn></>}>
          <Field label="시스템명"><input className="input" placeholder="예) CRM 연동" /></Field>
          <div style={{ height: 14 }} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="KMS 워크스페이스"><select className="select"><option>cs-kms</option><option>ops-kms</option></select></Field>
            <Field label="FAQ 워크스페이스"><select className="select"><option>cs-faq</option><option>ops-faq</option></select></Field>
            <Field label="Scope"><select className="select"><option>search</option><option>search, read</option></select></Field>
            <Field label="분당 호출 제한"><input className="input num" type="number" defaultValue="240" /></Field>
          </div>
          <div style={{ height: 16 }} />
          <div className="eyebrow" style={{ marginBottom: 8 }}>발급된 키 (최초 1회만 표시)</div>
          <div className="row" style={{ gap: 8, padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
            <span className="mono grow" style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>{key}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => toast('복사했습니다.')}><Icon name="copy" size={14} /></button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =============================== Jobs =============================== */
const JOB_STATUS = {
  success: { tone: 'green', label: '완료', icon: 'check2' },
  running: { tone: 'blue', label: '진행 중', icon: 'loader' },
  failed: { tone: 'red', label: '실패', icon: 'xc' },
  rolledback: { tone: 'amber', label: '롤백됨', icon: 'rollback' },
};
function Jobs() {
  const [sel, setSel] = useStateA(null);
  return (
    <div className="content-inner fadein">
      <div className="page-head"><div><h1>작업 이력</h1><p>지식화·재지식화·게시 작업의 진행 상황과 중단·롤백 결과를 추적합니다.</p></div></div>
      <div className="card" style={{ padding: '16px 8px 8px' }}>
        <table className="tbl">
          <thead><tr><th style={{ paddingLeft: 14 }}>작업 대상</th><th>유형</th><th>상태</th><th>진행률</th><th>롤백</th><th>실행자</th><th>시각</th><th></th></tr></thead>
          <tbody>
            {JOBS.map((j) => {
              const m = JOB_STATUS[j.status];
              return (
                <tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => setSel(j)}>
                  <td><div className="ttl">{j.title}</div><div className="muted">{j.msg}</div></td>
                  <td><Badge tone="gray">{j.type}</Badge></td>
                  <td><Badge tone={m.tone} dot>{m.label}</Badge></td>
                  <td style={{ width: 130 }}><div className="row" style={{ gap: 8 }}><div className={'bar ' + (j.status === 'failed' ? 'red' : j.status === 'rolledback' ? 'amber' : j.status === 'success' ? 'green' : '')} style={{ width: 70 }}><i style={{ width: j.progress + '%' }} /></div><span className="num muted" style={{ fontSize: 12 }}>{j.progress}%</span></div></td>
                  <td>{j.rollback ? <Badge tone="amber"><Icon name="rollback" size={11} /> 완료</Badge> : <span className="muted">—</span>}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>{j.by}</td>
                  <td className="num muted" style={{ fontSize: 12 }}>{j.when}</td>
                  <td><Icon name="chevR" size={15} className="muted" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sel && <IngestionDetail key={sel.id} job={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

/* =============================== System =============================== */
function SystemStatus() {
  const rows = [
    { k: '어드민 API', v: '정상', port: ':9522', tone: 'green', det: 'FastAPI · uvicorn' },
    { k: 'LightRAG 연동', v: '정상', port: ':9422', tone: 'green', det: 'X-API-Key 인증' },
    { k: 'PostgreSQL', v: '정상', port: ':5432', tone: 'green', det: 'KMS_ADMIN_* 14 tables' },
    { k: '벡터 인덱스', v: '정상', port: '—', tone: 'green', det: 'cs-faq · cs-kms' },
    { k: 'PM2 프로세스', v: 'online', port: 'id 0', tone: 'green', det: 'restart 0 · uptime 4d' },
  ];
  return (
    <div className="content-inner fadein">
      <div className="page-head"><div><h1>시스템</h1><p>웹서버·연동·DB·로그 상태를 확인합니다. LightRAG 포트 + 100 으로 구동됩니다.</p></div><div className="sp" /><Btn variant="secondary" size="sm" icon="refresh">새로고침</Btn></div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card title="서비스 상태">
          <div className="col" style={{ gap: 0 }}>
            {rows.map((r, i) => (
              <div key={r.k} className="row" style={{ gap: 10, padding: '13px 2px', borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                <div className="grow"><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{r.k}</div><div className="muted" style={{ fontSize: 12 }}>{r.det}</div></div>
                <span className="mono muted" style={{ fontSize: 12 }}>{r.port}</span>
                <Badge tone="green" dot>{r.v}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card title="로그" sub="일 단위 분할 · DB 동시 기록" actions={<Btn variant="secondary" size="sm" icon="download">다운로드</Btn>}>
          <div style={{ background: 'var(--c-primary)', borderRadius: 'var(--radius-md)', padding: 14, fontSize: 11.5, fontFamily: 'var(--font-mono)', lineHeight: 1.85, color: '#9fb0c9', maxHeight: 240, overflow: 'auto' }}>
            <div><span style={{ color: '#7a8ba0' }}>09:41:02</span> <span style={{ color: '#5fd08a' }}>INFO</span> re-ingest k1 started by admin</div>
            <div><span style={{ color: '#7a8ba0' }}>09:41:08</span> <span style={{ color: '#5fd08a' }}>INFO</span> chunks=6 entities=11 reindexed</div>
            <div><span style={{ color: '#7a8ba0' }}>09:48:14</span> <span style={{ color: '#e0894a' }}>WARN</span> /documents/text upstream 504</div>
            <div><span style={{ color: '#7a8ba0' }}>09:48:14</span> <span style={{ color: '#e06b6b' }}>ERROR</span> ingest k7 failed → rollback</div>
            <div><span style={{ color: '#7a8ba0' }}>09:48:15</span> <span style={{ color: '#5fd08a' }}>INFO</span> rollback k7 complete</div>
            <div><span style={{ color: '#7a8ba0' }}>10:02:33</span> <span style={{ color: '#5fd08a' }}>INFO</span> ingest k4 running 62%</div>
            <div><span style={{ color: '#7a8ba0' }}>10:11:09</span> <span style={{ color: '#5fd08a' }}>INFO</span> external/search client=cl1 200 142ms</div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Badge tone="gray">kms-admin.log</Badge><Badge tone="gray">kms-admin.log.2026-06-08</Badge><Badge tone="gray">pm2-out.log</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { Categories, Stats, Users, ApiClients, Jobs, SystemStatus });
