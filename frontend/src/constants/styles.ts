/**
 * Shared colour constants.
 *
 * The app uses Ant Design's default light theme (see `<ConfigProvider>` in
 * App.tsx). Values here mirror AntD design-token defaults so inline styles
 * stay aligned with <Card>, <Tag>, <Text type="..."> and other AntD
 * primitives. Reference each constant against the corresponding AntD
 * seed/map token.
 *
 * If the AntD theme is ever customised, only this file needs to change.
 */

export const COLORS = {
  // Semantic (AntD seedToken)
  primary: '#1677ff', // antd: colorPrimary
  success: '#52c41a', // antd: colorSuccess
  warning: '#faad14', // antd: colorWarning
  danger: '#ff4d4f', // antd: colorError
  purple: '#722ed1',
  orange: '#fa8c16', // antd: orange6 — used by status accents

  // Text (AntD mapToken)
  textPrimary: '#262626', // antd: colorText
  textSecondary: '#8c8c8c', // antd: colorTextSecondary
  textTertiary: '#595959', // antd: colorTextTertiary
  textMuted: '#bfbfbf', // antd: colorTextQuaternary / disabled
  textDark: '#1f1f1f', // antd: colorTextHeading

  // Backgrounds — surfaces
  white: '#ffffff', // antd: colorBgContainer (default white surface) — also fine for text-on-dark
  bgLayout: '#fafafa', // antd: colorBgLayout (page/layout background)
  bgLight: '#f5f5f5', // antd: colorFillTertiary (alt fill, hover bg)

  // Backgrounds — semantic tints
  bgBlue: '#e6f4ff', // antd: colorPrimaryBg
  bgGreen: '#f6ffed', // antd: colorSuccessBg
  bgRed: '#fff2f0', // antd: colorErrorBg
  bgOrange: '#fff7e6',
  bgYellow: '#fffbe6', // antd: colorWarningBg
  bgCyan: '#e6fffb',
  bgPurple: '#f9f0ff',
  bgGold: '#fffbe6',

  // Borders
  border: '#f0f0f0', // antd: colorBorderSecondary / colorSplit
  borderLight: '#d9d9d9', // antd: colorBorder
} as const;

export const FONT = {
  mono: "'JetBrains Mono', monospace",
  default: 'var(--font, "DM Sans", sans-serif)',
} as const;
