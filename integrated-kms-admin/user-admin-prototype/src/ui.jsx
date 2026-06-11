// ui.jsx — icons + shared primitives. Exposes to window for cross-file use.
const { useState, useRef, useEffect, useCallback } = React;

/* ----------------------------- Icons (lucide-style) ---------------------- */
const PATHS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  tree: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><path d="M6 9v6a2 2 0 0 0 2 2h7"/><path d="M6 9v0"/><path d="M18 9v6"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8" rx="1"/><rect x="12" y="6" width="3" height="12" rx="1"/><rect x="17" y="13" width="3" height="5" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L20 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  chevR: '<polyline points="9 18 15 12 9 6"/>',
  chevD: '<polyline points="6 9 12 15 18 9"/>',
  sparkles: '<path d="M9.94 5.06 9 2 8.06 5.06 5 6l3.06.94L9 10l.94-3.06L13 6z"/><path d="M19 11l-.7 2.3L16 14l2.3.7L19 17l.7-2.3L22 14l-2.3-.7z"/><path d="M14 18l-.5 1.5L12 20l1.5.5L14 22l.5-1.5L16 20l-1.5-.5z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M10 13.5 6.5 17M14 13.5l3.5 3.5"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  rollback: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  tag: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.58a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  truck: '<rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  pkg: '<path d="M16.5 9.4 7.5 4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  check2: '<circle cx="12" cy="12" r="9"/><polyline points="9 12 11.5 14.5 16 9.5"/>',
  xc: '<circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  loader: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  msg: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  arrowUR: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-4.5-4.5a2 2 0 0 0-2.8 0L4 20"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  folder: '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4.5l2 3H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  wand: '<path d="m3 21 11-11"/><path d="M14 4.5 15.5 3M19 9l1.5-1.5M15 3.5 16.5 5M18.5 7 20 8.5M11.5 6.5 13 8"/><circle cx="15.5" cy="6.5" r="1.2"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/>',
  listplus: '<path d="M11 12H3M16 6H3M16 18H3"/><path d="M18 9v6M21 12h-6"/>',
  squareCheck: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
};

