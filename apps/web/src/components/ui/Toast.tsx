'use client';

import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, tone, message }]);
      window.setTimeout(() => {
        remove(id);
      }, 4500);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar open={items.length > 0} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Stack spacing={1} sx={{ width: '100%', maxWidth: 420 }}>
          {items.map((item) => (
            <Alert
              key={item.id}
              severity={item.tone}
              variant="outlined"
              onClose={() => {
                remove(item.id);
              }}
              sx={{ bgcolor: 'background.paper', width: '100%' }}
            >
              {item.message}
            </Alert>
          ))}
        </Stack>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
