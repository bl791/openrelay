'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { LoginRequest, RegisterRequest } from '@openrelay/core';
import { useMutation } from '@tanstack/react-query';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { ApiRequestError, api } from '@/lib/api';
import { persistSession } from '@/lib/auth';

type Mode = 'login' | 'register';

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'register') {
        const input = RegisterRequest.parse({ email, password, displayName });
        return api.register(input);
      }
      const input = LoginRequest.parse({ email, password });
      return api.login(input);
    },
    onSuccess: (session) => {
      persistSession(session);
      const next = params.get('next');
      router.replace(next?.startsWith('/') ? next : '/dashboard');
      router.refresh();
    },
  });

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFieldErrors({});
    const schema = mode === 'register' ? RegisterRequest : LoginRequest;
    const parsed = schema.safeParse(
      mode === 'register' ? { email, password, displayName } : { email, password },
    );
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in errors)) {
          errors[key] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }
    mutation.mutate();
  };

  const submitError =
    mutation.error instanceof ApiRequestError
      ? mutation.error.message
      : mutation.error
        ? 'Something went wrong. Please try again.'
        : null;

  return (
    <Box sx={{ width: '100%', maxWidth: 448 }}>
      <Box sx={{ mb: 4, textAlign: 'center' }}>
        <Link
          component={NextLink}
          href="/"
          sx={{
            fontSize: '1.125rem',
            fontWeight: 700,
            color: 'text.primary',
            textDecoration: 'none',
          }}
        >
          Open
          <Box component="span" sx={{ color: 'primary.light' }}>
            Relay
          </Box>
        </Link>
        <Typography variant="h2" sx={{ mt: 3, fontWeight: 600 }}>
          {mode === 'register' ? 'Create your account' : 'Sign in'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {mode === 'register'
            ? 'Spin up your self-hosted streaming control plane.'
            : 'Welcome back to your control plane.'}
        </Typography>
      </Box>

      <Paper
        component="form"
        variant="outlined"
        onSubmit={onSubmit}
        sx={{ p: 3, bgcolor: 'background.paper' }}
      >
        <Stack spacing={2}>
          {mode === 'register' ? (
            <Field label="Display name" htmlFor="displayName" error={fieldErrors.displayName}>
              <Input
                id="displayName"
                name="displayName"
                autoComplete="name"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                }}
                placeholder="Casey Streams"
              />
            </Field>
          ) : null}

          <Field label="Email" htmlFor="email" error={fieldErrors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder="you@example.com"
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            error={fieldErrors.password}
            {...(mode === 'register' ? { hint: 'At least 10 characters.' } : {})}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              placeholder="••••••••••"
            />
          </Field>

          {submitError ? (
            <Alert severity="error" variant="outlined" sx={{ bgcolor: 'background.paper' }}>
              {submitError}
            </Alert>
          ) : null}

          <Button type="submit" variant="primary" fullWidth loading={mutation.isPending}>
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </Stack>
      </Paper>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
        {mode === 'register' ? (
          <>
            Already have an account?{' '}
            <Link
              component={NextLink}
              href="/login"
              sx={{ fontWeight: 500, color: 'primary.light' }}
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to OpenRelay?{' '}
            <Link
              component={NextLink}
              href="/register"
              sx={{ fontWeight: 500, color: 'primary.light' }}
            >
              Create an account
            </Link>
          </>
        )}
      </Typography>
    </Box>
  );
}
