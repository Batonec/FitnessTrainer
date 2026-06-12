// Main canvas: arrange all artboards.

const ALL_SCREENS = [
  { id: 'today',    label: 'Сегодняшняя тренировка', component: 'TodayScreen' },
  { id: 'quickadd', label: 'Быстрый ввод сета',      component: 'QuickAddScreen' },
  { id: 'picker',   label: 'Выбор упражнения',       component: 'PickerScreen' },
  { id: 'history',  label: 'История',                component: 'HistoryScreen' },
  { id: 'progress', label: 'Прогресс — кольцо',      component: 'ProgressScreen' },
  { id: 'exercise', label: 'Прогресс упражнения',    component: 'ExerciseDetailScreen' },
  { id: 'weight',   label: 'Вес тела',               component: 'WeightScreen' },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#FF4D1F"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const accent = t.accent || '#FF4D1F';

  // accent palette for tweaks
  const accentOptions = [
    ACCENTS.orange.base,
    ACCENTS.cobalt.base,
    ACCENTS.lime.base,
    ACCENTS.violet.base,
  ];

  // Inject accent into CSS variable so non-React parts pick it up too
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
  }, [accent]);

  return (
    <>
      <DesignCanvas title="Trainer iOS · refreshed" subtitle="Тоньше стекло, прохладнее бумага, технические цифры">
        <DCSection id="coach" title="Совет тренера · состояния">
          <DCArtboard id="ab-coach-ready" label="ready · основной вид" width={392} height={850}>
            <CoachScreen accent={accent} state="ready" />
          </DCArtboard>
          <DCArtboard id="ab-coach-expanded" label="ready · «Почему так» раскрыто" width={392} height={850}>
            <CoachScreen accent={accent} state="ready" expanded={true} />
          </DCArtboard>
          <DCArtboard id="ab-coach-stale" label="stale · есть новая тренировка" width={392} height={850}>
            <CoachScreen accent={accent} state="ready" stale={true} />
          </DCArtboard>
          <DCArtboard id="ab-coach-pending" label="pending · ИИ обновляет" width={392} height={850}>
            <CoachScreen accent={accent} state="pending" />
          </DCArtboard>
          <DCArtboard id="ab-coach-failed" label="failed · ошибка" width={392} height={850}>
            <CoachScreen accent={accent} state="failed" />
          </DCArtboard>
          <DCArtboard id="ab-coach-none" label="none · пусто" width={392} height={850}>
            <CoachScreen accent={accent} state="none" />
          </DCArtboard>
        </DCSection>
        <DCSection id="primary" title="Основной флоу">
          <DCArtboard id="ab-today" label="Сегодня · сессия" width={392} height={850}>
            <TodayActiveWithActionsScreen accent={accent} />
          </DCArtboard>
          <DCArtboard id="ab-today-pre" label="Сегодня · до старта" width={392} height={850}>
            <TodayPreStartScreen accent={accent} />
          </DCArtboard>
          <DCArtboard id="ab-today-idle" label="Сегодня · до старта" width={392} height={850}>
            <TodayIdleScreen accent={accent} />
          </DCArtboard>
          <DCArtboard id="ab-today-idle-glass" label="Сегодня · до старта · glass" width={392} height={850}>
            <TodayIdleGlassScreen accent={accent} />
          </DCArtboard>
          <DCArtboard id="ab-quickadd" label="Ввод сета" width={392} height={850}>
            <QuickAddScreen accent={accent} />
          </DCArtboard>
        </DCSection>
        <DCSection id="data" title="История и прогресс">
          <DCArtboard id="ab-history"  label="История" width={392} height={850}>
            <HistoryScreen accent={accent} />
          </DCArtboard>
          <DCArtboard id="ab-progress" label="Прогресс" width={392} height={850}>
            <ProgressScreen accent={accent} />
          </DCArtboard>
          <DCArtboard id="ab-exercise" label="Деталь упражнения" width={392} height={850}>
            <ExerciseDetailScreen accent={accent} />
          </DCArtboard>
          <DCArtboard id="ab-weight"   label="Вес тела" width={392} height={850}>
            <WeightScreen accent={accent} />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Акцент" />
        <TweakColor
          label="Цвет"
          value={accent}
          options={accentOptions}
          onChange={v => setTweak('accent', v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
