// Exercise catalog (Russian names matching the original app) + sample workout history.
// All values are static for the design — no real backend.

const MAIN_SIX = ['bench', 'legpress', 'pulldown', 'shoulders', 'curl', 'tricep'];

const EXERCISES = {
  bench:    { id: 'bench',    name: 'Жим в тренажере', short: 'Жим тр.',   muscle: 'Грудь',  glyph: 'bench' },
  legpress: { id: 'legpress', name: 'Жим ногами',       short: 'Ноги',     muscle: 'Ноги',   glyph: 'legs' },
  pulldown: { id: 'pulldown', name: 'Тяга верт.',       short: 'Тяга в.',  muscle: 'Спина',  glyph: 'lat' },
  shoulders:{ id: 'shoulders',name: 'Дельты',           short: 'Дельты',   muscle: 'Плечи',  glyph: 'delts' },
  curl:     { id: 'curl',     name: 'Бицепс',           short: 'Бицепс',   muscle: 'Руки',   glyph: 'biceps' },
  tricep:   { id: 'tricep',   name: 'Трицепс',          short: 'Трицепс',  muscle: 'Руки',   glyph: 'triceps' },
  row:      { id: 'row',      name: 'Тяга горизонт.',   short: 'Тяга г.',  muscle: 'Спина',  glyph: 'row' },
  fly:      { id: 'fly',      name: 'Бабочка',          short: 'Бабочка',  muscle: 'Грудь',  glyph: 'fly' },
  legext:   { id: 'legext',   name: 'Разгибания ног',   short: 'Разг. н.', muscle: 'Ноги',   glyph: 'legext' },
  legcurl:  { id: 'legcurl',  name: 'Сгибания ног',     short: 'Сгиб. н.', muscle: 'Ноги',   glyph: 'legcurl' },
  pullup:   { id: 'pullup',   name: 'Подтягивания гр.', short: 'Подтяг.',  muscle: 'Спина',  glyph: 'pullup' },
};

// Today's planned + completed sets. `target` is what the app suggests next.
const TODAY = [
  { ex: 'bench',     prev: '65кг ×12×2, 8', sets: [{ w: 65, r: 12, e: 1 }, { w: 65, r: 12, e: 1 }, { w: 65, r: 8, e: 2 }], target: '13×2, 9', status: 'planned' },
  { ex: 'legpress',  prev: '110кг ×10, 8, 7', sets: [{ w: 120, r: 11, e: 1 }, { w: 120, r: 9, e: 2 }, { w: 120, r: 8, e: 2 }], target: '12, 10, 9', status: 'planned' },
  { ex: 'pulldown',  prev: '70кг ×12, 10, 6', sets: [{ w: 75, r: 12, e: 1 }, { w: 75, r: 12, e: 1 }, { w: 75, r: 6, e: 2 }], target: '13×2, 7', status: 'active' },
  { ex: 'shoulders', prev: '30кг ×12, 25×18', sets: [{ w: 30, r: 12, e: 1 }, { w: 25, r: 19, e: 0 }], target: '13 · 20', status: 'planned' },
  { ex: 'curl',      prev: '20кг ×13', sets: [{ w: 20, r: 14, e: 2 }], target: '15', status: 'planned' },
  { ex: 'tricep',    prev: '15кг ×18', sets: [{ w: 15, r: 19, e: 0 }], target: '20', status: 'planned' },
];

const HISTORY = [
  { date: '05 мая · Вт', dur: '52 мин', items: [
    { ex: 'legpress', sets: '120кг × 11, 9, 8' },
    { ex: 'bench',    sets: '65кг × 12, 12, 8' },
    { ex: 'pulldown', sets: '75кг × 12, 12, 6 😣' },
    { ex: 'shoulders',sets: '30×12 · 25×19' },
    { ex: 'tricep',   sets: '15кг × 19' },
  ]},
  { date: '02 мая · Сб', dur: '1ч 04', items: [
    { ex: 'pulldown', sets: '60×12 · 75×12, 8 😣' },
    { ex: 'bench',    sets: '65кг × 12, 10 😣' },
    { ex: 'legpress', sets: '120кг × 10, 8, 8 😣' },
    { ex: 'tricep',   sets: '15кг × 18 😣' },
    { ex: 'shoulders',sets: '30×8 · 20×8' },
  ]},
  { date: '25 апр · Сб', dur: '58 мин', items: [
    { ex: 'legpress', sets: '100кг × 15, 15, 15 😣' },
    { ex: 'shoulders',sets: '17,5×18 · 20×11, 11, 9 😣' },
    { ex: 'pulldown', sets: '60×12, 12 · 75×12 · 70×10 😣' },
    { ex: 'tricep',   sets: '15кг × 15' },
  ]},
];

// Per-exercise progress points (week index, top set weight×reps "load score")
const PROGRESS_BENCH = [
  { d: '12.03', w: 55, r: 10, score: 5.5 },
  { d: '19.03', w: 55, r: 12, score: 6.6 },
  { d: '26.03', w: 60, r: 10, score: 6.0 },
  { d: '02.04', w: 60, r: 12, score: 7.2 },
  { d: '09.04', w: 60, r: 14, score: 8.4 },
  { d: '18.04', w: 65, r: 12, score: 7.8 },
  { d: '25.04', w: 65, r: 13, score: 8.45 },
  { d: '02.05', w: 65, r: 12, score: 7.8 },
  { d: '11.05', w: 65, r: 13, score: 8.45 },
];

// Body weight history (last 12 weeks)
const WEIGHTS = [
  { d: '17.02', w: 84.2 },
  { d: '24.02', w: 84.0 },
  { d: '03.03', w: 83.6 },
  { d: '10.03', w: 83.4 },
  { d: '17.03', w: 83.1 },
  { d: '24.03', w: 82.8 },
  { d: '31.03', w: 82.9 },
  { d: '07.04', w: 82.4 },
  { d: '14.04', w: 82.1 },
  { d: '21.04', w: 81.9 },
  { d: '28.04', w: 81.6 },
  { d: '05.05', w: 81.4 },
  { d: '11.05', w: 81.2 },
];

// Main-six ring progress (% of weekly target hit this week)
const RING_PROGRESS = {
  bench: 0.85, legpress: 1.0, pulldown: 0.62,
  shoulders: 0.4, curl: 0.12, tricep: 0.08,
};

Object.assign(window, {
  MAIN_SIX, EXERCISES, TODAY, HISTORY, PROGRESS_BENCH, WEIGHTS, RING_PROGRESS,
});
