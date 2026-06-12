// Screen 3: Exercise picker — pick what to add next.

const PickerCard = ({ ex, accent, primary }) => {
  const e = EXERCISES[ex];
  return (
    <button style={{
      borderRadius: 22, padding: '14px 14px 14px',
      background: 'rgba(255,255,255,0.62)',
      border: '0.5px solid rgba(255,255,255,0.7)',
      backdropFilter: 'blur(18px) saturate(180%)',
      WebkitBackdropFilter: 'blur(18px) saturate(180%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(14,15,18,0.04)',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
      aspectRatio: '1 / 1', position: 'relative',
    }}>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: 'left' }}>
        <div className="t-label-xs" style={{ color: primary ? accent : '#6E727B' }}>{e.muscle}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.2, marginTop: 1, lineHeight: '18px' }}>{e.name}</div>
      </div>
      {primary && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          width: 18, height: 18, borderRadius: 9,
          background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      )}
    </button>
  );
};

const PickerScreen = ({ accent = '#FF5A1F' }) => {
  const main = ['bench', 'legpress', 'pulldown', 'shoulders', 'curl', 'tricep'];
  const more = ['row', 'fly', 'legext', 'legcurl', 'pullup'];
  return (
    <PhoneShell>
      <StatusBar />
      <TopBar
        title="Упражнение"
        sub="Шаг 2 из 2"
        pills={[
          { icon: <svg width="12" height="12" viewBox="0 0 12 12"><path d="M8 2L4 6l4 4" stroke="#2E3138" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>, label: 'Назад' },
        ]}
        accent={accent}
      />
      <div style={{ position: 'absolute', inset: '170px 14px 96px 14px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 8px' }}>
          <div className="t-label-lg">Основные · 6</div>
          <div style={{ fontSize: 11, color: accent, fontWeight: 700 }}>● ОТСЛЕЖИВАЕТСЯ</div>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14,
        }}>
          {main.map(id => <PickerCard key={id} ex={id} accent={accent} primary />)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 8px' }}>
          <div className="t-label-lg">Дополнительно</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {more.map(id => <PickerCard key={id} ex={id} accent={accent} />)}
        </div>
      </div>
      {/* bottom CTA bar */}
      <div style={{
        position: 'absolute', left: 14, right: 14, bottom: 22, zIndex: 40,
        display: 'flex', gap: 10,
      }}>
        <button className="glass-thick" style={{
          width: 60, height: 60, borderRadius: 30,
          background: '#DC4848', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 22px rgba(229,84,84,0.35)',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
        </button>
        <button style={{
          flex: 1, height: 60, borderRadius: 30,
          background: '#0E0F12', color: '#fff',
          fontSize: 17, fontWeight: 700, letterSpacing: -0.2,
          boxShadow: '0 10px 24px rgba(11,11,16,0.32)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          Жим в тренажере
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 7h8M7 3l4 4-4 4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
    </PhoneShell>
  );
};

Object.assign(window, { PickerScreen });
