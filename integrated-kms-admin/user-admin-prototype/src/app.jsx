// app.jsx — shell, login, navigation, tweaks, toasts
const { useState: useStateApp, useEffect: useEffectApp, useCallback: useCB } = React;

const NAV = [
  { cap: '지식', items: [
    { key: 'search', label: '통합 검색', icon: 'search' },
    { key: 'knowledge', label: '지식 관리', icon: 'database' },
    { key: 'categories', label: '카테고리', icon: 'tree' },
  ]},
  { cap: '분석', items: [
    { key: 'stats', label: '현황 · 통계', icon: 'chart' },
    { key: 'jobs', label: '작업 이력', icon: 'clipboard', tail: '1' },
  ]},
  { cap: '관리', items: [
    { key: 'users', label: '사용자 관리', icon: 'users' },
    { key: 'api', label: 'API 관리', icon: 'key' },
    { key: 'system', label: '시스템', icon: 'settings' },
  ]},
];
const TITLES = {
  search: ['통합 검색', '생성형 AI 답변 + FAQ 답변 통합 조회'],
  knowledge: ['지식 관리', 'FAQ·문서 지식 등록 및 지식화 관리'],
  categories: ['카테고리', '트리 분류 구성'],
  stats: ['현황 · 통계', '이용 현황 분석'],
  jobs: ['작업 이력', '지식화·롤백 추적'],
  users: ['사용자 관리', '계정·워크스페이스·이력'],
  api: ['API 관리', '외부 통합 검색 연동'],
  system: ['시스템', '운영 상태·로그'],
};

const ACCENTS = {
  blue: { c: '#2563eb', h: '#1d4fd6', a: '#1947c0', s: '#eef3ff', r: 'rgba(37,99,235,.18)' },
  emerald: { c: '#16a34a', h: '#138a3e', a: '#107434', s: '#e8f6ee', r: 'rgba(22,163,74,.18)' },
  neutral: { c: '#475569', h: '#3a4560', a: '#2f3950', s: '#eef1f6', r: 'rgba(71,85,105,.18)' },
};

