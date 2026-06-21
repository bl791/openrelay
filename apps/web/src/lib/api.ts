import {
  type AddFriendRequest,
  ApiError,
  AuthResponse,
  Clip,
  type CreateClipRequest,
  type CreateDestinationRequest,
  type CreateIngestRequest,
  type CreateSceneRequest,
  type CreateSharedIngestRequest,
  type CreateStreamRequest,
  Destination,
  FriendConnection,
  type ImportTwitchClipsRequest,
  Ingest,
  IngestConnectionInfo,
  type ListTwitchClipsRequest,
  type LoginRequest,
  type QuickstartRequest,
  QuickstartResponse,
  type RegisterRequest,
  Scene,
  Stream,
  StreamRuntime,
  StreamWithChildren,
  TwitchAuthUrlResponse,
  TwitchClipSummary,
  TwitchConnection,
  type UpdateDestinationRequest,
  type UpdateStreamRequest,
  User,
  type ClipId,
  type DestinationId,
  type FriendConnectionId,
  type IngestId,
  type SceneId,
  type StreamId,
} from '@openrelay/core';
import { z } from 'zod';
import { clearSession, getToken } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Typed error thrown for any non-2xx API response, carrying the core ApiError code. */
export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  public constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions<TBody> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: TBody;
  /** Zod schema used to validate the parsed response body. */
  schema?: z.ZodType;
  /** Set when the endpoint returns 204 / empty body. */
  expectEmpty?: boolean;
}

async function request<TResult, TBody = unknown>(
  path: string,
  options: RequestOptions<TBody> = {},
): Promise<TResult> {
  const { method = 'GET', body, schema, expectEmpty = false } = options;
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = getToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });

  if (!response.ok) {
    await throwApiError(response);
  }

  if (expectEmpty || response.status === 204) {
    return undefined as TResult;
  }

  const data: unknown = await response.json();
  if (schema) {
    return schema.parse(data) as TResult;
  }
  return data as TResult;
}

async function throwApiError(response: Response): Promise<never> {
  let code = 'request_failed';
  let message = `Request failed with status ${String(response.status)}`;
  let details: unknown;
  try {
    const parsed = ApiError.safeParse(await response.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
      details = parsed.data.error.details;
    }
  } catch {
    // Non-JSON error body; keep the defaults.
  }
  if (response.status === 401) {
    clearSession();
  }
  throw new ApiRequestError(response.status, code, message, details);
}

/** Ingest creation echoes back the encoder publish URL alongside the entity. */
const CreatedIngest = Ingest.extend({ pushUrl: z.string() });
export type CreatedIngest = z.infer<typeof CreatedIngest>;

/** Shared (guest) ingest creation echoes back copy-paste encoder connection info. */
const CreatedSharedIngest = Ingest.extend({ connection: IngestConnectionInfo });
export type CreatedSharedIngest = z.infer<typeof CreatedSharedIngest>;

