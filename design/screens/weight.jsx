// Screen 7: Body weight + chart, inline entry.

const WeightScreen = ({ accent = '#FF5A1F' }) => {
  const data = WEIGHTS;
  const W = 340,H = 170,P = 18;
  const vals = data.map((d) => d.w);
  const max = Math.max(...vals) + 0.4,min = Math.min(...vals) - 0.4;
  const pts = data.map((d, i) => ({
    x: P + i / (data.length - 1) * (W - 2 * P),
    y: P + (max - d.w) / (max - min) * (H - 2 * P),
    ...d
  }));
  const path = pts.map((p, i) => i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`).join(' ');
  const area = path + ` L${pts[pts.length - 1].x},${H - P} L${pts[0].x},${H - P} Z`;
  const last = data[data.length - 1].w;
  const first = data[0].w;
  const delta = (last - first).toFixed(1);

  return (
    <PhoneShell>
      <StatusBar />
      <TopBar
        title="Вес тела"
        pills={[
        { icon: <span style={{ width: 6, height: 6, borderRadius: 3, background: '#1F9D6B', display: 'inline-block' }} />, label: 'UID 3' }]
        }
        accent={accent} />
      
      <div style={{ position: 'absolute', inset: '170px 14px 96px 14px', overflow: 'hidden' }}>
        <div className="liquid-glass" style={{
          borderRadius: 28, padding: '18px 18px 14px', marginBottom: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 4 }}>
            <div className="t-display t-num" style={{ lineHeight: 0.95, color: '#0E0F12', letterSpacing: -0.04, fontSize: "40px" }}>
              {last.toFixed(1)}
              <span style={{ color: '#6E727B', marginLeft: 4, fontWeight: 600, fontSize: "17px" }}>кг</span>
            </div>
            <div style={{ flex: 1, paddingBottom: 4 }}>
              <div className="tick-up" style={{ fontSize: 14, fontWeight: 700 }}>↓ {Math.abs(parseFloat(delta))} кг</div>
              <div style={{ fontSize: 12, color: '#6E727B' }}>за 90 дней</div>
            </div>
            <button style={{
              width: 44, height: 44, borderRadius: 22, background: accent, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 6px 18px ${accent}55`
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 2v14M2 9h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </button>
          </div>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 8 }}>
            <defs>
              <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={accent} stopOpacity="0.32" />
                <stop offset="1" stopColor={accent} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* goal line */}
            <line x1={P} x2={W - P} y1={P + (max - 79.0) / (max - min) * (H - 2 * P)} y2={P + (max - 79.0) / (max - min) * (H - 2 * P)} stroke="#1F9D6B" strokeDasharray="3 4" strokeWidth="1" />
            <text x={W - P} y={P + (max - 79.0) / (max - min) * (H - 2 * P) - 4} textAnchor="end" fontSize="9" fill="#1F9D6B" fontWeight="700">ЦЕЛЬ 79.0</text>
            <path d={area} fill="url(#wg)" />
            <path d={path} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => i === pts.length - 1 &&
            <g key={i}>
                <circle cx={p.x} cy={p.y} r="6" fill={accent} opacity="0.18" />
                <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={accent} strokeWidth="2.4" />
              </g>
            )}
            {/* x labels */}
            {pts.map((p, i) => i % 3 === 0 &&
            <text key={i} x={p.x} y={H - 2} textAnchor="middle" fontSize="9" fill="#6E727B">{p.d}</text>
            )}
          </svg>
        </div>
        {/* stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[
          { l: 'Средний', v: '82.5' },
          { l: 'Минимум', v: '81.2' }].
          map((s, i) =>
          <div key={i} className="glass" style={{ borderRadius: 18, padding: '12px 14px' }}>
              <div className="t-label-xs">{s.l}</div>
              <div className="t-display t-num" style={{ fontSize: 24, lineHeight: 1.1, color: '#0E0F12', marginTop: 2 }}>{s.v}<span style={{ fontSize: 13, color: '#6E727B', marginLeft: 2, fontWeight: 600 }}>кг</span></div>
            </div>
          )}
        </div>
        {/* recent entries */}
        <div className="t-label-lg" style={{ padding: '0 6px 8px' }}>Последние записи</div>
        <div className="glass" style={{ borderRadius: 20, padding: '4px 16px' }}>
          {data.slice(-4).reverse().map((r, i, arr) =>
          <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0', gap: 10 }}>
                <div style={{ fontSize: 13, color: '#6E727B', minWidth: 60 }}>{r.d}</div>
                <div className="t-num" style={{ fontSize: 15, fontWeight: 700, color: '#0E0F12', flex: 1 }}>{r.w.toFixed(1)} кг</div>
                <button style={{ fontSize: 12, color: '#6E727B', fontWeight: 600 }}>удалить</button>
              </div>
              {i < arr.length - 1 && <div className="hairline" />}
            </React.Fragment>
          )}
        </div>
      </div>
      <TabBar active="weight" accent={accent} />
    </PhoneShell>);

};

Object.assign(window, { WeightScreen });