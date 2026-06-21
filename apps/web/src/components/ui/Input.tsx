'use client';

import Box from '@mui/material/Box';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import MuiSelect, { type SelectChangeEvent } from '@mui/material/Select';
import { styled } from '@mui/material/styles';
import {
  Children,
  forwardRef,
  isValidElement,
  type InputHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Form primitives backing the existing `Field`/`Input`/`Select` API. `Input` is a
 * theme-styled native input; `Select` is a real MUI Select that still accepts
 * `<option>` children (transparently mapped to MenuItems) so existing call sites
 * — which pass `id`/`value`/`disabled`/`onChange(e => e.target.value)` and option
 * children — keep working unchanged.
 */

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <InputLabel
        htmlFor={htmlFor}
        sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }}
      >
        {label}
      </InputLabel>
      {children}
      {error ? (
        <FormHelperText error sx={{ m: 0 }}>
          {error}
        </FormHelperText>
      ) : null}
      {!error && hint ? (
        <FormHelperText sx={{ m: 0, color: 'text.secondary' }}>{hint}</FormHelperText>
      ) : null}
    </Box>
  );
}

const StyledInput = styled('input')(({ theme }) => ({
  width: '100%',
  borderRadius: theme.shape.borderRadius * 1.5,
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.default,
  padding: '8px 12px',
  fontSize: '0.875rem',
  color: theme.palette.text.primary,
  outline: 'none',
  transition: 'border-color 120ms',
  '&::placeholder': { color: theme.palette.text.secondary, opacity: 0.7 },
  '&:hover': { borderColor: theme.palette.text.secondary },
  '&:focus': {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
  },
  '&:disabled': { opacity: 0.5 },
}));

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <StyledInput ref={ref} {...props} />;
  },
);

type OptionProps = OptionHTMLAttributes<HTMLOptionElement> & { children?: ReactNode };

/** A change handler shaped like the native one (`e.target.value` is the string value). */
type SelectChangeHandler = (event: { target: { value: string } }) => void;

export interface SelectProps {
  id?: string;
  value: string;
  onChange?: SelectChangeHandler;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  'aria-label'?: string;
  /** `<option>` elements; transparently rendered as MUI MenuItems. */
  children: ReactNode;
}

/** Convert `<option value=... >label</option>` children into MUI MenuItems. */
function optionsToMenuItems(children: ReactNode): ReactNode {
  return Children.toArray(children)
    .filter((child): child is ReactElement<OptionProps> => isValidElement(child))
    .map((option, index) => {
      const value = option.props.value;
      const key = option.key ?? String(value ?? index);
      return (
        <MenuItem key={key} value={value}>
          {option.props.children}
        </MenuItem>
      );
    });
}

/**
 * Themed MUI Select with a native-`<select>`-compatible API. Renders compact and
 * outlined to match {@link Input}.
 */
export const Select = forwardRef<HTMLDivElement, SelectProps>(function Select(
  { id, value, onChange, disabled = false, name, required = false, children, ...rest },
  ref,
) {
  // Only attach optional props when defined — exactOptionalPropertyTypes forbids
  // passing `undefined` to MUI props that don't list it.
  const optional: { id?: string; name?: string; 'aria-label'?: string } = {};
  if (id !== undefined) optional.id = id;
  if (name !== undefined) optional.name = name;
  if (rest['aria-label'] !== undefined) optional['aria-label'] = rest['aria-label'];

  return (
    <MuiSelect
      ref={ref}
      value={value}
      disabled={disabled}
      required={required}
      size="small"
      fullWidth
      onChange={(event: SelectChangeEvent) => {
        onChange?.({ target: { value: event.target.value } });
      }}
      {...optional}
    >
      {optionsToMenuItems(children)}
    </MuiSelect>
  );
});
