/** Small display formatting helpers shared across the dashboard. */

export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  if (h > 0) {
    return `${String(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

export function formatBitrate(kbps: number): string {
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`;
  }
  return `${Math.round(kbps).toString()} kbps`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return 'never';
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return 'unknown';
  }
  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) {
    return `${String(diffSec)}s ago`;
  }
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) {
    return `${String(diffMin)}m ago`;
  }
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {
    return `${String(diffHr)}h ago`;
  }
  return new Date(iso).toLocaleDateString();
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
