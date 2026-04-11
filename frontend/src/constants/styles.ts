/** Shared color constants used across components. */

export const COLORS = {
  // Semantic
  primary: '#1677ff',
  success: '#52c41a',
  warning: '#faad14',
  danger: '#ff4d4f',
  purple: '#722ed1',

  // Text
  textPrimary: '#262626',
  textSecondary: '#8c8c8c',
  textMuted: '#bfbfbf',
  textDark: '#1f1f1f',

  // Backgrounds
  bgLight: '#f5f5f5',
  bgBlue: '#e6f4ff',
  bgGreen: '#f6ffed',
  bgRed: '#fff2f0',
  bgOrange: '#fff7e6',
  bgYellow: '#fffbe6',
  bgCyan: '#e6fffb',
  bgPurple: '#f9f0ff',
  bgGold: '#fffbe6',

  // Borders
  border: '#f0f0f0',
  borderLight: '#d9d9d9',
} as const;

export const FONT = {
  mono: "'JetBrains Mono', monospace",
  default: 'var(--font, "DM Sans", sans-serif)',
} as const;
