// Print-friendly layout: each artboard on its own page.

const TWEAK_DEFAULTS = { accent: '#FF5A1F' };

const SCREENS = [
  { id: 'today',            label: 'Сегодня · сессия',              Comp: () => <TodayScreen accent={'#FF5A1F'} /> },
  { id: 'today-idle',       label: 'Сегодня · до старта',           Comp: () => <TodayIdleScreen accent={'#FF5A1F'} /> },
  { id: 'today-idle-glass', label: 'Сегодня · до старта · glass',   Comp: () => <TodayIdleGlassScreen accent={'#FF5A1F'} /> },
  { id: 'quickadd',         label: 'Ввод сета',                     Comp: () => <QuickAddScreen accent={'#FF5A1F'} /> },
  { id: 'history',          label: 'История',                       Comp: () => <HistoryScreen accent={'#FF5A1F'} /> },
  { id: 'progress',         label: 'Прогресс',                      Comp: () => <ProgressScreen accent={'#FF5A1F'} /> },
  { id: 'exercise',         label: 'Деталь упражнения',             Comp: () => <ExerciseDetailScreen accent={'#FF5A1F'} /> },
  { id: 'weight',           label: 'Вес тела',                      Comp: () => <WeightScreen accent={'#FF5A1F'} /> },
];

function PrintApp() {
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', '#FF5A1F');
  }, []);

  return (
    <div className="print-root">
      {SCREENS.map(s => (
        <section key={s.id} className="print-page">
          <div className="print-label">{s.label}</div>
          <div className="print-frame">
            <s.Comp />
          </div>
        </section>
      ))}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrintApp />);

// Wait for fonts + a beat, then auto-print
(async () => {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) {}
  }
  setTimeout(() => { window.print(); }, 700);
})();
