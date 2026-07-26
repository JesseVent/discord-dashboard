'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

// Recharts renders `tick={{ fill }}` as a raw SVG attribute, not inline
// style. Two layers of trouble there:
// 1. Browsers don't resolve `var(--foo)` inside presentation attributes
//    (fill="var(--agl-muted-fg)" computes to black).
// 2. Even a fully-resolved value isn't safe if it serializes as a CSS
//    Color 4 function — --agl-muted-fg is defined via oklch(), and
//    getComputedStyle(el).color returns that as `lab(...)`, which the
//    SVG fill-attribute's (older, stricter) paint-value parser rejects,
//    again silently falling back to black.
// Round-tripping through a canvas guarantees a plain rgb() string: canvas
// fillStyle accepts any CSS color (including lab()), and reading pixel
// data back always yields sRGB 0-255 components.
export function useChartTickColor(): string {
  const { resolvedTheme } = useTheme();
  const [color, setColor] = useState('#888888');

  useEffect(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--agl-muted-fg)';
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    document.body.removeChild(probe);

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setColor(resolved);
      return;
    }
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    setColor(`rgb(${r}, ${g}, ${b})`);
  }, [resolvedTheme]);

  return color;
}
