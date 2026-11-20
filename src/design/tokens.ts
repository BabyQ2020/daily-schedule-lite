import type { ThemeConfig } from 'antd';

/** 设计令牌：全应用唯一的视觉常量来源（页面不得硬编码颜色）。 */
export const palette = {
  primary: '#2563eb',
  primaryStrong: '#1d4ed8',
  primarySoft: '#e8efff',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  bgLayout: '#f4f6fa',
  bgContainer: '#ffffff',
  textPrimary: '#0f172a',
  textSecondary: '#5b667a',
  border: '#e5e9f0',
} as const;

export const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: palette.primary,
    colorInfo: palette.primary,
    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.danger,
    colorTextBase: palette.textPrimary,
    colorBgLayout: palette.bgLayout,
    colorBorderSecondary: palette.border,
    borderRadius: 8,
    fontFamily: fontStack,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: palette.bgContainer,
      siderBg: palette.bgContainer,
      bodyBg: palette.bgLayout,
      headerHeight: 56,
      headerPadding: '0 16px',
    },
    Menu: {
      itemHeight: 40,
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemSelectedBg: palette.primarySoft,
      itemSelectedColor: palette.primaryStrong,
    },
    Card: {
      headerHeight: 44,
      headerFontSize: 14,
    },
  },
};
