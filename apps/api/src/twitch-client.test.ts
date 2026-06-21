import { describe, expect, it, vi, type Mock } from 'vitest';
import { startedAtForPeriod, TwitchClient } from './twitch-client.js';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

/** A typed fetch stub that always resolves to the given response. */
function stubFetch(response: Response): FetchMock {
  return vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response));
}

function makeClient(fetchImpl: FetchMock): TwitchClient {
  return new TwitchClient({
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'https://api.example.com/api/twitch/callback',
    fetch: fetchImpl as unknown as typeof fetch,
  });
}

describe('TwitchClient.buildAuthorizeUrl', () => {
  it('builds an oauth2/authorize URL with the expected params', () => {
    const client = makeClient(stubFetch(jsonResponse({})));
    const url = new URL(client.buildAuthorizeUrl('state-123'));
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/api/twitch/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('scope')).toContain('user:read:email');
  });
});

describe('TwitchClient.exchangeCode', () => {
  it('POSTs to the token endpoint and parses the token response', async () => {
    const fetchImpl = stubFetch(
      jsonResponse({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 1234,
        scope: ['user:read:email'],
      }),
    );
    const client = makeClient(fetchImpl);
    const tokens = await client.exchangeCode('the-code');

    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 1234,
      scope: 'user:read:email',
    });
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe('https://id.twitch.tv/oauth2/token');
    const init = call?.[1];
    expect(init?.method).toBe('POST');
    const body = typeof init?.body === 'string' ? init.body : '';
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
  });
});

describe('TwitchClient.getUserByLogin', () => {
  it('resolves a login to a broadcaster id', async () => {
    const fetchImpl = stubFetch(jsonResponse({ data: [{ id: '99', login: 'shroud' }] }));
    const client = makeClient(fetchImpl);
    const id = await client.getUserByLogin('shroud', 'access');
    expect(id).toBe('99');
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe('https://api.twitch.tv/helix/users?login=shroud');
    const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer access');
    expect(headers['client-id']).toBe('cid');
  });
});

describe('TwitchClient.listClips', () => {
  it('maps the Helix response to TwitchClipSummary objects', async () => {
    const fetchImpl = stubFetch(
      jsonResponse({
        data: [
          {
            id: 'AbcClip',
            title: 'Insane shot',
            thumbnail_url: 'https://clips.twitch.tv/AbcClip.jpg',
            duration: 14.2,
            creator_name: 'somefan',
            view_count: 4321,
            created_at: '2026-06-01T12:00:00Z',
          },
          // Malformed entries (missing required fields) are dropped silently.
          { id: '', title: '' },
        ],
      }),
    );
    const client = makeClient(fetchImpl);
    const clips = await client.listClips(
      { broadcasterId: '99', period: 'week', limit: 5 },
      'access',
    );
    expect(clips).toHaveLength(1);
    expect(clips[0]).toEqual({
      id: 'AbcClip',
      title: 'Insane shot',
      thumbnailUrl: 'https://clips.twitch.tv/AbcClip.jpg',
      durationSeconds: 14.2,
      creatorName: 'somefan',
      viewCount: 4321,
      createdAt: '2026-06-01T12:00:00Z',
    });
    const url = fetchImpl.mock.calls[0]?.[0] ?? '';
    expect(url).toContain('broadcaster_id=99');
    expect(url).toContain('first=5');
    expect(url).toContain('started_at=');
  });

  it('omits started_at for the "all" period', async () => {
    const fetchImpl = stubFetch(jsonResponse({ data: [] }));
    const client = makeClient(fetchImpl);
    await client.listClips({ broadcasterId: '99', period: 'all', limit: 5 }, 'access');
    const url = fetchImpl.mock.calls[0]?.[0] ?? '';
    expect(url).not.toContain('started_at=');
  });

  it('throws an AppError on a non-2xx response', async () => {
    const fetchImpl = stubFetch(jsonResponse({}, { ok: false, status: 401 }));
    const client = makeClient(fetchImpl);
    await expect(
      client.listClips({ broadcasterId: '1', period: 'day', limit: 1 }, 'bad'),
    ).rejects.toThrow(/Twitch request failed/);
  });
});

describe('startedAtForPeriod', () => {
  it('returns null for "all" and an ISO timestamp otherwise', () => {
    expect(startedAtForPeriod('all')).toBeNull();
    const week = startedAtForPeriod('week');
    expect(week).not.toBeNull();
    expect(() => new Date(week ?? '').toISOString()).not.toThrow();
  });
});
