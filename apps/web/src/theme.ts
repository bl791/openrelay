'use client';

import { createTheme } from '@mui/material/styles';

/**
 * Minimal dark theme for OpenRelay. Carries over the original surface/brand/status
 * palette so the operator console keeps its look while running on MUI components.
 * Status colors (live / failover / danger) are exposed as standard MUI palette
 * channels so `color="success"` etc. work across components.
 */
const surface = {
  950: '#08090d',
  900: '#0c0e14',
  850: '#11141c',
  800: '#161a24',
  700: '#1f2533',
  600: '#2b3242',
  border: '#232a38',
};

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: { main: '#4453ff', light: '#5e6bff', dark: '#3340e0', contrastText: '#ffffff' },
    success: { main: '#1fd286', contrastText: '#08090d' },
    warning: { main: '#ff8a1f', contrastText: '#08090d' },
    error: { main: '#f0476d', contrastText: '#ffffff' },
    info: { main: '#5e6bff' },
    background: { default: surface[950], paper: surface[900] },
    divider: surface.border,
    text: { primary: '#e7ecf3', secondary: '#94a3b8' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: [
      'ui-sans-serif',
      'system-ui',
      '-apple-system',
      'Segoe UI',
      'Roboto',
      'Helvetica',
      'Arial',
      'sans-serif',
    ].join(','),
    h1: { fontSize: '1.6rem', fontWeight: 700 },
    h2: { fontSize: '1.25rem', fontWeight: 700 },
    h3: { fontSize: '1rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: surface[950], WebkitFontSmoothing: 'antialiased' },
        '::-webkit-scrollbar': { width: 10, height: 10 },
        '::-webkit-scrollbar-thumb': { background: surface[700], borderRadius: 8 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: surface.border },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(8,9,13,0.85)',
          backgroundImage: 'none',
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${surface.border}`,
        },
      },
    },
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'small' } },
    MuiDialog: { styleOverrides: { paper: { backgroundColor: surface[850] } } },
  },
});

/** Surface ramp + status colors for ad-hoc `sx` usage that needs the raw values. */
export const palette = { surface };
