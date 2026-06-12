// Screen 6: Exercise progress detail — chart + table for one exercise.

const ChartCard = ({ data, accent }) => {
  const W = 320,H = 160,P = 16;
  const scores = data.map((d) => d.score);
  const max = Math.max(...scores) * 1.1,min = Math.min(...scores) * 0.85;
  const xy = (i, s) => ({
    x: P + i / (data.length - 1) * (W - 2 * P),
    y: H - P - (s - min) / (max - min) * (H - 2 * P - 14)
  });
  const pts = data.map((d, i) => xy(i, d.score));
  const path = pts.map((p, i) => i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`).join(' ');
  const area = path + ` L${pts[pts.length - 1].x},${H - P} L${pts[0].x},${H - P} Z`;
  return (
    <div className="liquid-glass" style={{ borderRadius: 26, padding: '16px 16px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div className="t-display t-num" style={{ fontSize: 40, lineHeight: 1, color: '#0E0F12', letterSpacing: -0.04 }}>
          65<span style={{ fontSize: 17, color: '#6E727B', marginLeft: 2, fontWeight: 600 }}>кг</span>
        </div>
        <div className="chip" style={{ padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, color: '#1F9D6B' }}>↑ +12% за 60 дн</div>
        <div style={{ flex: 1 }} />
        <div className="t-num" style={{ fontSize: 13, color: '#6E727B' }}>13 повт.</div>
      </div>
      <div style={{ fontSize: 13, color: '#6E727B', marginBottom: 8 }}>Лучший сет последней тренировки</div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0.35" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* grid */}
        {[0, 1, 2, 3].map((i) =>
        <line key={i} x1={P} x2={W - P} y1={P + i / 3 * (H - 2 * P)} y2={P + i / 3 * (H - 2 * P)} stroke="rgba(14,15,18,0.05)" strokeWidth="1" />
        )}
        <path d={area} fill="url(#cg)" />
        <path d={path} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) =>
        <g key={i}>
            <circle cx={p.x} cy={p.y} r={i === pts.length - 1 ? 5 : 2.5} fill={i === pts.length - 1 ? '#fff' : accent} stroke={accent} strokeWidth={i === pts.length - 1 ? 2.5 : 0} />
          </g>
        )}
        {/* x labels every other */}
        {data.map((d, i) => i % 2 === 0 &&
        <text key={i} x={pts[i].x} y={H - 2} textAnchor="middle" fontSize="9" fill="#6E727B" fontFamily="JetBrains Mono, ui-monospace, monospace">{d.d}</text>
        )}
      </svg>
    </div>);

};

const ExerciseDetailScreen = ({ accent = '#FF5A1F' }) => {
  const e = EXERCISES.bench;
  return (
    <PhoneShell>
      <StatusBar />
      <TopBar
        pills={[
        { icon: <svg width="12" height="12" viewBox="0 0 12 12"><path d="M8 2L4 6l4 4" stroke="#2E3138" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>, label: 'Прогресс' }]
        }
        accent={accent} />
      
      <div style={{ position: 'absolute', inset: '116px 14px 30px 14px', overflow: 'hidden' }}>
        <div style={{ padding: '6px 4px 14px' }}>
          <div className="t-display" style={{ lineHeight: 1.05, color: '#0E0F12', letterSpacing: -0.5, fontSize: "36px" }}>{e.name}</div>
          <div style={{ fontSize: 13, color: '#6E727B', marginTop: 4 }}>9 тренировок · последняя 11 мая</div>
        </div>
        <ChartCard data={PROGRESS_BENCH} accent={accent} />
        {/* stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          {[
          { label: 'Рабочий', v: '65', unit: 'кг' },
          { label: 'Топ повт.', v: '13', unit: '' },
          { label: 'За 30 дн', v: '+8%', unit: '' },
          { label: 'Сетов', v: '46', unit: '' }].
          map((s, i) =>
          <div key={i} className="glass" style={{ borderRadius: 18, padding: '12px 14px' }}>
              <div className="t-label">{s.label}</div>
              <div className="t-display t-num" style={{ fontSize: 24, lineHeight: 1.1, color: '#0E0F12', marginTop: 2 }}>
                {s.v}<span style={{ fontSize: 13, color: '#6E727B', marginLeft: 2, fontWeight: 600 }}>{s.unit}</span>
              </div>
            </div>
          )}
        </div>
        {/* recent sets */}
        <div className="t-label-lg" style={{ padding: '14px 6px 8px' }}>Последние сеты</div>
        <div className="glass" style={{ borderRadius: 20, padding: '4px 16px' }}>
          {[
          { d: '11 мая', w: '65×13', e: 1 },
          { d: '02 мая', w: '65×12', e: 1 },
          { d: '25 апр', w: '65×13', e: 2 }].
          map((r, i, arr) =>
          <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', gap: 10 }}>
                <div style={{ fontSize: 13, color: '#6E727B', minWidth: 56 }}>{r.d}</div>
                <div className="t-num" style={{ fontSize: 14, fontWeight: 700, color: '#0E0F12', flex: 1 }}>{r.w}</div>
                <EffortDot level={r.e} size={22} />
              </div>
              {i < arr.length - 1 && <div className="hairline" />}
            </React.Fragment>
          )}
        </div>
      </div>
    </PhoneShell>);

};

Object.assign(window, { ExerciseDetailScreen });