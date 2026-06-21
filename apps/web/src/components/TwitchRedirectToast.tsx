'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/queries';
import { useToast } from './ui/Toast';

/**
 * After the Twitch OAuth callback the API redirects back to the web app with
 * `?twitch=connected` or `?twitch=error`. Surface that as a toast, refresh the
 * cached connection, and strip the param from the URL so a refresh is idempotent.
 * Mounted at the root layout because the callback lands on `/`.
 */
export function TwitchRedirectToast() {
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('twitch');
    if (status !== 'connected' && status !== 'error') {
      return;
    }
    if (status === 'connected') {
      toast('Twitch account connected', 'success');
      void qc.invalidateQueries({ queryKey: queryKeys.twitchConnection });
    } else {
      toast('Twitch connection failed', 'error');
    }
    params.delete('twitch');
    const query = params.toString();
    const url = `${window.location.pathname}${query.length > 0 ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  }, [toast, qc]);

  return null;
}
