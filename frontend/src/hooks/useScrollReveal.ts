import { useState, useEffect, useRef, useCallback } from 'react';

interface UseScrollRevealOptions {
  revealThreshold?: number; // px to scroll up before revealing
  hideThreshold?: number;   // px to scroll down before hiding
}

interface UseScrollRevealResult {
  showHeader: boolean;
  showTabs: boolean;
}

export function useScrollReveal({
  revealThreshold = 20,
  hideThreshold = 10
}: UseScrollRevealOptions = {}): UseScrollRevealResult {
  const [showHeader, setShowHeader] = useState(true);
  const [showTabs, setShowTabs] = useState(true);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  const updateScrollDirection = useCallback(() => {
    const currentScrollY = window.scrollY;
    const scrollDelta = currentScrollY - lastScrollY.current;

    // Scrolling down - hide header and tabs
    if (scrollDelta > hideThreshold && currentScrollY > 100) {
      setShowHeader(false);
      setShowTabs(false);
    }
    // Scrolling up - show header and tabs
    else if (scrollDelta < -revealThreshold) {
      setShowHeader(true);
      setShowTabs(true);
    }

    lastScrollY.current = currentScrollY;
    ticking.current = false;
  }, [revealThreshold, hideThreshold]);

  useEffect(() => {
    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollDirection);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [updateScrollDirection]);

  return { showHeader, showTabs };
}
