# Макеты приложения (Claude Design)

Снимок дизайн-проекта **Trainer iOS** из [Claude Design](https://claude.ai/design) —
HTML/JSX-прототипы всех экранов приложения. Это исходник визуального языка
(liquid glass, JetBrains Mono, ink-палитра, accent `#FF4D1F`), по которому
написан SwiftUI-клиент в [`../ios`](../ios).

- `Trainer iOS.html` — точка входа (открыть в браузере)
- `screens/*.jsx` — экраны: today, history, progress, weight, picker, quickadd,
  exercise, **coach** (карточка «Совет тренера»)
- `styles.css`, `ios-frame.jsx`, `shell.jsx`, `icons.jsx` — дизайн-токены и рамка телефона
- `_*.png` — снапшоты канваса

## Как обновить

Handoff-ссылки Claude Design одноразовые, поэтому синк полуавтоматический:

1. В Claude Design открой проект → **Share / Handoff** → скопируй ссылку.
2. Скажи Claude Code: «синкни макеты <ссылка>».
3. Он скачает бандл, положит изменившиеся файлы сюда и закоммитит.

Чаты с дизайн-ассистентом и загруженные фото из бандла сюда сознательно
не копируются (репозиторий публичный).

_Последний синк: 2026-06-12._
