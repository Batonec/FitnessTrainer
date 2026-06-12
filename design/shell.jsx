// Shared building blocks: phone shell, status bar, header pill row, FAB, tab bar, set chip.

const ACCENTS = {
  orange: { base: '#FF4D1F', soft: '#FFE8DE', deep: '#C8360A' },
  cobalt: { base: '#2E5BFF', soft: '#DFE7FF', deep: '#1530A8' },
  lime:   { base: '#88C400', soft: '#ECF6CC', deep: '#5C8200' },
  violet: { base: '#6B49FF', soft: '#E4DCFF', deep: '#4126B8' },
};

const PhoneShell = ({ children, dim = false, w = 392, h = 850 }) => (
  <div style={{
    width: w, height: h, borderRadius: 52, overflow: 'hidden',
    position: 'relative',
    fontFamily: 'var(--font-mono)',
    boxShadow:
      '0 0 0 1px rgba(20,16,12,0.18), 0 30px 60px rgba(20,16,12,0.18), 0 2px 4px rgba(20,16,12,0.08)',
  }}>
    <div className={"iframe-wall" + (dim ? ' dim' : '')} />
    {/* dynamic island */}
    <div style={{
      position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
      width: 122, height: 36, borderRadius: 22, background: '#0a0a0a', zIndex: 60,
    }} />
    {children}
    {/* home indicator */}
    <div style={{
      position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex',
      justifyContent: 'center', zIndex: 60, pointerEvents: 'none',
    }}>
      <div style={{ width: 132, height: 5, borderRadius: 99, background: 'rgba(20,16,12,0.32)' }} />
    </div>
  </div>
);

const StatusBar = ({ time = '9:41', dark = false }) => {
  const c = dark ? '#fff' : '#0B0B10';
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '18px 32px 0', height: 54, color: c, pointerEvents: 'none',
    }}>
      <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: -0.2 }}>{time}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="17" height="11" viewBox="0 0 17 11"><g fill={c}>
          <rect x="0" y="7" width="3" height="4" rx="0.6"/>
          <rect x="4.5" y="5" width="3" height="6" rx="0.6"/>
          <rect x="9" y="2.5" width="3" height="8.5" rx="0.6"/>
          <rect x="13.5" y="0" width="3" height="11" rx="0.6"/>
        </g></svg>
        <svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 3c2.1 0 4 .8 5.4 2.2L14.5 4C12.8 2.3 10.5 1.2 8 1.2S3.2 2.3 1.5 4L2.6 5.2C4 3.8 5.9 3 8 3zm0 3.4c1.3 0 2.4.5 3.3 1.3l1.1-1.1C11.2 5.5 9.7 4.8 8 4.8S4.8 5.5 3.6 6.6l1.1 1.1c.9-.8 2-1.3 3.3-1.3z" fill={c}/><circle cx="8" cy="9.5" r="1.4" fill={c}/></svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect x="0.4" y="0.4" width="21.2" height="11.2" rx="3.2" stroke={c} strokeOpacity="0.4" fill="none"/>
          <rect x="1.8" y="1.8" width="18.4" height="8.4" rx="1.8" fill={c}/>
          <path d="M23 4v4c.7-.3 1.3-1.2 1.3-2S23.7 4.3 23 4z" fill={c} fillOpacity="0.4"/>
        </svg>
      </div>
    </div>
  );
};

const TopBar = ({ title, sub, pills = [], onBack, accent = '#FF4D1F' }) => (
  <div style={{
    position: 'absolute', top: 56, left: 0, right: 0, zIndex: 30,
    padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 10,
  }}>
    {pills.length > 0 && (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {pills.map((p, i) => p.custom ? (
          <React.Fragment key={i}>{p.custom}</React.Fragment>
        ) : (
          <div key={i} className="chip" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 11px', borderRadius: 999,
            fontSize: 12.5, fontWeight: 600, letterSpacing: -0.1,
            color: p.tone === 'accent' ? accent : '#2E3138',
          }}>
            {p.icon}{p.label}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button className="chip" style={{
          width: 34, height: 34, borderRadius: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="4" viewBox="0 0 18 4"><g fill="#2E3138">
            <circle cx="2" cy="2" r="1.7"/><circle cx="9" cy="2" r="1.7"/><circle cx="16" cy="2" r="1.7"/>
          </g></svg>
        </button>
      </div>
    )}
    {title !== undefined && (
      <div style={{ padding: '4px 4px 0' }}>
        {sub && <div className="t-label" style={{ marginBottom: 6 }}>{sub}</div>}
        <div className="t-display" style={{ fontSize: 36, lineHeight: '38px', color: '#0E0F12' }}>{title}</div>
      </div>
    )}
  </div>
);

const TabBar = ({ active = 'today', accent = '#FF4D1F' }) => {
  const tabs = [
    { id: 'history', label: 'История' },
    { id: 'today',   label: 'Тренировка' },
    { id: 'weight',  label: 'Вес' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 14, right: 14, bottom: 22, zIndex: 40,
      display: 'flex', gap: 10, alignItems: 'center',
    }}>
      <div className="liquid-glass" style={{
        flex: 1, height: 60, borderRadius: 30,
        display: 'flex', alignItems: 'center', padding: '0 6px', gap: 2,
      }}>
        {tabs.map(t => {
          const isActive = active === t.id;
          return (
            <button key={t.id} style={{
              flex: 1, height: 48, borderRadius: 24,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              background: isActive ? '#0E0F12' : 'transparent',
              color: isActive ? '#fff' : '#2E3138',
            }}>
              <TabIcon name={t.id} active={isActive} color={isActive ? '#fff' : '#2E3138'} size={20} />
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: -0.1 }}>{t.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Compact "75кг × 12, 12, 6 😣 → 13×2, 7" set summary
const SetSummary = ({ sets, target, accent = '#FF5A1F' }) => {
  // group reps by weight (same as miniapp logic)
  const groups = [];
  sets.forEach(s => {
    const last = groups[groups.length - 1];
    if (last && last.w === s.w) last.reps.push(s);
    else groups.push({ w: s.w, reps: [s] });
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 14, color: '#3A3A42', lineHeight: 1.4 }}>
      {groups.map((g, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 600, color: '#0B0B10' }}>{g.w}<span style={{ fontSize: 11, color: '#7A7A82', marginLeft: 1 }}>кг</span></span>
          <span style={{ color: '#7A7A82' }}>×</span>
          <span className="t-num" style={{ fontWeight: 600, color: '#0B0B10' }}>
            {g.reps.map(r => r.r).join(', ')}
          </span>
          {g.reps.some(r => r.e === 2) && <span style={{ fontSize: 14 }}>😣</span>}
        </span>
      ))}
      {target && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: accent, fontWeight: 700 }}>
          <span style={{ opacity: 0.5 }}>→</span>{target}
        </span>
      )}
    </div>
  );
};

Object.assign(window, { ACCENTS, PhoneShell, StatusBar, TopBar, TabBar, SetSummary });
