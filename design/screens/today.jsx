// Screen 1: Today's workout — primary screen, exercise cards with quick add.

const TodayCard = ({ ex, sets, target, prev, accent, isActive }) => {
  const exercise = EXERCISES[ex];
  const hasSets = sets && sets.length > 0;
  return (
    <div className="glass" style={{
      borderRadius: 20, padding: '10px 12px 10px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3, lineHeight: '20px' }}>
          {exercise.name}
        </div>
        <div className="t-num" style={{ fontSize: 12.5, color: '#A8ACB4', fontWeight: 600, letterSpacing: -0.1, lineHeight: '16px', marginTop: 1 }}>
          {prev}
          <span style={{ margin: '0 6px', color: '#D6D8DD' }}>→</span>
          <span style={{ color: '#1F9D6B', fontWeight: 700 }}>{target}</span>
        </div>
        {hasSets && (
          <div className="t-num" style={{
            fontSize: 13, fontWeight: 700, letterSpacing: -0.2, color: accent,
            marginTop: 2, lineHeight: '18px',
          }}>
            {sets.map((s, i) => {
              const emoji = s.e === 2 ? ' 😣' : s.e === 0 ? ' 🙂' : '';
              return (
                <span key={i} style={{ marginRight: i < sets.length - 1 ? 10 : 0 }}>
                  {s.w}кг ×{s.r}{emoji}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <button style={{
        width: 42, height: 42, borderRadius: 21, flexShrink: 0,
        background: accent, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 5px 14px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.4)`,
      }}>
        <svg width="18" height="18" viewBox="0 0 22 22"><path d="M11 3v16M3 11h16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
};

const SessionPill = ({ accent }) => {
  const elapsedDeg = 0.62 * 360;
  return (
    <div className="liquid-glass" style={{
      height: 44, borderRadius: 22, padding: '0 6px 0 6px',
      display: 'inline-flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
        <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="16" cy="16" r="13" stroke="rgba(14,15,18,0.10)" strokeWidth="3" fill="none"/>
          <circle cx="16" cy="16" r="13" stroke={accent} strokeWidth="3" fill="none"
            strokeDasharray={`${(elapsedDeg/360)*81.7} 81.7`} strokeLinecap="round" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0E0F12' }}>2/6</div>
      </div>
      <div className="t-num" style={{ fontSize: 14, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.2, paddingRight: 8 }}>42:18</div>
    </div>
  );
};

const TodayScreen = ({ accent = '#FF5A1F' }) => (
  <PhoneShell>
    <StatusBar />
    <TopBar pills={[
      { icon: <span style={{ width:6, height:6, borderRadius:3, background:'#1F9D6B', display:'inline-block' }}/>, label: 'UID 3' },
      { label: '11 мая', tone: 'accent' },
    ]} accent={accent} />
    <div style={{
      position: 'absolute', top: 100, left: 0, right: 0,
      display: 'flex', justifyContent: 'center', zIndex: 5,
      pointerEvents: 'none',
    }}>
      <div style={{ pointerEvents: 'auto' }}>
        <SessionPill accent={accent} />
      </div>
    </div>
    <div style={{
      position: 'absolute', inset: '158px 0 96px 0',
      overflow: 'hidden', padding: '0 14px',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ padding: '6px 4px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="t-label-lg">Упражнения</div>
          <div style={{ fontSize: 13, color: '#6E727B' }}>6 упражнений · 8 сетов сделано</div>
        </div>
        {TODAY.map((row, i) => (
          <TodayCard key={i} {...row} accent={accent} isActive={row.status === 'active'} />
        ))}
        <button style={{
          marginTop: 4, height: 52, borderRadius: 26,
          background: 'rgba(14,15,18,0.04)',
          border: '1.5px dashed rgba(14,15,18,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          color: '#2E3138', fontWeight: 600, fontSize: 14,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="#2E3138" strokeWidth="2" strokeLinecap="round"/></svg>
          Добавить упражнение
        </button>
      </div>
    </div>
    <TabBar active="today" accent={accent} />
  </PhoneShell>
);

// Idle state — no active workout. Shows plan + start CTA + last workout summary.
const TodayIdleScreen = ({ accent = '#FF5A1F' }) => (
  <PhoneShell>
    <StatusBar />
    <div style={{
      position: 'absolute', inset: '60px 0 96px 0',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Hero band — bold dark intro */}
      <div style={{
        margin: '0 14px',
        borderRadius: 32,
        background: 'linear-gradient(155deg, #14110D 0%, #1F1A14 100%)',
        color: '#fff',
        padding: '20px 22px 22px',
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 14px 40px rgba(11,11,16,0.18)',
      }}>
        {/* accent glow */}
        <div style={{
          position: 'absolute', right: -80, top: -60, width: 240, height: 240,
          borderRadius: '50%', background: `radial-gradient(circle, ${accent}55 0%, transparent 65%)`,
          pointerEvents: 'none',
        }}/>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="t-label" style={{ display: 'flex', alignItems: 'center', gap: 8, color: accent }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: accent, display: 'inline-block' }}/>
            День 14 · вторник
          </div>
          <div className="t-label" style={{ color: 'rgba(255,255,255,0.5)' }}>11 МАЯ</div>
        </div>
        <div className="t-display" style={{ fontSize: 38, lineHeight: '40px', marginTop: 10, letterSpacing: -1 }}>
          Грудь<br/>+ спина
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 22 }}>
          <div>
            <div className="t-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>6</div>
            <div className="t-label-xs" style={{ color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>упражнений</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.12)' }}/>
          <div>
            <div className="t-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>14</div>
            <div className="t-label-xs" style={{ color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>сетов в плане</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.12)' }}/>
          <div>
            <div className="t-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>~52<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}> мин</span></div>
            <div className="t-label-xs" style={{ color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>средняя длит.</div>
          </div>
        </div>
      </div>

      {/* Plan list — flat, no card chrome */}
      <div style={{ padding: '18px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="t-label" style={{ color: '#0E0F12' }}>План тренировки</div>
        <div style={{ fontSize: 12, color: '#6E727B', fontWeight: 600 }}>зафиксирован</div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 22px' }}>
        {TODAY.map((row, i) => {
          const ex = EXERCISES[row.ex];
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 0',
              borderBottom: i < TODAY.length - 1 ? '1px solid rgba(14,15,18,0.07)' : 'none',
            }}>
              <div className="t-num" style={{
                width: 22, flexShrink: 0,
                fontSize: 13, fontWeight: 700, color: 'rgba(14,15,18,0.32)',
                letterSpacing: -0.3,
              }}>{String(i+1).padStart(2,'0')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ex.name}
                </div>
                <div style={{ fontSize: 12, color: '#6E727B', fontWeight: 600, letterSpacing: 0.2, marginTop: 1 }}>
                  {ex.muscle}
                </div>
              </div>
              <div className="t-num" style={{ fontSize: 14, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.2 }}>
                {row.target}
                <span style={{ fontSize: 11, color: '#6E727B', fontWeight: 600, marginLeft: 3 }}>повт</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pinned start CTA */}
      <div style={{ padding: '12px 14px 22px', background: 'linear-gradient(to top, #F6F4EF 60%, transparent)' }}>
        <button style={{
          width: '100%', height: 60, borderRadius: 30,
          background: accent, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          fontSize: 17, fontWeight: 700, letterSpacing: -0.3,
          boxShadow: `0 12px 30px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
        }}>
          <svg width="14" height="16" viewBox="0 0 14 16"><path d="M2 1.5l11 6.5-11 6.5V1.5z" fill="#fff"/></svg>
          Начать тренировку
        </button>
        <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: '#6E727B' }}>
          Последняя · 05 мая · 52 мин · 5 упражнений
        </div>
      </div>
    </div>
    <TabBar active="today" accent={accent} hideFab />
  </PhoneShell>
);

// Idle state — glass variant, matches the rest of the app's visual language.
const TodayIdleGlassScreen = ({ accent = '#FF5A1F' }) => (
  <PhoneShell>
    <StatusBar />
    <TopBar pills={[
      { icon: <span style={{ width:6, height:6, borderRadius:3, background:'#1F9D6B', display:'inline-block' }}/>, label: 'UID 3' },
      { label: '11 мая', tone: 'accent' },
    ]} accent={accent} />
    <div style={{
      position: 'absolute', inset: '108px 0 96px 0',
      overflow: 'hidden', padding: '0 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Hero — glass card */}
      <div className="liquid-glass" style={{
        borderRadius: 28, padding: '18px 18px 18px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -50, right: -50, width: 180, height: 180,
          borderRadius: '50%', background: `radial-gradient(circle, ${accent}26 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}/>
        <div className="t-label" style={{ display: 'flex', alignItems: 'center', gap: 8, color: accent }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: accent, display: 'inline-block' }}/>
          День 14 · вторник
        </div>
        <div className="t-display" style={{ fontSize: 28, lineHeight: '32px', color: '#0E0F12', marginTop: 6, letterSpacing: -0.6 }}>Грудь + спина</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, position: 'relative' }}>
          <div>
            <div className="t-num" style={{ fontSize: 18, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3 }}>6</div>
            <div className="t-label-xs" style={{ marginTop: 2 }}>упр.</div>
          </div>
          <div style={{ width: 1, background: 'rgba(14,15,18,0.10)' }}/>
          <div>
            <div className="t-num" style={{ fontSize: 18, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3 }}>14</div>
            <div className="t-label-xs" style={{ marginTop: 2 }}>сетов</div>
          </div>
          <div style={{ width: 1, background: 'rgba(14,15,18,0.10)' }}/>
          <div>
            <div className="t-num" style={{ fontSize: 18, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3 }}>~52<span style={{ fontSize: 11, color: '#6E727B' }}> мин</span></div>
            <div className="t-label-xs" style={{ marginTop: 2 }}>в среднем</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 4px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="t-label-lg">План</div>
        <div style={{ fontSize: 11, color: '#6E727B', fontWeight: 600 }}>зафиксирован</div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TODAY.map((row, i) => {
          const ex = EXERCISES[row.ex];
          return (
            <div key={i} className="glass" style={{
              borderRadius: 20, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ex.name}
                </div>
                <div style={{ fontSize: 12, color: '#6E727B', marginTop: 1 }}>{ex.muscle}</div>
              </div>
              <div className="t-num" style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: 0 }}>
                {row.target}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA — sits above tabbar */}
      <button style={{
        width: '100%', height: 56, borderRadius: 28, flexShrink: 0,
        background: accent, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 17, fontWeight: 700, letterSpacing: -0.3,
        boxShadow: `0 10px 26px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
      }}>
        <svg width="13" height="15" viewBox="0 0 14 16"><path d="M2 1.5l11 6.5-11 6.5V1.5z" fill="#fff"/></svg>
        Начать тренировку
      </button>
    </div>
    <TabBar active="today" accent={accent} hideFab />
  </PhoneShell>
);

// ── Active workout WITH action bar ─────────────────────────────────────
// As soon as the user logs at least one set, two pinned actions appear
// above the tab bar: primary "Завершить тренировку" (accent), secondary
// "Отменить тренировку" (ghost). The list scrolls under them.
// Compact session indicator. Single live signal + elapsed time — no
// "2/6" inside the ring (it was too micro to read); progress is implied
// by the active card on the list below.
const SessionInlinePill = ({ accent }) => (
  <div className="chip" style={{
    display: 'inline-flex', alignItems: 'center', gap: 7,
    padding: '6px 11px', borderRadius: 999,
    fontSize: 12.5, fontWeight: 700, letterSpacing: -0.1,
    color: '#0E0F12',
  }}>
    <span style={{
      width: 7, height: 7, borderRadius: '50%',
      background: accent,
      boxShadow: `0 0 0 3px ${accent}26`,
      display: 'inline-block', flexShrink: 0,
    }}/>
    <span className="t-num" style={{ color: '#0E0F12' }}>42:18</span>
  </div>
);

const TodayActiveWithActionsScreen = ({ accent = '#FF5A1F' }) => (
  <PhoneShell>
    <StatusBar />
    <TopBar pills={[
      { icon: <span style={{ width:6, height:6, borderRadius:3, background:'#1F9D6B', display:'inline-block' }}/>, label: 'UID 3' },
      { label: '11 мая · Вт', tone: 'accent' },
      { custom: <SessionInlinePill accent={accent} /> },
    ]} accent={accent} />
    {/* Scroll region — no separate session-pill row anymore */}
    <div style={{
      position: 'absolute', inset: '110px 0 162px 0',
      overflow: 'hidden', padding: '0 14px',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ padding: '6px 4px 0' }}>
          <div className="t-label-lg">Упражнения</div>
        </div>
        {TODAY.map((row, i) => (
          <TodayCard key={i} {...row} accent={accent} isActive={row.status === 'active'} />
        ))}
      </div>
    </div>
    {/* Pinned action bar — single compact row.
        Shown once ≥1 set has been logged. */}
    <div style={{
      position: 'absolute', left: 14, right: 14, bottom: 96, zIndex: 35,
      display: 'flex', gap: 8, alignItems: 'center',
    }}>
      <button className="chip" title="Отменить тренировку" style={{
        width: 52, height: 52, borderRadius: 26, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#DC4848',
        background: 'rgba(220,72,72,0.06)',
        border: '0.5px solid rgba(220,72,72,0.20)',
      }}>
        <svg width="16" height="16" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="#DC4848" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      <button style={{
        flex: 1, height: 52, borderRadius: 26,
        background: accent, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 15.5, fontWeight: 700, letterSpacing: -0.3,
        boxShadow: `0 10px 24px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
      }}>
        <svg width="16" height="16" viewBox="0 0 22 22"><path d="M5 11.5l4 4 8.5-9" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Завершить тренировку
      </button>
    </div>
    <TabBar active="today" accent={accent} />
  </PhoneShell>
);

// ── Pre-workout state ─────────────────────────────────────────────────
// Same layout as the active screen, but without the running timer and
// with a single primary "Начать тренировку" action instead of the
// finish/cancel pair.
const TodayPreStartScreen = ({ accent = '#FF5A1F' }) => (
  <PhoneShell>
    <StatusBar />
    <TopBar pills={[
      { icon: <span style={{ width:6, height:6, borderRadius:3, background:'#1F9D6B', display:'inline-block' }}/>, label: 'UID 3' },
      { label: '11 мая · Вт', tone: 'accent' },
    ]} accent={accent} />
    <div style={{
      position: 'absolute', inset: '110px 0 162px 0',
      overflow: 'hidden', padding: '0 14px',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ padding: '6px 4px 0' }}>
          <div className="t-label-lg">Упражнения</div>
        </div>
        {TODAY.map((row, i) => (
          // Pre-start: pass null sets so the card shows just name + prev→target
          <TodayCard key={i} {...row} sets={null} accent={accent} isActive={false} />
        ))}
      </div>
    </div>
    {/* Single primary CTA */}
    <div style={{
      position: 'absolute', left: 14, right: 14, bottom: 96, zIndex: 35,
    }}>
      <button style={{
        width: '100%', height: 52, borderRadius: 26,
        background: accent, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 16, fontWeight: 700, letterSpacing: -0.3,
        boxShadow: `0 10px 24px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
      }}>
        <svg width="14" height="16" viewBox="0 0 14 16"><path d="M2 1.5l11 6.5-11 6.5V1.5z" fill="#fff"/></svg>
        Начать тренировку
      </button>
    </div>
    <TabBar active="today" accent={accent} />
  </PhoneShell>
);

Object.assign(window, { TodayScreen, TodayIdleScreen, TodayIdleGlassScreen, TodayActiveWithActionsScreen, TodayPreStartScreen, SessionPill });