function Icon({ name, size = 18, className = '', style = {} }) {
  return (
    <span className={'icon ' + className} style={{ fontSize: size, lineHeight: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 24 24">${PATHS[name] || ''}</svg>` }} />
  );
}

/* ----------------------------- Primitives -------------------------------- */
function Btn({ variant = 'secondary', size, icon, children, className = '', ...rest }) {
  return (
    <button className={`btn btn-${variant}${size === 'sm' ? ' btn-sm' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} />}
      {children}
    </button>
  );
}

function Badge({ tone = 'gray', dot, children }) {
  return <span className={`badge ${tone}`}>{dot && <span className="d" />}{children}</span>;
}

function Switch({ checked, onChange }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" /><span className="thumb" />
    </label>
  );
}

function Field({ label, children }) {
  return <label className="field">{label && <span>{label}</span>}{children}</label>;
}

function Card({ title, sub, actions, children, className = '', bodyClass = '' }) {
  return (
    <div className={'card ' + className}>
      {(title || actions) && (
        <div className="card-h">
          {title && <div><div className="t">{title}</div>{sub && <div className="sub">{sub}</div>}</div>}
          <div className="sp" />
          {actions}
        </div>
      )}
      <div className={'card-b ' + bodyClass}>{children}</div>
    </div>
  );
}

function Modal({ title, icon, onClose, children, footer, lg, xl }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (xl ? ' xl' : lg ? ' lg' : '')}>
        <div className="modal-h">
          {icon && <Icon name={icon} size={18} style={{ color: 'var(--accent)' }} />}
          <span className="t">{title}</span>
          <button className="x" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/* tiny inline bar chart */
function MiniBars({ data, color = 'var(--accent)', height = 120, valueKey = 'count', labelKey = 'label' }) {
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }} title={`${d[labelKey]}: ${d[valueKey]}`}>
          <div style={{ width: '100%', maxWidth: 34, height: `${(d[valueKey] / max) * 100}%`, minHeight: 3, background: color, borderRadius: '5px 5px 2px 2px', transition: 'height .4s var(--ease-standard)' }} />
          <span style={{ fontSize: 10.5, color: 'var(--fg-secondary)', whiteSpace: 'nowrap' }}>{d[labelKey]}</span>
        </div>
      ))}
    </div>
  );
}

/* line/area chart (svg) */
function AreaChart({ data, height = 150, color = 'var(--accent)' }) {
  const w = 640, h = height, pad = 8;
  const max = Math.max(...data.map((d) => d.count), 1);
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => [pad + i * step, h - pad - (d.count / max) * (h - pad * 2 - 14)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L${pts[0][0].toFixed(1)} ${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ag)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke={color} strokeWidth="2" />)}
    </svg>
  );
}

/* donut */
function Donut({ data, size = 132 }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const r = size / 2 - 12, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-subtle)" strokeWidth="14" />
      {data.map((d, i) => {
        const frac = d.count / total;
        const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth="14"
          strokeDasharray={`${(frac * C).toFixed(2)} ${C}`} strokeDashoffset={-off * C}
          transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />;
        off += frac;
        return el;
      })}
    </svg>
  );
}

/* ----------------------------- Rich text (markdown / html) ---------------- */
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inlineMd(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" onclick="return false">$1</a>');
  return s;
}
function chunkToHtml(text, format) {
  if (format === 'text') return '<p>' + escapeHtml(text).replace(/\n/g, '<br/>') + '</p>';
  const lines = text.split('\n'); let html = ''; let inList = false;
  const close = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const ln of lines) {
    if (/^\s*$/.test(ln)) { close(); continue; }
    let m;
    if ((m = ln.match(/^###\s+(.*)/))) { close(); html += '<h4>' + inlineMd(m[1]) + '</h4>'; }
    else if ((m = ln.match(/^##\s+(.*)/))) { close(); html += '<h3>' + inlineMd(m[1]) + '</h3>'; }
    else if ((m = ln.match(/^#\s+(.*)/))) { close(); html += '<h2>' + inlineMd(m[1]) + '</h2>'; }
    else if ((m = ln.match(/^[-*]\s+(.*)/))) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inlineMd(m[1]) + '</li>'; }
    else { close(); html += '<p>' + inlineMd(ln) + '</p>'; }
  }
  close();
  return html;
}
function stripMd(s) { return String(s).replace(/!\[(.*?)\]\(.*?\)/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*#`>]/g, '').replace(/\n{2,}/g, '\n').trim(); }

function RefImage({ label, src, size = 'thumb', zoomable = true }) {
  const real = src && /^(https?:|data:)/.test(src);
  const open = () => { if (zoomable) window.dispatchEvent(new CustomEvent('om:lightbox', { detail: { label, src, real } })); };
  return (
    <figure className={'ref-img ' + (size === 'inline' ? 'ref-inline' : 'ref-thumb')} style={{ margin: 0 }} onClick={open}>
      <div className="rt">
        {real ? <img src={src} alt={label || ''} /> : <Icon name="image" size={size === 'inline' ? 28 : 20} />}
        {zoomable && <span className="rt-zoom"><Icon name="eye" size={14} /></span>}
      </div>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}
function Lightbox() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const h = (e) => setData(e.detail);
    window.addEventListener('om:lightbox', h);
    const k = (e) => e.key === 'Escape' && setData(null);
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('om:lightbox', h); window.removeEventListener('keydown', k); };
  }, []);
  if (!data) return null;
  return (
    <div className="overlay" style={{ zIndex: 90 }} onMouseDown={(e) => e.target === e.currentTarget && setData(null)}>
      <div className="lightbox">
        <div className="lb-head"><Icon name="image" size={16} style={{ color: 'var(--accent)' }} /><span className="grow" style={{ fontSize: 14, fontWeight: 600 }}>{data.label || '이미지'}</span><button className="x" onClick={() => setData(null)}><Icon name="x" size={18} /></button></div>
        <div className="lb-body">
          {data.real ? <img src={data.src} alt={data.label || ''} /> : (
            <div className="lb-ph"><Icon name="image" size={56} /><div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>{data.label}</div><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>이미지 미리보기 · 데모 플레이스홀더</div></div>
          )}
        </div>
      </div>
    </div>
  );
}

