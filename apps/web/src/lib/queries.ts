import {
  type AddFriendRequest,
  type Clip,
  type ClipId,
  type CreateDestinationRequest,
  type CreateIngestRequest,
  type CreateSceneRequest,
  type CreateSharedIngestRequest,
  type CreateStreamRequest,
  type DestinationId,
  type ImportTwitchClipsRequest,
  type IngestConnectionInfo,
  type IngestId,
  type ListTwitchClipsRequest,
  type QuickstartRequest,
  type QuickstartResponse,
  type SceneId,
  type Stream,
  type StreamId,
  type StreamRuntime,
  type StreamWithChildren,
  type TwitchClipSummary,
  type TwitchConnection,
  type UpdateDestinationRequest,
  type UpdateStreamRequest,
} from '@openrelay/core';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './api';

export const queryKeys = {
  me: ['me'] as const,
  streams: ['streams'] as const,
  stream: (id: StreamId) => ['streams', id] as const,
  runtime: (id: StreamId) => ['streams', id, 'runtime'] as const,
  clips: (id: StreamId) => ['streams', id, 'clips'] as const,
  connection: (id: StreamId) => ['streams', id, 'connection'] as const,
  twitchConnection: ['twitch', 'connection'] as const,
};

export function useStreams(): UseQueryResult<Stream[]> {
  return useQuery({ queryKey: queryKeys.streams, queryFn: () => api.listStreams() });
}

export function useStream(id: StreamId): UseQueryResult<StreamWithChildren> {
  return useQuery({ queryKey: queryKeys.stream(id), queryFn: () => api.getStream(id) });
}

export function useRuntime(
  id: StreamId,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
): UseQueryResult<StreamRuntime> {
  return useQuery({
    queryKey: queryKeys.runtime(id),
    queryFn: () => api.getRuntime(id),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? false,
    retry: false,
  });
}

export function useCreateStream(): UseMutationResult<
  StreamWithChildren,
  Error,
  CreateStreamRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStreamRequest) => api.createStream(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.streams });
    },
  });
}

/**
 * One-shot quickstart: provision a ready-to-stream setup (stream + scenes +
 * primary ingest) and return copy-paste encoder settings + a connect token.
 */
export function useQuickstart(): UseMutationResult<QuickstartResponse, Error, QuickstartRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickstartRequest) => api.quickstart(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.streams });
    },
  });
}

/** Copy-paste connection info for an existing stream's primary ingest. */
export function useConnection(
  id: StreamId,
  options: { enabled?: boolean } = {},
): UseQueryResult<IngestConnectionInfo> {
  return useQuery({
    queryKey: queryKeys.connection(id),
    queryFn: () => api.getConnection(id),
    enabled: options.enabled ?? true,
    retry: false,
  });
}

export function useUpdateStream(
  id: StreamId,
): UseMutationResult<Stream, Error, UpdateStreamRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStreamRequest) => api.updateStream(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.stream(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.streams });
    },
  });
}

export function useDeleteStream(): UseMutationResult<void, Error, StreamId> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: StreamId) => api.deleteStream(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.streams });
    },
  });
}

export function useStartStream(id: StreamId): UseMutationResult<StreamRuntime, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.startStream(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.stream(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.runtime(id) });
    },
  });
}

export function useStopStream(id: StreamId): UseMutationResult<Stream, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopStream(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.stream(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.runtime(id) });
    },
  });
}

export function useSwitchScene(id: StreamId): UseMutationResult<StreamRuntime, Error, SceneId> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sceneId: SceneId) => api.switchScene(id, sceneId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.stream(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.runtime(id) });
    },
  });
}

export function useSetActiveIngest(
  id: StreamId,
): UseMutationResult<StreamRuntime, Error, IngestId> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ingestId: IngestId) => api.setActiveIngest(id, ingestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.stream(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.runtime(id) });
    },
  });
}

function invalidateStream(qc: ReturnType<typeof useQueryClient>, id: StreamId): void {
  void qc.invalidateQueries({ queryKey: queryKeys.stream(id) });
}

export function useCreateIngest(id: StreamId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIngestRequest) => api.createIngest(id, input),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useCreateSharedIngest(id: StreamId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSharedIngestRequest) => api.createSharedIngest(id, input),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useDeleteIngest(id: StreamId): UseMutationResult<void, Error, IngestId> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ingestId: IngestId) => api.deleteIngest(ingestId),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useCreateDestination(id: StreamId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDestinationRequest) => api.createDestination(id, input),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useUpdateDestination(id: StreamId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { destinationId: DestinationId; input: UpdateDestinationRequest }) =>
      api.updateDestination(vars.destinationId, vars.input),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useDeleteDestination(id: StreamId): UseMutationResult<void, Error, DestinationId> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (destinationId: DestinationId) => api.deleteDestination(destinationId),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useCreateScene(id: StreamId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSceneRequest) => api.createScene(id, input),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useDeleteScene(id: StreamId): UseMutationResult<void, Error, SceneId> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sceneId: SceneId) => api.deleteScene(sceneId),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useClips(id: StreamId): UseQueryResult<Clip[]> {
  return useQuery({ queryKey: queryKeys.clips(id), queryFn: () => api.listClips(id) });
}

/**
 * Upload a media file to the library by streaming it through the API (browser →
 * API → object store) in a single mutation. The browser only contacts the API.
 */
export function useUploadClip(
  id: StreamId,
): UseMutationResult<Clip, Error, { file: File; label: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; label: string }): Promise<Clip> =>
      api.uploadClip(id, vars.file, vars.label),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.clips(id) });
      invalidateStream(qc, id);
    },
  });
}

export function useDeleteClip(id: StreamId): UseMutationResult<void, Error, ClipId> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clipId: ClipId) => api.deleteClip(clipId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.clips(id) });
      invalidateStream(qc, id);
    },
  });
}

export function useAddFriend(id: StreamId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddFriendRequest) => api.addFriend(id, input),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

export function useRemoveFriend(id: StreamId): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeFriend(id, userId),
    onSuccess: () => {
      invalidateStream(qc, id);
    },
  });
}

/** The linked Twitch account, or `null` when none is connected. */
export function useTwitchConnection(): UseQueryResult<TwitchConnection | null> {
  return useQuery({
    queryKey: queryKeys.twitchConnection,
    queryFn: () => api.getTwitchConnection(),
    retry: false,
  });
}

export function useDisconnectTwitch(): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disconnectTwitch(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.twitchConnection });
    },
  });
}

/** List a channel's Twitch clips for the import picker (input-driven, so a mutation). */
export function useListTwitchClips(
  id: StreamId,
): UseMutationResult<TwitchClipSummary[], Error, ListTwitchClipsRequest> {
  return useMutation({
    mutationFn: (input: ListTwitchClipsRequest) => api.listTwitchClips(id, input),
  });
}

export function useImportTwitchClips(
  id: StreamId,
): UseMutationResult<Clip[], Error, ImportTwitchClipsRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportTwitchClipsRequest) => api.importTwitchClips(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.clips(id) });
      invalidateStream(qc, id);
    },
  });
}
