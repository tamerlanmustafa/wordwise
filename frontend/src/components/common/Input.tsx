import React from 'react';
import { TextField } from '@mui/material';
import type { TextFieldProps } from '@mui/material';

interface InputProps extends Omit<TextFieldProps, 'error'> {
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, ...props }, ref) => {
    return (
      <TextField
        inputRef={ref}
        label={label}
        error={!!error}
        helperText={error}
        fullWidth
        variant="outlined"
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export default Input;
