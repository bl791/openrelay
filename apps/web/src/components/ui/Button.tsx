'use client';

import MuiButton, { type ButtonProps as MuiButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { type MouseEventHandler, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md';

/**
 * Semantic button wrapper. Deliberately exposes only the props the app uses
 * rather than extending `MuiButtonProps`, which would collapse MUI's polymorphic
 * `href`/`component` overloads and break type inference at call sites.
 */
export interface ButtonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  fullWidth?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  startIcon?: ReactNode;
  'aria-label'?: string;
  sx?: MuiButtonProps['sx'];
  children: ReactNode;
}

type MuiVariant = NonNullable<MuiButtonProps['variant']>;
type MuiColor = NonNullable<MuiButtonProps['color']>;
type MuiSize = NonNullable<MuiButtonProps['size']>;

const VARIANT_MAP: Record<Variant, { variant: MuiVariant; color: MuiColor }> = {
  primary: { variant: 'contained', color: 'primary' },
  secondary: { variant: 'outlined', color: 'inherit' },
  ghost: { variant: 'text', color: 'inherit' },
  danger: { variant: 'contained', color: 'error' },
  success: { variant: 'contained', color: 'success' },
};

const SIZE_MAP: Record<Size, MuiSize> = { sm: 'small', md: 'medium' };

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  fullWidth = false,
  onClick,
  startIcon,
  sx,
  children,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const mapped = VARIANT_MAP[variant];
  const startNode = loading ? <CircularProgress size={14} color="inherit" /> : startIcon;
  // Assemble props as a concrete MuiButtonProps, adding optionals only when set —
  // `exactOptionalPropertyTypes` forbids passing `undefined` to props that don't
  // list it, and spreading optionals as JSX attributes reintroduces `undefined`.
  const props: MuiButtonProps = {
    variant: mapped.variant,
    color: mapped.color,
    size: SIZE_MAP[size],
    type,
    fullWidth,
    disabled: disabled || loading,
    children,
  };
  if (onClick) props.onClick = onClick;
  if (startNode) props.startIcon = startNode;
  if (ariaLabel !== undefined) props['aria-label'] = ariaLabel;
  if (sx !== undefined) props.sx = sx;

  return <MuiButton {...props} />;
}
