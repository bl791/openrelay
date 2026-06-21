import { IngestIdSchema, SceneIdSchema } from '@openrelay/core';
import { z } from 'zod';

/** Shared request-shape schemas for route params and small ad-hoc bodies. */

export const StreamIdParams = z.object({ id: z.string().min(1) });
export const IngestIdParams = z.object({ id: z.string().min(1) });
export const DestinationIdParams = z.object({ id: z.string().min(1) });
export const SceneIdParams = z.object({ id: z.string().min(1) });
export const ClipIdParams = z.object({ clipId: z.string().min(1) });
export const FriendParams = z.object({ id: z.string().min(1), userId: z.string().min(1) });

export const SwitchSceneBody = z.object({ sceneId: SceneIdSchema });
export const SetIngestBody = z.object({ ingestId: IngestIdSchema });
