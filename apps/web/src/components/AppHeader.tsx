'use client';

import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { clearSession, getStoredUser, type SessionUser } from '@/lib/auth';

export function AppHeader() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  const onLogout = (): void => {
    clearSession();
    router.replace('/login');
    router.refresh();
  };

  return (
    <AppBar position="sticky" elevation={0} color="transparent">
      <Toolbar sx={{ maxWidth: 1152, mx: 'auto', width: '100%', minHeight: 56, gap: 1.5 }}>
        <Typography
          component={Link}
          href="/dashboard"
          variant="h3"
          sx={{ flexGrow: 1, color: 'text.primary', textDecoration: 'none', fontWeight: 700 }}
        >
          Open
          <Box component="span" sx={{ color: 'primary.light' }}>
            Relay
          </Box>
        </Typography>
        {user ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: { xs: 'none', sm: 'inline' } }}
          >
            {user.displayName}
          </Typography>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onLogout}>
          Sign out
        </Button>
      </Toolbar>
    </AppBar>
  );
}
