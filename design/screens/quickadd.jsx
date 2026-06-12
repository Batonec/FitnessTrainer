// Screen 2: Quick-add modal (big +/- for weight and reps, 3-emoji effort, Apply)

const Stepper = ({ value, suffix, accent, big = false, dotted = false }) =>
<div style={{
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 14
}}>
    <button style={{
    width: 62, height: 62, borderRadius: 31,
    background: 'rgba(14,15,18,0.05)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)'
  }}>
      <svg width="22" height="4" viewBox="0 0 22 4"><rect width="22" height="4" rx="2" fill="#0E0F12" /></svg>
    </button>
    <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
      <div className="t-display t-num" style={{
      fontSize: big ? 72 : 56, lineHeight: 1, color: '#0E0F12', letterSpacing: -0.04
    }}>
        {value}
      </div>
      {dotted &&
    <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 8 }}>
          {[-2, -1, 0, 1, 2].map((d) =>
      <div key={d} style={{
        width: d === 0 ? 8 : 5, height: d === 0 ? 8 : 5, borderRadius: 4,
        background: d === 0 ? accent : 'rgba(14,15,18,0.18)'
      }} />
      )}
        </div>
    }
    </div>
    <button style={{
    width: 62, height: 62, borderRadius: 31,
    background: accent, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: `0 6px 16px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.4)`
  }}>
      <svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 3v16M3 11h16" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" /></svg>
    </button>
  </div>;


const EffortPicker = ({ selected = 0 }) =>
<div style={{ display: 'flex', justifyContent: 'center', gap: 14 }}>
    {[0, 1, 2].map((l) =>
  <button key={l} style={{
    width: 60, height: 60, borderRadius: 30,
    background: ['#D9F4DE', '#FBF1D6', '#FAD6D6'][l],
    border: l === selected ? '2.5px solid #0E0F12' : '2.5px solid transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 30, lineHeight: 1, transform: l === selected ? 'scale(1.05)' : 'scale(1)'
  }}>{['🙂', '😐', '😣'][l]}</button>
  )}
  </div>;


const QuickAddScreen = ({ accent = '#FF5A1F' }) =>
<PhoneShell dim>
    <StatusBar />
    {/* dimmed background of today */}
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(14,15,18,0.18)', backdropFilter: 'blur(2px)', zIndex: 5 }} />
    {/* sheet */}
    <div style={{
    position: 'absolute', left: 12, right: 12, bottom: 96, zIndex: 20,
    borderRadius: 32, overflow: 'hidden'
  }} className="liquid-glass">
      {/* exercise header */}
      <div style={{
      margin: 10, padding: '8px 14px', borderRadius: 18,
      background: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 10
    }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3, lineHeight: '18px' }}>Жим ногами</div>
          <div style={{ fontSize: 12, color: '#6E727B', marginTop: 1, lineHeight: '16px' }}>
            120кг × 11, 9, 8 <span style={{ color: accent, fontWeight: 700 }}>→ 12, 10, 9</span>
          </div>
        </div>
        <div className="chip" style={{
        padding: '3px 8px', borderRadius: 10,
        fontSize: 10.5, fontWeight: 700, color: '#6E727B', letterSpacing: 0.3, flexShrink: 0
      }}>СЕТ 4</div>
      </div>
      <div style={{ padding: '12px 22px 18px' }}>
        <div className="t-label" style={{ textAlign: 'center', marginBottom: 8 }}>ВЕС, КГ</div>
        <Stepper value="120" accent={accent} big />
        <div className="hairline" style={{ margin: '16px 8px' }} />
        <div className="t-label" style={{ textAlign: 'center', marginBottom: 8 }}>Повторений</div>
        <Stepper value="12" accent={accent} />
        <div className="hairline" style={{ margin: '16px 8px' }} />
        <div className="t-label" style={{ textAlign: 'center', marginBottom: 8 }}>КАК ОЩУЩЕНИЯ?</div>
        <EffortPicker selected={1} />
        <button style={{
        marginTop: 20, width: '100%', height: 56, borderRadius: 28,
        background: '#0E0F12', color: '#fff',
        fontSize: 17, fontWeight: 700, letterSpacing: -0.2,
        boxShadow: '0 8px 24px rgba(11,11,16,0.35)'
      }}>Сохранить</button>
      </div>
    </div>
  </PhoneShell>;


Object.assign(window, { QuickAddScreen });