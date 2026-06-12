// Screen 5: Progress — ring for main six + per-exercise mini chart preview.

const RingMain = ({ accent }) => {
  const overall = MAIN_SIX.reduce((s, id) => s + RING_PROGRESS[id], 0) / MAIN_SIX.length;
  return (
    <div className="liquid-glass" style={{
      borderRadius: 28, padding: '18px 18px 22px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    }}>
      <div style={{ position: 'relative', width: 220, height: 220 }}>
        <svg width="220" height="220" viewBox="0 0 220 220">
          {/* 6 concentric rings — pushed outward so the center text doesn't crash into them */}
          {MAIN_SIX.map((id, i) => {
            const r = 102 - i * 7.5;
            const p = RING_PROGRESS[id];
            const C = 2 * Math.PI * r;
            return (
              <g key={id} transform="rotate(-90 110 110)">
                <circle cx="110" cy="110" r={r} stroke="rgba(14,15,18,0.06)" strokeWidth="5" fill="none"/>
                <circle cx="110" cy="110" r={r} stroke={accent} strokeWidth="5" fill="none"
                  strokeDasharray={`${C * p} ${C}`} strokeLinecap="round"
                  style={{ opacity: 0.45 + 0.55 * (1 - i / 6) }} />
              </g>
            );
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div className="t-display t-num" style={{ fontSize: 40, lineHeight: 1, color: '#0E0F12', letterSpacing: -0.04 }}>{Math.round(overall * 100)}<span style={{ fontSize: 17, color: '#6E727B', marginLeft: 1, fontWeight: 600 }}>%</span></div>
          <div className="t-label" style={{ marginTop: 4 }}>Неделя · план</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, width: '100%' }}>
        {MAIN_SIX.map(id => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: RING_PROGRESS[id] > 0 ? accent : 'rgba(14,15,18,0.18)' }}/>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#2E3138', letterSpacing: -0.1 }}>{EXERCISES[id].short}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ExerciseProgressRow = ({ id, accent }) => {
  const e = EXERCISES[id];
  // mini sparkline
  const points = [3.0, 3.6, 4.4, 4.8, 5.2, 5.6, 6.4, 7.0, 7.8, 8.4];
  const max = Math.max(...points), min = Math.min(...points);
  return (
    <button style={{
      width: '100%', borderRadius: 22, padding: '12px 14px',
      background: 'rgba(255,255,255,0.62)',
      border: '0.5px solid rgba(255,255,255,0.7)',
      backdropFilter: 'blur(18px) saturate(180%)',
      WebkitBackdropFilter: 'blur(18px) saturate(180%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(14,15,18,0.04)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
        <div style={{ fontSize: 13, color: '#6E727B', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="tick-up" style={{ fontWeight: 700 }}>+18%</span>
          <span>· 30 дней</span>
        </div>
      </div>
      <svg width="76" height="34" viewBox="0 0 76 34" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0.3"/>
            <stop offset="1" stopColor={accent} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polyline
          points={points.map((p, i) => {
            const x = (i / (points.length - 1)) * 76;
            const y = 30 - ((p - min) / (max - min || 1)) * 26;
            return `${x},${y}`;
          }).join(' ')}
          fill="none" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        />
        <polygon
          points={[
            ...points.map((p, i) => {
              const x = (i / (points.length - 1)) * 76;
              const y = 30 - ((p - min) / (max - min || 1)) * 26;
              return `${x},${y}`;
            }),
            '76,34', '0,34',
          ].join(' ')}
          fill={`url(#g-${id})`}
        />
      </svg>
      <svg width="8" height="14" viewBox="0 0 8 14" style={{ flexShrink: 0, opacity: 0.4 }}>
        <path d="M1 1l6 6-6 6" stroke="#6E727B" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
};

const ProgressScreen = ({ accent = '#FF5A1F' }) => (
  <PhoneShell>
    <StatusBar />
    <TopBar
      title="Прогресс"
      sub="11 — 17 мая"
      pills={[
        { icon: <svg width="12" height="12" viewBox="0 0 12 12"><path d="M8 2L4 6l4 4" stroke="#2E3138" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>, label: 'История' },
      ]}
      accent={accent}
    />
    <div style={{ position: 'absolute', inset: '170px 14px 96px 14px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <RingMain accent={accent} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 0' }}>
          <div className="t-label-lg">Упражнения</div>
          <div style={{ fontSize: 13, color: '#6E727B' }}>30 дней</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MAIN_SIX.slice(0, 4).map(id => <ExerciseProgressRow key={id} id={id} accent={accent} />)}
        </div>
      </div>
    </div>
    <TabBar active="history" accent={accent} />
  </PhoneShell>
);

Object.assign(window, { ProgressScreen });
