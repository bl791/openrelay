'use client';

import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ open, title, description, onClose, children }: ModalProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-label={title}>
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
          <Typography variant="h3" sx={{ fontSize: '1rem' }}>
            {title}
          </Typography>
          {description ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.25, fontSize: '0.75rem' }}
            >
              {description}
            </Typography>
          ) : null}
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close" sx={{ mt: -0.5, mr: -1 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <DialogContent sx={{ px: 2.5, py: 2 }}>{children}</DialogContent>
    </Dialog>
  );
}