export const api = {
  // ── Auth ─────────────────────────────────────────────────────────────────
  login(input: LoginRequest): Promise<AuthResponse> {
    return request('/api/auth/login', { method: 'POST', body: input, schema: AuthResponse });
  },
  register(input: RegisterRequest): Promise<AuthResponse> {
    return request('/api/auth/register', { method: 'POST', body: input, schema: AuthResponse });
  },
  me(): Promise<User> {
    return request('/api/me', { schema: User });
  },

  // ── Streams ──────────────────────────────────────────────────────────────
  listStreams(): Promise<Stream[]> {
    return request('/api/streams', { schema: z.array(Stream) });
  },
  getStream(id: StreamId): Promise<StreamWithChildren> {
    return request(`/api/streams/${id}`, { schema: StreamWithChildren });
  },
  createStream(input: CreateStreamRequest): Promise<StreamWithChildren> {
    return request('/api/streams', { method: 'POST', body: input, schema: StreamWithChildren });
  },

  // ── Quickstart / easy-connect ──────────────────────────────────────────────
  quickstart(input: QuickstartRequest): Promise<QuickstartResponse> {
    return request('/api/quickstart', { method: 'POST', body: input, schema: QuickstartResponse });
  },
  getConnection(id: StreamId): Promise<IngestConnectionInfo> {
    return request(`/api/streams/${id}/connection`, { schema: IngestConnectionInfo });
  },
  updateStream(id: StreamId, input: UpdateStreamRequest): Promise<Stream> {
    return request(`/api/streams/${id}`, { method: 'PATCH', body: input, schema: Stream });
  },
  deleteStream(id: StreamId): Promise<void> {
    return request(`/api/streams/${id}`, { method: 'DELETE', expectEmpty: true });
  },

  // ── Engine orchestration ───────────────────────────────────────────────────
  startStream(id: StreamId): Promise<StreamRuntime> {
    return request(`/api/streams/${id}/start`, { method: 'POST', schema: StreamRuntime });
  },
  stopStream(id: StreamId): Promise<Stream> {
    return request(`/api/streams/${id}/stop`, { method: 'POST', schema: Stream });
  },
  getRuntime(id: StreamId): Promise<StreamRuntime> {
    return request(`/api/streams/${id}/runtime`, { schema: StreamRuntime });
  },
  switchScene(id: StreamId, sceneId: SceneId): Promise<StreamRuntime> {
    return request(`/api/streams/${id}/scene`, {
      method: 'POST',
      body: { sceneId },
      schema: StreamRuntime,
    });
  },
  setActiveIngest(id: StreamId, ingestId: IngestId): Promise<StreamRuntime> {
    return request(`/api/streams/${id}/ingest`, {
      method: 'POST',
      body: { ingestId },
      schema: StreamRuntime,
    });
  },

  // ── Ingests ────────────────────────────────────────────────────────────────
  createIngest(id: StreamId, input: CreateIngestRequest): Promise<CreatedIngest> {
    return request(`/api/streams/${id}/ingests`, {
      method: 'POST',
      body: input,
      schema: CreatedIngest,
    });
  },
  createSharedIngest(id: StreamId, input: CreateSharedIngestRequest): Promise<CreatedSharedIngest> {
    return request(`/api/streams/${id}/shared-ingests`, {
      method: 'POST',
      body: input,
      schema: CreatedSharedIngest,
    });
  },
  deleteIngest(ingestId: IngestId): Promise<void> {
    return request(`/api/ingests/${ingestId}`, { method: 'DELETE', expectEmpty: true });
  },

  // ── Destinations ─────────────────────────────────────────────────────────
  createDestination(id: StreamId, input: CreateDestinationRequest): Promise<Destination> {
    return request(`/api/streams/${id}/destinations`, {
      method: 'POST',
      body: input,
      schema: Destination,
    });
  },
  updateDestination(
    destinationId: DestinationId,
    input: UpdateDestinationRequest,
  ): Promise<Destination> {
    return request(`/api/destinations/${destinationId}`, {
      method: 'PATCH',
      body: input,
      schema: Destination,
    });
  },
  deleteDestination(destinationId: DestinationId): Promise<void> {
    return request(`/api/destinations/${destinationId}`, { method: 'DELETE', expectEmpty: true });
  },

  // ── Scenes ─────────────────────────────────────────────────────────────────
  createScene(id: StreamId, input: CreateSceneRequest): Promise<Scene> {
    return request(`/api/streams/${id}/scenes`, { method: 'POST', body: input, schema: Scene });
  },
  deleteScene(sceneId: SceneId): Promise<void> {
    return request(`/api/scenes/${sceneId}`, { method: 'DELETE', expectEmpty: true });
  },

  // ── Clips / media library ──────────────────────────────────────────────────
  listClips(id: StreamId): Promise<Clip[]> {
    return request(`/api/streams/${id}/clips`, { schema: z.array(Clip) });
  },
  registerClip(id: StreamId, input: CreateClipRequest): Promise<Clip> {
    return request(`/api/streams/${id}/clips`, { method: 'POST', body: input, schema: Clip });
  },
  /**
   * Upload a clip by streaming the file through the API (browser → API → store).
   * The browser only ever talks to the API origin it is authenticated against.
   */
  uploadClip(id: StreamId, file: File, label?: string): Promise<Clip> {
    const form = new FormData();
    if (label !== undefined && label.length > 0) {
      form.append('label', label);
    }
    form.append('file', file, file.name);
    return uploadMultipart(`/api/streams/${id}/clips/upload`, form);
  },
  deleteClip(clipId: ClipId): Promise<void> {
    return request(`/api/clips/${clipId}`, { method: 'DELETE', expectEmpty: true });
  },

  // ── Friends ────────────────────────────────────────────────────────────────
  addFriend(id: StreamId, input: AddFriendRequest): Promise<FriendConnection> {
    return request(`/api/streams/${id}/friends`, {
      method: 'POST',
      body: input,
      schema: FriendConnection,
    });
  },
  removeFriend(id: StreamId, userId: string): Promise<void> {
    return request(`/api/streams/${id}/friends/${userId}`, { method: 'DELETE', expectEmpty: true });
  },

  // ── Twitch integration ─────────────────────────────────────────────────────
  getTwitchConnectUrl(): Promise<TwitchAuthUrlResponse> {
    return request('/api/twitch/connect', { schema: TwitchAuthUrlResponse });
  },
  /** Resolve the linked Twitch account, or `null` when none is connected (404). */
  async getTwitchConnection(): Promise<TwitchConnection | null> {
    try {
      return await request<TwitchConnection>('/api/twitch/connection', {
        schema: TwitchConnection,
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  disconnectTwitch(): Promise<void> {
    return request('/api/twitch/connection', { method: 'DELETE', expectEmpty: true });
  },
  listTwitchClips(id: StreamId, input: ListTwitchClipsRequest): Promise<TwitchClipSummary[]> {
    return request(`/api/streams/${id}/twitch/clips/list`, {
      method: 'POST',
      body: input,
      schema: z.array(TwitchClipSummary),
    });
  },
  importTwitchClips(id: StreamId, input: ImportTwitchClipsRequest): Promise<Clip[]> {
    return request(`/api/streams/${id}/twitch/clips/import`, {
      method: 'POST',
      body: input,
      schema: z.array(Clip),
    });
  },
};

export type { FriendConnectionId };

/** Build the absolute SSE URL with the bearer token for an EventSource fallback. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

/**
 * POST a multipart form (clip upload) to the API, authenticated with the bearer
 * token. The browser sets the multipart boundary, so no content-type is forced.
 */
async function uploadMultipart(path: string, form: FormData): Promise<Clip> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = getToken();
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (response.status === 401) {
    clearSession();
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiError.safeParse(payload);
    if (parsed.success) {
      throw new ApiRequestError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new ApiRequestError(
      response.status,
      'upload_failed',
      `Upload failed with status ${String(response.status)}`,
    );
  }
  return Clip.parse(payload);
}
