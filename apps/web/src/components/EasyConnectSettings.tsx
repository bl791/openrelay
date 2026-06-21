'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type IngestConnectionInfo } from '@openrelay/core';
import { CopyButton } from '@/components/ui/CopyButton';
import { QrCode } from '@/components/ui/QrCode';
import { palette } from '@/theme';

export interface EasyConnectSettingsProps {
  connection: IngestConnectionInfo;
  /**
   * Optional compact deep-link token for mobile apps. When present it is encoded
   * into the QR code; otherwise the single-line publish URL is used.
   */
  connectToken?: string;
}

/**
 * Copy-paste encoder settings (Server + Stream Key + single-line URL) plus a
 * scannable QR code, shared by the dashboard quickstart modal and the stream
 * detail easy-connect panel.
 */
export function EasyConnectSettings({ connection, connectToken }: EasyConnectSettingsProps) {
  const qrValue = connectToken ?? connection.url;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ sm: 'flex-start' }}>
      <Stack spacing={1.5} sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            component="span"
            sx={{
              borderRadius: 0.5,
              bgcolor: palette.surface[700],
              px: 0.75,
              py: 0.25,
              fontSize: '0.625rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'text.secondary',
            }}
          >
            {connection.protocol}
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            Paste these into OBS, Moblin or IRL Pro
          </Typography>
        </Stack>
        <SettingRow label="Server" value={connection.server} />
        <SettingRow label="Stream key" value={connection.streamKey} />
        <SettingRow label="Single-line URL" value={connection.url} />
      </Stack>

      <Stack spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        <QrCode value={qrValue} />
        <Typography
          sx={{
            maxWidth: '11rem',
            textAlign: 'center',
            fontSize: '0.625rem',
            lineHeight: 1.2,
            color: 'text.secondary',
          }}
        >
          {connectToken
            ? 'Scan with a mobile encoder to auto-fill these settings.'
            : 'Scan to copy the publish URL to your phone.'}
        </Typography>
      </Stack>
    </Stack>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: '0.625rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'text.secondary',
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            color: 'text.primary',
          }}
        >
          {value}
        </Typography>
      </Box>
      <CopyButton value={value} />
    </Stack>
  );
}
