import { Platform } from 'react-native';

/** ARGOLET design tokens (Figma Design_Foundations). Android: Roboto (system), iOS / web: Inter → system. */
export const C = {
  brand: '#0B2D48',
  action: '#087452',
  actionDark: '#06644E',
  text: '#172D3B',
  muted: '#536978',
  bg: '#F5F7F8',
  surface: '#FFFFFF',
  line: '#DFE7EB',
  inputLine: '#D4E0E6',
  soft: '#F0F4F6',
  successBg: '#EAF5EF',
  warningBg: '#FFF5E5',
  warning: '#8A5818',
  dangerBg: '#FDECEC',
  danger: '#B42318',
  info: '#3D759B',
  heroMuted: '#D5E8E7',
  heroStrong: '#B5F6D5',
  chartIn: '#087452',
  chartOut: '#3E78D6',
};

export const G = {
  action: ['#0F8059', '#06644E'] as const,
  hero: ['#0B2D48', '#09664F'] as const,
};

export const font = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif',
});

export const R = { sm: 6, md: 8, lg: 12 };
