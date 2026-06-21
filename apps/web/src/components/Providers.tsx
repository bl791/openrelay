'use client';

import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '@/lib/api';
import { theme } from '@/theme';
import { TwitchRedirectToast } from './TwitchRedirectToast';
import { ToastProvider } from './ui/Toast';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry auth failures; they require re-login.
          if (error instanceof ApiRequestError && error.status === 401) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <AppRouterCacheProvider options={{ key: 'mui' }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider client={client}>
          <ToastProvider>
            <TwitchRedirectToast />
            {children}
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
