'use client';

import Box from '@mui/material/Box';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export interface QrCodeProps {
  /** The value encoded into the QR code (a connect token or single-line URL). */
  value: string;
  /** Rendered pixel size of the square QR image. */
  size?: number;
}

/**
 * Render a scannable QR code as a PNG data URL. Generation happens client-side
 * via `qrcode`; rendered on a white card so it stays scannable on the dark theme.
 */
export function QrCode({ value, size = 176 }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (failed) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 1.5,
          bgcolor: 'action.hover',
          color: 'text.secondary',
          fontSize: '0.75rem',
          width: size,
          height: size,
        }}
      >
        QR unavailable
      </Box>
    );
  }

  return (
    <Box
      sx={{
        overflow: 'hidden',
        borderRadius: 1.5,
        bgcolor: '#fff',
        p: 1,
        width: size,
        height: size,
      }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="Scan to connect your mobile encoder" width={size} height={size} />
      ) : (
        <Box sx={{ width: '100%', height: '100%', bgcolor: 'grey.200' }} />
      )}
    </Box>
  );
}
