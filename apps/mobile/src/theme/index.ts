import { StyleSheet } from 'react-native';

export const colors = {
  light: {
    background: '#ffffff',
    surface: '#f5f5f5',
    primary: '#2196F3',
    primaryDark: '#1976D2',
    text: '#1a1a1a',
    textSecondary: '#666666',
    textTertiary: '#999999',
    border: '#e0e0e0',
    error: '#d32f2f',
    success: '#4caf50',
    warning: '#ff9800',
  },
  dark: {
    background: '#121212',
    surface: '#1e1e1e',
    primary: '#90caf9',
    primaryDark: '#42a5f5',
    text: '#ffffff',
    textSecondary: '#b0b0b0',
    textTertiary: '#808080',
    border: '#333333',
    error: '#ef5350',
    success: '#66bb6a',
    warning: '#ffa726',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  h2: { fontSize: 24, fontWeight: '600', letterSpacing: -0.3 },
  h3: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  bodySmall: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  button: { fontSize: 16, fontWeight: '600' },
});

export const shadows = StyleSheet.create({
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
});

// CEFR level colors
export const cefrColors: Record<string, string> = {
  A1: '#4caf50',
  A2: '#8bc34a',
  B1: '#ffeb3b',
  B2: '#ff9800',
  C1: '#ff5722',
  C2: '#f44336',
};

export type Theme = typeof colors.light;
export type ColorScheme = 'light' | 'dark';
