import { type StreamId } from '@openrelay/core';
import { StreamDetailClient } from './StreamDetailClient';

export const dynamic = 'force-dynamic';

export default async function StreamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StreamDetailClient streamId={id as StreamId} />;
}
