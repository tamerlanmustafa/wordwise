import { useEffect, useRef, useCallback } from 'react';
import { useTopBarVisibility } from '../contexts/TopBarVisibilityContext';

interface UseScrollRevealOptions {
  revealThreshold?: number; // px to scroll up before revealing
  hideThreshold?: number;   // px to scroll down before hiding
  enabled?: boolean;         // Enable/disable scroll reveal behavior
}

interface UseScrollRevealResult {
  showTabs: boolean;
  suppressScrollReveal: (ms: number) => void;
}

const HIDE_DEBOUNCE_MS = 15; // Debounce only for hide to prevent flicker
const MIN_TOGGLE_INTERVAL_MS = 150; // Minimum time between TopBar visibility toggles

export function useScrollReveal({
  revealThreshold = 20,
  hideThreshold = 30, // Increased for better hysteresis
  enabled = true
}: UseScrollRevealOptions = {}): UseScrollRevealResult {
  const { setShowTopBar } = useTopBarVisibility();
  const lastScrollY = useRef(0);
  const ticking = useRef(false);
  const hideDebounceTimer = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const lastToggleTimeRef = useRef(0);

  // Function to suppress scroll reveal during programmatic scrolls
  const suppressScrollReveal = useCallback((ms: number) => {
    isProgrammaticScrollRef.current = true;
    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, ms);
  }, []);

  const updateScrollDirection = useCallback(() => {
    if (!enabled) {
      setShowTopBar(true);
      ticking.current = false;
      return;
    }

    // Ignore scroll events during programmatic scroll
    if (isProgrammaticScrollRef.current) {
      ticking.current = false;
      return;
    }

    const currentScrollY = window.scrollY;
    const scrollDelta = currentScrollY - lastScrollY.current;
    const now = Date.now();

    // Hysteresis lock: prevent toggle if too soon after last toggle
    if (now - lastToggleTimeRef.current < MIN_TOGGLE_INTERVAL_MS) {
      lastScrollY.current = currentScrollY;
      ticking.current = false;
      return;
    }

    // IMMEDIATE REVEAL: Scrolling up - show topbar instantly (no debounce)
    if (scrollDelta < -revealThreshold) {
      setShowTopBar(true);
      lastToggleTimeRef.current = now;
      lastScrollY.current = currentScrollY;
      ticking.current = false;
      return;
    }

    // DEBOUNCED HIDE: Scrolling down - hide topbar with debounce to prevent flicker
    if (scrollDelta > hideThreshold && currentScrollY > 100) {
      // Clear existing hide timer
      if (hideDebounceTimer.current) {
        clearTimeout(hideDebounceTimer.current);
      }

      // Debounce the hide action
      hideDebounceTimer.current = window.setTimeout(() => {
        setShowTopBar(false);
        lastToggleTimeRef.current = Date.now();
      }, HIDE_DEBOUNCE_MS);

      lastScrollY.current = currentScrollY;
      ticking.current = false;
      return;
    }

    // Update scroll position even if no action taken
    lastScrollY.current = currentScrollY;
    ticking.current = false;
  }, [revealThreshold, hideThreshold, enabled, setShowTopBar]);

  useEffect(() => {
    if (!enabled) {
      setShowTopBar(true);
      return;
    }

    const handleScroll = (event: Event) => {
      // Ignore scroll events from nested containers (only respond to window scroll)
      if (event.target !== document && event.target !== document.documentElement) {
        return;
      }

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

  return { showTabs: true, suppressScrollReveal };
}
