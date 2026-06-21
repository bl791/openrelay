'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { keyframes } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid2';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

const FEATURES = [
  {
    title: 'Drop protection',
    body: 'Viewers stay live while a stale source reconnects within the grace window.',
  },
  {
    title: 'Multistream',
    body: 'Fan one ingest out to Twitch, Kick, YouTube and custom RTMP.',
  },
  {
    title: 'Remote ops',
    body: 'Invite friends as operators to run scenes and failover for you.',
  },
];

export default function HomePage() {
  return (
    <Box
      component="main"
      sx={{
        mx: 'auto',
        display: 'flex',
        minHeight: '100vh',
        maxWidth: 'md',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        px: 3,
        py: 8,
        textAlign: 'center',
      }}
    >
      <Stack spacing={2} alignItems="center">
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            borderRadius: 999,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            px: 1.5,
            py: 0.5,
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'primary.light',
          }}
        >
          <Box
            component="span"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: 'success.main',
              animation: `${pulse} 1.1s ease-in-out infinite`,
            }}
          />
          Stay live even when your source drops
        </Box>
        <Typography variant="h1" sx={{ fontSize: { xs: '2.25rem', sm: '3rem' }, fontWeight: 700 }}>
          OpenRelay control plane
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640 }}>
          A self-hosted cloud OBS for IRL streamers. Ingest your feed once, multistream everywhere,
          and let the relay hold your broadcast up with automatic failover when the connection
          stutters.
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1.5} flexWrap="wrap" justifyContent="center">
        <Button variant="primary" size="md">
          <Box component={Link} href="/dashboard" sx={{ color: 'inherit', textDecoration: 'none' }}>
            Open dashboard
          </Box>
        </Button>
        <Button variant="secondary" size="md">
          <Box component={Link} href="/register" sx={{ color: 'inherit', textDecoration: 'none' }}>
            Create account
          </Box>
        </Button>
        <Button variant="ghost" size="md">
          <Box component={Link} href="/login" sx={{ color: 'inherit', textDecoration: 'none' }}>
            Sign in
          </Box>
        </Button>
      </Stack>

      <Grid container spacing={2} sx={{ width: '100%' }}>
        {FEATURES.map((feature) => (
          <Grid key={feature.title} size={{ xs: 12, sm: 4 }}>
            <Paper
              variant="outlined"
              sx={{ height: '100%', p: 2.5, textAlign: 'left', bgcolor: 'background.paper' }}
            >
              <Typography variant="h3" sx={{ fontSize: '0.875rem' }}>
                {feature.title}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5, fontSize: '0.75rem' }}
              >
                {feature.body}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
