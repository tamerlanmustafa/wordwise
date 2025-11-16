import React from 'react';
import { Button as MuiButton, CircularProgress } from '@mui/material';
import type { ButtonProps as MuiButtonProps } from '@mui/material';

interface ButtonProps extends Omit<MuiButtonProps, 'variant'> {
  variant?: 'primary' | 'secondary' | 'outline';
  isLoading?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'medium',
  isLoading = false,
  disabled,
  ...props
}) => {
  // Map custom variants to MUI variants
  const getMuiVariant = (): 'contained' | 'outlined' | 'text' => {
    switch (variant) {
      case 'primary':
        return 'contained';
      case 'outline':
        return 'outlined';
      case 'secondary':
        return 'text';
      default:
        return 'contained';
    }
  };

  const getMuiColor = (): 'primary' | 'secondary' => {
    return variant === 'secondary' ? 'secondary' : 'primary';
  };

  return (
    <MuiButton
      variant={getMuiVariant()}
      color={getMuiColor()}
      size={size}
      disabled={disabled || isLoading}
      startIcon={isLoading ? <CircularProgress size={20} /> : undefined}
      {...props}
    >
      {isLoading ? 'Loading...' : children}
    </MuiButton>
  );
};

export default Button;


