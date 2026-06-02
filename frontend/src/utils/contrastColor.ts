// WCAG-luminance-based text color picker for dynamically-painted cells in the
// Sheet (column tint, FK/option color, admin row color). Avoids the trap where
// a dark column pick or a saturated row color hides the default dark-grey text.

const DARK_TEXT = '#101828'; // matches --gray-900
const LIGHT_TEXT = '#ffffff';

// Threshold tuned slightly above 0.5 so borderline pastels keep the familiar
// dark text instead of flipping to white the moment they cross the midpoint.
const LUMINANCE_THRESHOLD = 0.55;

function srgbToLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] | null {
  const s = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [lr, lg, lb] = [r, g, b].map((c) => srgbToLinear(c / 255));
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * Return a high-contrast text color for any background hex (#rrggbb).
 * Falls back to dark text on unparseable input.
 */
export function getContrastTextColor(bg: string): string {
  const rgb = parseHex(bg);
  if (!rgb) return DARK_TEXT;
  return relativeLuminance(...rgb) > LUMINANCE_THRESHOLD ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * Mix a hex color with white at the given pick-weight (0..1). Mirrors the
 * `color-mix(in srgb, <pick> <pct>%, var(--surface))` used by the Sheet's
 * column-tint CSS so contrast can be computed against the rendered color,
 * not the raw pick. `var(--surface)` is #ffffff in the current theme.
 */
export function mixWithWhite(hex: string, pickWeight: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const w = Math.max(0, Math.min(1, pickWeight));
  const mixed = rgb.map((c) => Math.round(c * w + 255 * (1 - w)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
