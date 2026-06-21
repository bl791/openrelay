import { TwitchClipSummary } from '@openrelay/core';
import { AppError } from './errors.js';

/**
 * Typed client for the Twitch OAuth + Helix APIs used by the clip-import feature.
 * Network access goes through an injectable `fetch` so tests never hit Twitch.
 * Every external response is parsed defensively; a malformed payload surfaces as
 * an {@link AppError} rather than leaking an untyped value into route handlers.
 */

const OAUTH_BASE = 'https://id.twitch.tv';
const HELIX_BASE = 'https://api.twitch.tv/helix';

/** OAuth scopes requested. `user:read:email` lets us identify the account. */
const SCOPES = ['user:read:email'] as const;

export type ClipPeriod = 'day' | 'week' | 'month' | 'all';

export interface TwitchTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Space-separated granted scopes. */
  scope: string;
}

export interface TwitchUser {
  id: string;
  login: string;
}

export interface ListClipsArgs {
  broadcasterId: string;
  period: ClipPeriod;
  limit: number;
}

export interface TwitchClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
}

export class TwitchClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: TwitchClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Build the OAuth authorize URL the browser is redirected to. */
  public buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
    });
    return `${OAUTH_BASE}/oauth2/authorize?${params.toString()}`;
  }

  /** Exchange an authorization code for access + refresh tokens. */
  public async exchangeCode(code: string): Promise<TwitchTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
    });
    return this.tokenRequest(body);
  }

  /** Exchange a refresh token for a fresh access + refresh token pair. */
  public async refresh(refreshToken: string): Promise<TwitchTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.tokenRequest(body);
  }

  /** Resolve the authenticated account behind an access token. */
  public async getUser(accessToken: string): Promise<TwitchUser> {
    const json = await this.helix('/users', accessToken);
    return parseFirstUser(json);
  }

  /** Resolve a login name to its broadcaster (user) id. */
  public async getUserByLogin(login: string, accessToken: string): Promise<string> {
    const json = await this.helix(`/users?login=${encodeURIComponent(login)}`, accessToken);
    return parseFirstUser(json).id;
  }

  /** List a broadcaster's clips for the requested period. */
  public async listClips(args: ListClipsArgs, accessToken: string): Promise<TwitchClipSummary[]> {
    const params = new URLSearchParams({
      broadcaster_id: args.broadcasterId,
      first: String(args.limit),
    });
    const startedAt = startedAtForPeriod(args.period);
    if (startedAt !== null) {
      params.set('started_at', startedAt);
      // Helix requires ended_at when started_at is set; use "now".
      params.set('ended_at', new Date().toISOString());
    }
    const json = await this.helix(`/clips?${params.toString()}`, accessToken);
    return parseClips(json);
  }

  /**
   * Fetch metadata for specific clips by id (Helix accepts up to 100 `id`
   * params). Unknown ids are simply omitted from the result.
   */
  public async getClipsByIds(
    clipIds: readonly string[],
    accessToken: string,
  ): Promise<TwitchClipSummary[]> {
    if (clipIds.length === 0) {
      return [];
    }
    const params = new URLSearchParams();
    for (const id of clipIds) {
      params.append('id', id);
    }
    const json = await this.helix(`/clips?${params.toString()}`, accessToken);
    return parseClips(json);
  }

  private async tokenRequest(body: URLSearchParams): Promise<TwitchTokens> {
    const response = await this.call(`${OAUTH_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = await this.readJson(response);
    return parseTokens(json);
  }

  private async helix(path: string, accessToken: string): Promise<unknown> {
    const response = await this.call(`${HELIX_BASE}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'client-id': this.clientId,
      },
    });
    return this.readJson(response);
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new AppError('engine_error', `could not reach Twitch: ${message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AppError(
        'engine_error',
        `Twitch request failed (${String(response.status)})`,
        detail.length > 0 ? detail : undefined,
      );
    }
    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new AppError('engine_error', 'Twitch returned a malformed response');
    }
  }
}

/** Earliest `started_at` (RFC3339) for a period, or null for "all time". */
export function startedAtForPeriod(period: ClipPeriod): string | null {
  if (period === 'all') {
    return null;
  }
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new AppError('engine_error', 'unexpected Twitch response shape');
  }
  return value as Record<string, unknown>;
}

function parseTokens(json: unknown): TwitchTokens {
  const obj = asRecord(json);
  const accessToken = obj.access_token;
  const refreshToken = obj.refresh_token;
  const expiresIn = obj.expires_in;
  const scope = obj.scope;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new AppError('engine_error', 'Twitch token response missing tokens');
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: typeof expiresIn === 'number' ? expiresIn : 3600,
    scope: normalizeScope(scope),
  };
}

/** Twitch returns `scope` as a string for OAuth tokens or an array for some endpoints. */
function normalizeScope(scope: unknown): string {
  if (typeof scope === 'string') {
    return scope;
  }
  if (Array.isArray(scope)) {
    return scope.filter((s): s is string => typeof s === 'string').join(' ');
  }
  return SCOPES.join(' ');
}

function parseFirstUser(json: unknown): TwitchUser {
  const obj = asRecord(json);
  const data = obj.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw AppError.notFound('Twitch user not found');
  }
  const first = asRecord(data[0]);
  const id = first.id;
  const login = first.login;
  if (typeof id !== 'string' || typeof login !== 'string') {
    throw new AppError('engine_error', 'Twitch user response missing fields');
  }
  return { id, login };
}

function parseClips(json: unknown): TwitchClipSummary[] {
  const obj = asRecord(json);
  const data = obj.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const clips: TwitchClipSummary[] = [];
  for (const entry of data) {
    const c = asRecord(entry);
    const parsed = TwitchClipSummary.safeParse({
      id: typeof c.id === 'string' ? c.id : '',
      title: typeof c.title === 'string' && c.title.length > 0 ? c.title : 'Untitled clip',
      thumbnailUrl: typeof c.thumbnail_url === 'string' ? c.thumbnail_url : '',
      durationSeconds: typeof c.duration === 'number' ? c.duration : 0,
      creatorName: typeof c.creator_name === 'string' ? c.creator_name : 'unknown',
      viewCount: typeof c.view_count === 'number' ? Math.max(0, Math.trunc(c.view_count)) : 0,
      createdAt: typeof c.created_at === 'string' ? c.created_at : new Date().toISOString(),
    });
    if (parsed.success) {
      clips.push(parsed.data);
    }
  }
  return clips;
}