/* ----------------------------- Login ----------------------------- */
function Login({ onLogin }) {
  const [id, setId] = useStateApp('admin');
  const [pw, setPw] = useStateApp('••••••••');
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      background: 'radial-gradient(1200px 500px at 50% -10%, var(--accent-soft), var(--bg-canvas) 60%)' }}>
      <div className="fadein" style={{ width: '100%', maxWidth: 400 }}>
        <div className="col" style={{ alignItems: 'center', marginBottom: 22 }}>
          <img src="assets/logo-lbucess.png" alt="LBUCESS" style={{ height: 38 }} />
        </div>
        <div className="card" style={{ padding: 30, boxShadow: 'var(--shadow-2)' }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg-primary)', letterSpacing: '-0.01em' }}>통합 지식 어드민</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>계정으로 로그인하세요.</div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); onLogin(id); }} className="col" style={{ gap: 14 }}>
            <Field label="아이디">
              <div style={{ position: 'relative' }}>
                <Icon name="users" size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-secondary)' }} />
                <input className="input" style={{ paddingLeft: 38 }} value={id} onChange={(e) => setId(e.target.value)} />
              </div>
            </Field>
            <Field label="비밀번호">
              <div style={{ position: 'relative' }}>
                <Icon name="lock" size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-secondary)' }} />
                <input className="input" type="password" style={{ paddingLeft: 38 }} value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
            </Field>
            <label className="check" style={{ marginTop: 2 }}><input type="checkbox" defaultChecked /> 로그인 상태 유지</label>
            <Btn variant="primary" type="submit" className="btn-block" style={{ height: 42, marginTop: 4 }}>로그인</Btn>
          </form>
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: 18, fontSize: 12, color: 'var(--fg-muted)' }}>
          <Icon name="shield" size={13} /> 비밀번호는 서버 시드와 함께 암호화되어 저장됩니다.
        </div>
        <div className="card" style={{ marginTop: 14, padding: 12 }}>
          <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 8, textAlign: 'center' }}>데모 · 권한별 계정 바로 보기</div>
          <div className="row" style={{ gap: 6 }}>
            {[['admin', '시스템 관리자', 'shield'], ['ejisik', '지식 관리자', 'database'], ['ksangdam', '지식 조회자', 'eye']].map(([uid, lbl, ic]) => (
              <button key={uid} className="btn btn-secondary btn-sm" style={{ flex: 1, flexDirection: 'column', height: 'auto', padding: '9px 4px', gap: 5 }} onClick={() => onLogin(uid)}>
                <Icon name={ic} size={16} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 11 }}>{lbl}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Toasts ----------------------------- */
function useToasts() {
  const [list, setList] = useStateApp([]);
  const push = useCB((msg) => {
    const id = Math.random();
    setList((l) => [...l, { id, msg }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 2600);
  }, []);
  const node = (
    <div className="toasts">
      {list.map((t) => <div key={t.id} className="toast"><Icon name="check2" size={16} /> {t.msg}</div>)}
    </div>
  );
  return [push, node];
}

/* ----------------------------- App ----------------------------- */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "blue",
  "density": "regular",
  "aiStream": true,
  "collapsed": false
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [user, setUser] = useStateApp(null);
  const [active, setActive] = useStateApp('search');
  const [toast, toastNode] = useToasts();

  // apply accent
  useEffectApp(() => {
    const a = ACCENTS[t.accent] || ACCENTS.blue;
    const r = document.documentElement.style;
    r.setProperty('--accent', a.c); r.setProperty('--accent-hover', a.h);
    r.setProperty('--accent-active', a.a); r.setProperty('--accent-soft', a.s);
    r.setProperty('--accent-ring', a.r);
  }, [t.accent]);

  useEffectApp(() => { document.body.setAttribute('data-density', t.density); }, [t.density]);

  const panel = (
    <TweaksPanel>
      <TweakSection label="외형" />
      <TweakColor label="포인트 색상" value={t.accent === 'blue' ? '#2563eb' : t.accent === 'emerald' ? '#16a34a' : '#475569'}
        options={['#2563eb', '#16a34a', '#475569']}
        onChange={(v) => setTweak('accent', v === '#2563eb' ? 'blue' : v === '#16a34a' ? 'emerald' : 'neutral')} />
      <TweakRadio label="정보 밀도" value={t.density} options={['compact', 'regular', 'comfy']} onChange={(v) => setTweak('density', v)} />
      <TweakSection label="동작" />
      <TweakToggle label="AI 답변 스트리밍" value={t.aiStream} onChange={(v) => setTweak('aiStream', v)} />
      <TweakToggle label="사이드바 접기" value={t.collapsed} onChange={(v) => setTweak('collapsed', v)} />
    </TweaksPanel>
  );

  if (!user) return <>{<Login onLogin={(id) => { setUser(USERS.find((u) => u.id === id) || USERS[0]); }} />}{panel}</>;

  const role = ROLES[user.role] || ROLES.viewer;
  const canSee = (k) => role.nav === 'all' || role.nav.includes(k);
  const effActive = canSee(active) ? active : 'search';
  const [title, sub] = TITLES[effActive];
  const screens = {
    search: <IntegratedSearch t={t} />,
    knowledge: <KnowledgeManagement t={t} toast={toast} />,
    categories: <Categories toast={toast} />,
    stats: <Stats />,
    jobs: <Jobs />,
    users: <Users toast={toast} />,
    api: <ApiClients toast={toast} />,
    system: <SystemStatus />,
  };

  return (
    <div className="app" data-collapsed={t.collapsed}>
      <aside className="sidebar">
        <div className="sb-brand">
          <img className="sb-logo" src="assets/logo-lbucess.png" alt="LBUCESS" />
          <img className="sb-mark-only" src="assets/logo-lbucess-mark.png" alt="" />
        </div>
        <nav className="sb-nav">
          {NAV.map((g) => {
            const items = g.items.filter((it) => canSee(it.key));
            if (!items.length) return null;
            return (
              <React.Fragment key={g.cap}>
                <div className="sb-cap">{g.cap}</div>
                {items.map((it) => (
                  <button key={it.key} className={'sb-item' + (effActive === it.key ? ' active' : '')} onClick={() => setActive(it.key)} title={it.label}>
                    <Icon name={it.icon} size={18} className="ico" />
                    <span className="lbl">{it.label}</span>
                    {it.tail && <span className="tail">{it.tail}</span>}
                  </button>
                ))}
              </React.Fragment>
            );
          })}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">
            <span className="av">{user.name[0]}</span>
            <div className="who"><b>{user.name}</b><span>{role.label} · {role.allWs ? '전체' : user.kms}</span></div>
            <span className="lo" onClick={() => { setUser(null); setActive('search'); }} title="로그아웃"><Icon name="logout" size={16} /></span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="tb-toggle" onClick={() => setTweak('collapsed', !t.collapsed)} title="사이드바"><Icon name="panel" size={18} /></button>
          <div className="tb-title"><b>{title}</b><span>{sub}</span></div>
          <div className="tb-spacer" />
          <span className="badge" style={{ background: role.tone === 'blue' ? 'var(--accent-soft)' : role.tone === 'green' ? 'var(--success-soft)' : 'var(--bg-subtle)', color: role.tone === 'blue' ? 'var(--accent)' : role.tone === 'green' ? 'var(--success)' : 'var(--fg-secondary)' }}>
            <Icon name={user.role === 'admin' ? 'shield' : user.role === 'manager' ? 'database' : 'eye'} size={12} /> {role.label}
          </span>
          <span className="tb-pill"><span className="dot" /> 시스템 정상</span>
          <button className="tb-icon" title="알림"><Icon name="bell" size={18} /><span className="pip" /></button>
        </header>
        <div className="content">{screens[effActive]}</div>
      </div>

      {toastNode}
      {panel}
      <Lightbox />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
