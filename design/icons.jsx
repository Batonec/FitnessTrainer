// Custom line-art exercise glyphs (replaces emoji icons in the original app).
// Each glyph is 1.5-stroke, designed to read at 28-48px.

const Glyph = ({ name, size = 36, color = 'currentColor', stroke = 1.6 }) => {
  const s = { width: size, height: size, fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'bench': return (
      <svg viewBox="0 0 36 36" {...s}>
        <rect x="13" y="9" width="10" height="3" rx="1.2"/>
        <path d="M18 12v9"/>
        <path d="M8 21h20"/>
        <path d="M11 21v6M25 21v6"/>
        <circle cx="6" cy="16" r="2"/><circle cx="30" cy="16" r="2"/>
      </svg>
    );
    case 'legs': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M9 8l8 11-2 9"/>
        <path d="M18 8l-3 11 5 9"/>
        <path d="M26 8l-3 9 1 11"/>
        <circle cx="6" cy="6" r="2.5"/>
      </svg>
    );
    case 'lat': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M6 7h24"/>
        <path d="M10 7v6M16 7v9M22 7v6M28 7v9"/>
        <path d="M14 16h10v4l-5 8-5-8z"/>
      </svg>
    );
    case 'delts': return (
      <svg viewBox="0 0 36 36" {...s}>
        <circle cx="18" cy="9" r="3"/>
        <path d="M11 16l7-2 7 2"/>
        <path d="M9 22l3-6M27 22l-3-6"/>
        <path d="M11 22h14l-2 7H13z"/>
      </svg>
    );
    case 'biceps': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M7 24c0-6 5-9 9-9 4 0 5-3 5-6"/>
        <path d="M16 15c1 3 4 4 7 4"/>
        <path d="M21 9l4-3M28 17h2"/>
      </svg>
    );
    case 'triceps': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M28 12c0 6-5 9-9 9-4 0-5 3-5 6"/>
        <path d="M19 21c-1-3-4-4-7-4"/>
        <path d="M15 27l-4 3M7 19H5"/>
      </svg>
    );
    case 'row': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M4 18h28"/>
        <circle cx="7" cy="18" r="2.5"/><circle cx="29" cy="18" r="2.5"/>
        <path d="M14 12l-2 6 2 6M22 12l2 6-2 6"/>
      </svg>
    );
    case 'fly': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M18 8v20"/>
        <path d="M18 14c-3-3-6-3-9-2M18 14c3-3 6-3 9-2"/>
        <path d="M18 22c-3 2-6 2-9 1M18 22c3 2 6 2 9 1"/>
      </svg>
    );
    case 'legext': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M8 26h6v-8h10l4 8"/>
        <circle cx="22" cy="14" r="3"/>
        <path d="M14 18l-3-4"/>
      </svg>
    );
    case 'legcurl': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M8 12h14v8h6l-4 6"/>
        <circle cx="22" cy="26" r="3"/>
        <path d="M22 20v3"/>
      </svg>
    );
    case 'pullup': return (
      <svg viewBox="0 0 36 36" {...s}>
        <path d="M5 7h26"/>
        <path d="M11 7v4M25 7v4"/>
        <circle cx="18" cy="14" r="2.5"/>
        <path d="M18 16v8M14 19l4-2 4 2M14 27l4-3 4 3"/>
      </svg>
    );
    default: return <svg viewBox="0 0 36 36" {...s}><circle cx="18" cy="18" r="10"/></svg>;
  }
};

// Mini tab icons
const TabIcon = ({ name, active, color, size = 22 }) => {
  const s = { width: size, height: size, fill: 'none', stroke: color, strokeWidth: active ? 2.2 : 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'history':  return <svg viewBox="0 0 24 24" {...s}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>;
    case 'today':    return <svg viewBox="0 0 24 24" {...s}><path d="M4 7h16M4 12h10M4 17h13"/></svg>;
    case 'progress': return <svg viewBox="0 0 24 24" {...s}><path d="M5 19V11M10 19V5M15 19v-7M20 19V8"/></svg>;
    case 'weight':   return <svg viewBox="0 0 24 24" {...s}><rect x="4" y="6" width="16" height="14" rx="3"/><path d="M9 11l3-3 3 3M12 8v6"/></svg>;
    default: return null;
  }
};

// Effort emoji bubbles
const EffortDot = ({ level, size = 28 }) => {
  // 0 = easy (green), 1 = ok (amber), 2 = hard (rose)
  const bg = ['#D9F4DE', '#FBF1D6', '#FAD6D6'][level];
  const face = ['🙂', '😐', '😣'][level];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: bg,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.6, lineHeight: 1, filter: 'saturate(0.9)',
    }}>{face}</div>
  );
};

Object.assign(window, { Glyph, TabIcon, EffortDot });
