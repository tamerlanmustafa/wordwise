import React from 'react';
import { Card as MuiCard, CardContent } from '@mui/material';
import type { CardProps as MuiCardProps } from '@mui/material';

interface CardProps extends MuiCardProps {
  children: React.ReactNode;
  hover?: boolean;
}

const Card: React.FC<CardProps> = ({ children, hover = false, sx, ...props }) => {
  return (
    <MuiCard
      sx={{
        transition: hover ? 'box-shadow 0.2s' : undefined,
        '&:hover': hover ? {
          boxShadow: 3,
        } : undefined,
        ...sx,
      }}
      {...props}
    >
      <CardContent>
        {children}
      </CardContent>
    </MuiCard>
  );
};

export default Card;


