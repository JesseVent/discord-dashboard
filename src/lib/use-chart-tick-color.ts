'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

// Recharts renders `tick={{ fill }}` as a raw SVG attribute, not inline
// style — and browsers don't resolve `var(--foo)` inside presentation
// attributes (confirmed: fill="var(--agl-muted-fg)" computes to black).
// Resolving the CSS variable's fully-computed color via a real DOM element
// and handing Recharts a static rgb()/oklch() string sidesteps that.
export function useChartTickColor(): string {
  const { resolvedTheme } = useTheme();
  const [color, setColor] = useState('#888888');

  useEffect(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--agl-muted-fg)';
    probe.style.display = 'none';
    document.body.appendChild(probe);
    setColor(getComputedStyle(probe).color);
    document.body.removeChild(probe);
  }, [resolvedTheme]);

  return color;
}