function MarkdownEditor({ value, onChange, format = 'markdown', minHeight = 140, placeholder }) {
  const ref = useRef(null);
  const apply = (before, after = '', block = false) => {
    const ta = ref.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, sel = value.slice(s, e);
    const pre = block && s > 0 && value[s - 1] !== '\n' ? '\n' : '';
    const ins = pre + before + sel + after;
    const next = value.slice(0, s) + ins + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { ta.focus(); const p = s + pre.length + before.length; ta.setSelectionRange(p, p + sel.length); });
  };
  const mdTools = [
    { t: '제목', txt: 'H', fn: () => apply('## ', '', true) },
    { t: '굵게', txt: 'B', bold: true, fn: () => apply('**', '**') },
    { t: '기울임', txt: 'I', italic: true, fn: () => apply('*', '*') },
    { t: '목록', icon: 'listplus', fn: () => apply('- ', '', true) },
    { t: '링크', icon: 'link', fn: () => apply('[', '](url)') },
    { t: '이미지', icon: 'image', fn: () => apply('![', '](이미지)', true) },
    { t: '코드', txt: '</>', mono: true, fn: () => apply('`', '`') },
  ];
  const htmlTools = [
    { t: '굵게', txt: 'B', bold: true, fn: () => apply('<strong>', '</strong>') },
    { t: '제목', txt: 'H', fn: () => apply('<h3>', '</h3>', true) },
    { t: '목록', icon: 'listplus', fn: () => apply('<ul>\n  <li>', '</li>\n</ul>', true) },
    { t: '링크', icon: 'link', fn: () => apply('<a href="">', '</a>') },
    { t: '이미지', icon: 'image', fn: () => apply('<img src="" alt="', '" />', true) },
  ];
  const tools = format === 'html' ? htmlTools : mdTools;
  return (
    <div className="md-ed">
      {format !== 'text' && (
        <div className="md-toolbar">
          {tools.map((b, i) => (
            <button key={i} type="button" title={b.t} className="md-tb" onMouseDown={(e) => e.preventDefault()} onClick={b.fn}>
              {b.icon ? <Icon name={b.icon} size={15} /> : <span style={{ fontWeight: b.bold ? 800 : 600, fontStyle: b.italic ? 'italic' : 'normal', fontFamily: b.mono ? 'var(--font-mono)' : 'inherit', fontSize: b.mono ? 11 : 13 }}>{b.txt}</span>}
            </button>
          ))}
        </div>
      )}
      <textarea ref={ref} className={'textarea' + (format === 'html' ? ' mono' : '')} style={{ minHeight, border: 0, borderRadius: 0, fontSize: format === 'html' ? 12.5 : 13.5 }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

Object.assign(window, { Icon, Btn, Badge, Switch, Field, Card, Modal, MiniBars, AreaChart, Donut, RichText, RefImage, RefStrip, Lightbox, MarkdownEditor, stripMd });
function RichText({ source = '', format = 'markdown', imgSize = 'inline' }) {
  if (format === 'html') return <div className="rich" dangerouslySetInnerHTML={{ __html: source }} />;
  const lines = source.split('\n'); const parts = []; let buf = [];
  const flush = () => { if (buf.length) { parts.push({ t: 'md', v: buf.join('\n') }); buf = []; } };
  for (const ln of lines) {
    const im = ln.match(/^!\[(.*?)\]\((.*?)\)\s*$/);
    if (im) { flush(); parts.push({ t: 'img', alt: im[1], src: im[2] }); } else buf.push(ln);
  }
  flush();
  return <div className="rich">{parts.map((p, i) => p.t === 'img' ? <RefImage key={i} label={p.alt} src={p.src} size={imgSize} /> : <div key={i} dangerouslySetInnerHTML={{ __html: chunkToHtml(p.v, format) }} />)}</div>;
}
function RefStrip({ images, title = '참조 자료' }) {
  if (!images || !images.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{title} {images.length}</div>
      <div className="row wrap" style={{ gap: 10 }}>{images.map((im, i) => <RefImage key={i} label={im.label} src={im.src} size="thumb" />)}</div>
    </div>
  );
}

Object.assign(window, { Icon, Btn, Badge, Switch, Field, Card, Modal, MiniBars, AreaChart, Donut, RichText, RefImage, RefStrip, stripMd });
