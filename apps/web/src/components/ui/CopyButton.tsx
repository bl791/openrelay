'use client';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DoneIcon from '@mui/icons-material/Done';
import Button from '@mui/material/Button';
import { useState } from 'react';

export interface CopyButtonProps {
  value: string;
  label?: string;
}

export function CopyButton({ value, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = (): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  };

  return (
    <Button
      type="button"
      onClick={onCopy}
      size="small"
      variant="outlined"
      color="inherit"
      startIcon={copied ? <DoneIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
      sx={{ fontSize: '0.72rem', py: 0.4 }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}
