// "Совет тренера" — LLM next-workout recommendation card.
// Lives at the top of TodayScreen, above "План тренировки".
// Matches the app's liquid-glass language (JetBrains Mono, soft glass,
// 20–28px radii, ink ramp + signal colors).

// ── Recommendation payload (real example from the brief, status=ready) ──
const REC = {
  based_on: 56,
  model: 'claude-opus-4-8',
  focus: 'Сбалансированная тренировка верх+низ, средняя нагрузка после перерыва',
  load_type: 'medium',
  rationale:
    'С последней тренировки прошло 13 дней — это большой перерыв, поэтому не стоит сразу прыгать на максимальные веса из мая (120 кг жим ногами, 80 кг тяга). Последняя тренировка 29 мая была явно разгрузочной и прошла легко. Сейчас разумно зайти на средней нагрузке. Не выбрал heavy, потому что после 13 дней простоя резкий скачок повышает риск травмы — лучше качественная средняя сессия, затем вернуться к прогрессии.',
  exercises: [
    { name: 'Жим ногами',      sets: '90 кг × 12 × 3',     note: 'между разгрузочными 60 и пиковыми 120 после перерыва' },
    { name: 'Жим в тренажере', sets: '60 кг × 12, 12, 10', note: 'ниже пиковых 67.5, мягкий вход' },
    { name: 'Тяга верт.',      sets: '70 кг × 12 × 3',     note: 'между разгрузочными 60 и рабочими 75–80' },
    { name: 'Дельты',          sets: '20 кг × 12, 12, 10', note: 'комфортный рабочий вес' },
    { name: 'Бицепс',          sets: '15 кг × 13, 12, 12', note: 'между лёгкими 10 и рабочими 20' },
    { name: 'Трицепс',         sets: '15 кг × 14 × 2',     note: 'привычный рабочий вес' },
  ],
};

const LOAD = {
  heavy:  { label: 'Тяжёлая',  fg: '#C23A3A', bg: 'rgba(220,72,72,0.12)',  bd: 'rgba(220,72,72,0.22)' },
  medium: { label: 'Средняя',  fg: '#B5790F', bg: 'rgba(216,147,36,0.14)', bd: 'rgba(216,147,36,0.26)' },
  light:  { label: 'Лёгкая',   fg: '#15875A', bg: 'rgba(31,157,107,0.12)', bd: 'rgba(31,157,107,0.22)' },
};

