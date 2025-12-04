import { useEffect, useRef, useCallback } from 'react';
import { useTopBarVisibility } from '../contexts/TopBarVisibilityContext';

interface UseScrollRevealOptions {
  revealThreshold?: number; // px to scroll up before revealing
  hideThreshold?: number;   // px to scroll down before hiding
  enabled?: boolean;         // Enable/disable scroll reveal behavior
}

interface UseScrollRevealResult {
  showTabs: boolean;
}

export function useScrollReveal({
  revealThreshold = 20,
  hideThreshold = 10,
  enabled = true
}: UseScrollRevealOptions = {}): UseScrollRevealResult {
  const { setShowTopBar } = useTopBarVisibility();
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  const updateScrollDirection = useCallback(() => {
    if (!enabled) {
      setShowTopBar(true);
      ticking.current = false;
      return;
    }

    const currentScrollY = window.scrollY;
    const scrollDelta = currentScrollY - lastScrollY.current;

    // Scrolling down - hide topbar
    if (scrollDelta > hideThreshold && currentScrollY > 100) {
      setShowTopBar(false);
    }
    // Scrolling up - show topbar
    else if (scrollDelta < -revealThreshold) {
      setShowTopBar(true);
    }

    lastScrollY.current = currentScrollY;
    ticking.current = false;
  }, [revealThreshold, hideThreshold, enabled, setShowTopBar]);

  useEffect(() => {
    if (!enabled) {
      setShowTopBar(true);
      return;
    }

    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollDirection);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      setShowTopBar(true); // Reset to visible when unmounting
    };
  }, [updateScrollDirection, enabled, setShowTopBar]);

  return { showTabs: true };
}
