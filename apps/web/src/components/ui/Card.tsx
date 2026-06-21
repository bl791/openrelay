'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { type SxProps, type Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { type ReactNode } from 'react';

/** A single (non-array) `sx` value, used as the element type when merging. */
type SxEntry = Exclude<SxProps<Theme>, readonly unknown[]>;

/** Normalize an optional `sx` into a flat array of entries so callers can be
 * merged without spreading a possibly-callable `sx` value. */
function toSxArray(sx: SxProps<Theme> | undefined): SxEntry[] {
  if (sx === undefined) return [];
  return Array.isArray(sx) ? (sx as SxEntry[]) : [sx as SxEntry];
}

export interface CardProps {
  children: ReactNode;
  /** Optional MUI sx overrides. */
  sx?: SxProps<Theme> | undefined;
}

export function Card({ children, sx }: CardProps) {
  return (
    <Paper variant="outlined" sx={[{ overflow: 'hidden' }, ...toSxArray(sx)]}>
      {children}
    </Paper>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, description, action }: CardHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        borderBottom: 1,
        borderColor: 'divider',
        px: 2.5,
        py: 2,
      }}
    >
      <Box>
        <Typography variant="h3" sx={{ fontSize: '0.875rem' }}>
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, fontSize: '0.75rem' }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Box>
  );
}

export function CardBody({ children, sx }: CardProps) {
  return <Box sx={[{ px: 2.5, py: 2 }, ...toSxArray(sx)]}>{children}</Box>;
}