// 4-point spark mark
const Spark = ({ size = 15, color = 'var(--accent)', pulse = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
    style={pulse ? { animation: 'spark-pulse 1.6s ease-in-out infinite' } : undefined}>
    <path d="M12 2.2 L13.7 9.6 L21 12 L13.7 14.4 L12 21.8 L10.3 14.4 L3 12 L10.3 9.6 Z" fill={color} />
  </svg>
);

const Spinner = ({ size = 18, stroke = 2.2, color = 'var(--accent)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
    style={{ animation: 'spin 0.8s linear infinite' }}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(14,15,18,0.12)" strokeWidth={stroke} />
    <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
  </svg>
);

// Card header — spark + title + "built on N workouts"
const CoachHeader = ({ basedOn = REC.based_on }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Spark />
      <span className="t-label" style={{ color: '#0E0F12', whiteSpace: 'nowrap' }}>Совет тренера</span>
    </div>
    {basedOn != null && (
      <span className="t-num" style={{ fontSize: 10.5, fontWeight: 600, color: '#A8ACB4', letterSpacing: 0, whiteSpace: 'nowrap', flexShrink: 0, paddingLeft: 8 }}>
        по {basedOn} трен.
      </span>
    )}
  </div>
);

const LoadChip = ({ type }) => {
  const l = LOAD[type] || LOAD.medium;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 10px 5px 8px', borderRadius: 999,
      background: l.bg, border: `0.5px solid ${l.bd}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: l.fg, display: 'inline-block' }} />
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', whiteSpace: 'nowrap',
        textTransform: 'uppercase', color: l.fg,
      }}>{l.label} нагрузка</span>
    </span>
  );
};

const CoachExerciseRow = ({ ex, last }) => (
  <div style={{
    display: 'flex', alignItems: 'baseline', gap: 12,
    padding: '9px 0',
    borderTop: '0.5px solid rgba(14,15,18,0.07)',
  }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#0E0F12', letterSpacing: -0.2, lineHeight: '17px' }}>
        {ex.name}
      </div>
      <div style={{ fontSize: 10.5, color: '#9498A1', fontWeight: 500, lineHeight: '14px', marginTop: 2, textWrap: 'pretty' }}>
        {ex.note}
      </div>
    </div>
    <div className="t-num" style={{
      fontSize: 12.5, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.2,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>{ex.sets}</div>
  </div>
);

// Secondary "Обновить" button (ghost) — optionally shows inline spinner
const RefreshBtn = ({ busy = false }) => (
  <button className="chip" style={{
    height: 46, borderRadius: 23, padding: '0 16px', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontSize: 13.5, fontWeight: 600, color: busy ? '#A8ACB4' : '#2E3138', letterSpacing: -0.2,
  }}>
    {busy
      ? <Spinner size={15} />
      : <svg width="15" height="15" viewBox="0 0 22 22" style={{ color: '#6E727B' }}>
          <path d="M19 4v5h-5M3 18v-5h5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M18 9a7.5 7.5 0 0 0-13-2.5M4 13a7.5 7.5 0 0 0 13 2.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
        </svg>}
    Обновить
  </button>
);

const ApplyBtn = ({ accent }) => (
  <button style={{
    flex: 1, height: 46, borderRadius: 23,
    background: accent, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
    fontSize: 14.5, fontWeight: 700, letterSpacing: -0.3,
    boxShadow: `0 8px 20px ${accent}50, inset 0 1px 0 rgba(255,255,255,0.3)`,
  }}>
    <svg width="16" height="16" viewBox="0 0 22 22"><path d="M4 6h14M4 11h14M4 16h9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>
    Применить в план
  </button>
);

// ── The card. `state`: ready | pending | failed | none. `expanded`,`stale`. ──
const CoachCard = ({ accent = '#FF4D1F', state = 'ready', expanded = false, stale = false }) => {

  // ---- empty / none ----
  if (state === 'none') {
    return (
      <div className="liquid-glass" style={{ borderRadius: 26, padding: '16px 16px 18px' }}>
        <CoachHeader basedOn={null} />
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center', padding: '14px 14px 4px',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 26, marginBottom: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `radial-gradient(circle at 50% 38%, ${accent}22, ${accent}0d)`,
            border: `0.5px solid ${accent}33`,
          }}>
            <Spark size={22} color={accent} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3, lineHeight: '19px' }}>
            Совет ещё не сгенерирован
          </div>
          <div style={{ fontSize: 12, color: '#6E727B', lineHeight: '17px', marginTop: 6, maxWidth: 260, textWrap: 'pretty' }}>
            Построю план следующей тренировки по вашей истории — с весами, повторами и обоснованием.
          </div>
          <button style={{
            marginTop: 16, width: '100%', height: 48, borderRadius: 24,
            background: accent, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            fontSize: 14.5, fontWeight: 700, letterSpacing: -0.3,
            boxShadow: `0 8px 20px ${accent}50, inset 0 1px 0 rgba(255,255,255,0.3)`,
          }}>
            <Spark size={16} color="#fff" />
            Сгенерировать совет
          </button>
        </div>
      </div>
    );
  }

  // ---- failed ----
  if (state === 'failed') {
    return (
      <div className="liquid-glass" style={{ borderRadius: 26, padding: '16px 16px 18px' }}>
        <CoachHeader basedOn={null} />
        <div style={{ display: 'flex', gap: 12, marginTop: 14, alignItems: 'flex-start' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 20, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(220,72,72,0.10)', border: '0.5px solid rgba(220,72,72,0.22)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M12 7v6" stroke="#DC4848" strokeWidth="2.2" strokeLinecap="round"/>
              <circle cx="12" cy="17" r="1.3" fill="#DC4848"/>
              <circle cx="12" cy="12" r="9" stroke="#DC4848" strokeWidth="1.6" fill="none" opacity="0.5"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3 }}>
              Не удалось обновить совет
            </div>
            <div style={{ fontSize: 12, color: '#6E727B', lineHeight: '17px', marginTop: 4, textWrap: 'pretty' }}>
              Модель не ответила вовремя (тайм-аут 20 с). Это бывает при высокой нагрузке — попробуйте ещё раз.
            </div>
          </div>
        </div>
        <button style={{
          marginTop: 16, width: '100%', height: 46, borderRadius: 23,
          background: 'rgba(14,15,18,0.05)', border: '0.5px solid rgba(14,15,18,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          fontSize: 14, fontWeight: 700, color: '#2E3138', letterSpacing: -0.3,
        }}>
          <svg width="15" height="15" viewBox="0 0 22 22">
            <path d="M19 4v5h-5M3 18v-5h5" stroke="#2E3138" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 9a7.5 7.5 0 0 0-13-2.5M4 13a7.5 7.5 0 0 0 13 2.5" stroke="#2E3138" strokeWidth="2" fill="none" strokeLinecap="round"/>
          </svg>
          Повторить
        </button>
      </div>
    );
  }

  // ---- ready (also the base layer under `pending`) ----
  const dim = state === 'pending';
  return (
    <div className="liquid-glass" style={{ borderRadius: 26, position: 'relative', overflow: 'hidden' }}>
      {/* stale badge — unobtrusive ribbon at the very top of the card */}
      {stale && (
        <button style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px',
          background: 'rgba(216,147,36,0.12)',
          borderBottom: '0.5px solid rgba(216,147,36,0.22)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#D89324', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#9A6A12', letterSpacing: -0.1, flex: 1, textAlign: 'left' }}>
            Есть тренировка новее, чем эта рекомендация
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B5790F', letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Обновить
            <svg width="12" height="12" viewBox="0 0 22 22"><path d="M19 4v5h-5M3 18v-5h5" stroke="#B5790F" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M18 9a7.5 7.5 0 0 0-13-2.5M4 13a7.5 7.5 0 0 0 13 2.5" stroke="#B5790F" strokeWidth="2.2" fill="none" strokeLinecap="round"/></svg>
          </span>
        </button>
      )}

      <div style={{ padding: '16px 16px 16px', opacity: dim ? 0.4 : 1, filter: dim ? 'saturate(0.7)' : 'none', transition: 'opacity 200ms' }}>
        <CoachHeader />

        {/* focus headline */}
        <div style={{ fontSize: 18, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.4, lineHeight: '23px', marginTop: 11, textWrap: 'balance' }}>
          {REC.focus}
        </div>

        {/* load chip */}
        <div style={{ marginTop: 11 }}>
          <LoadChip type={REC.load_type} />
        </div>

        {/* exercises */}
        <div style={{ marginTop: 14 }}>
          {REC.exercises.map((ex, i) => (
            <CoachExerciseRow key={i} ex={ex} last={i === REC.exercises.length - 1} />
          ))}
        </div>

        {/* rationale — collapsible */}
        <button style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 0 2px', borderTop: '0.5px solid rgba(14,15,18,0.07)', marginTop: 4,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="#6E727B" strokeWidth="1.6" fill="none"/><path d="M9.5 9.2a2.6 2.6 0 0 1 4.8 1.1c0 1.7-2.3 2-2.3 3.4" stroke="#6E727B" strokeWidth="1.7" fill="none" strokeLinecap="round"/><circle cx="12" cy="17.2" r="1.1" fill="#6E727B"/></svg>
            <span className="t-label" style={{ color: '#2E3138' }}>Почему так</span>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}>
            <path d="M6 9l6 6 6-6" stroke="#6E727B" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {expanded && (
          <div style={{ fontSize: 12, color: '#5C606A', lineHeight: '18px', marginTop: 8, textWrap: 'pretty' }}>
            {REC.rationale}
          </div>
        )}

        {/* actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <RefreshBtn />
          <ApplyBtn accent={accent} />
        </div>
      </div>

      {/* pending overlay */}
      {dim && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div className="glass-thick" style={{
            display: 'flex', alignItems: 'center', gap: 11,
            padding: '12px 18px', borderRadius: 999,
          }}>
            <Spinner size={20} color={accent} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.2, whiteSpace: 'nowrap' }}>ИИ обновляет план…</span>
              <span style={{ fontSize: 10.5, color: '#6E727B', marginTop: 1, whiteSpace: 'nowrap' }}>обычно 15–20 секунд</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Phone-screen wrapper: card in its real placement at the top of Today ──
const CoachScreen = ({ accent = '#FF4D1F', state = 'ready', expanded = false, stale = false }) => (
  <PhoneShell dim={state === 'pending'}>
    <StatusBar />
    <TopBar pills={[
      { icon: <span style={{ width:6, height:6, borderRadius:3, background:'#1F9D6B', display:'inline-block' }}/>, label: 'UID 3' },
      { label: '11 июн · Ср', tone: 'accent' },
    ]} accent={accent} />
    <div style={{
      position: 'absolute', inset: '108px 0 96px 0',
      overflow: 'hidden', padding: '0 14px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <CoachCard accent={accent} state={state} expanded={expanded} stale={stale} />

      {/* the plan section it sits above — peeking for placement context */}
      <div style={{ padding: '2px 4px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="t-label-lg">План тренировки</div>
        <div style={{ fontSize: 11, color: '#6E727B', fontWeight: 600 }}>черновик</div>
      </div>
      {TODAY.slice(0, 3).map((row, i) => {
        const ex = EXERCISES[row.ex];
        return (
          <div key={i} className="glass" style={{
            borderRadius: 18, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 12, opacity: 1 - i * 0.16,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0E0F12', letterSpacing: -0.3 }}>{ex.name}</div>
              <div style={{ fontSize: 11.5, color: '#6E727B', marginTop: 1 }}>{ex.muscle}</div>
            </div>
            <div className="t-num" style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>{row.target}</div>
          </div>
        );
      })}
    </div>
    <TabBar active="today" accent={accent} />
  </PhoneShell>
);

Object.assign(window, { CoachCard, CoachScreen, Spark });
