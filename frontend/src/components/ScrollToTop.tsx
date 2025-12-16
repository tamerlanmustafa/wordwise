/**
 * ScrollToTop Component
 *
 * A floating action button that appears when user scrolls down,
 * allowing them to quickly return to the top of the page.
 */

import { useState, useEffect, useCallback } from 'react';
import { Fab, Zoom } from '@mui/material';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

interface ScrollToTopProps {
  /** Scroll threshold in pixels before button appears */
  threshold?: number;
  /** Bottom position offset */
  bottom?: number;
  /** Right position offset */
  right?: number;
}

export function ScrollToTop({
  threshold = 300,
  bottom = 24,
  right = 24
}: ScrollToTopProps) {
  const [visible, setVisible] = useState(false);

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > threshold);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // Check initial position
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [threshold]);

  // Scroll to top handler
  const handleClick = useCallback(() => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }, []);

  return (
    <Zoom in={visible}>
      <Fab
        color="primary"
        size="medium"
        aria-label="scroll to top"
        onClick={handleClick}
        sx={{
          position: 'fixed',
          bottom,
          right,
          zIndex: 1100,
          boxShadow: 3,
          '&:hover': {
            boxShadow: 6
          }
        }}
      >
        <KeyboardArrowUpIcon />
      </Fab>
    </Zoom>
  );
}
