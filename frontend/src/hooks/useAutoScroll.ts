import { useRef, useEffect, useCallback } from "react";

interface UseAutoScrollOptions {
  speed?: number;
  direction?: "left" | "right";
  resumeDelay?: number;
}

export function useAutoScroll({
  speed = 0.5,
  direction = "right",
  resumeDelay = 2500,
}: UseAutoScrollOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isInteractingRef = useRef(false);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll loop
  useEffect(() => {
    let raf: number;
    let initialized = false;

    const loop = () => {
      const el = containerRef.current;
      if (!el) {
        raf = requestAnimationFrame(loop);
        return;
      }

      // Initialize position for left-scrolling carousels
      if (!initialized) {
        initialized = true;
        if (direction === "left") {
          el.scrollLeft = el.scrollWidth / 2;
        }
      }

      // Only auto-scroll when not interacting
      if (!isInteractingRef.current) {
        if (direction === "right") {
          el.scrollLeft += speed;
          // Infinite loop: reset when halfway through duplicated content
          if (el.scrollLeft >= el.scrollWidth / 2) {
            el.scrollLeft = 0;
          }
        } else {
          el.scrollLeft -= speed;
          if (el.scrollLeft <= 0) {
            el.scrollLeft = el.scrollWidth / 2;
          }
        }
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speed, direction]);

  // Interaction handlers
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const stop = () => {
      isInteractingRef.current = true;
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
        resumeTimeoutRef.current = null;
      }
    };

    const scheduleResume = () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
      resumeTimeoutRef.current = setTimeout(() => {
        isInteractingRef.current = false;
        resumeTimeoutRef.current = null;
      }, resumeDelay);
    };

    // Pointer events: unified touch + mouse
    el.addEventListener("pointerdown", stop);
    el.addEventListener("pointerup", scheduleResume);
    el.addEventListener("pointerleave", scheduleResume);

    // Scroll event: catches momentum scrolling on iOS
    el.addEventListener("scroll", stop);

    return () => {
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("pointerup", scheduleResume);
      el.removeEventListener("pointerleave", scheduleResume);
      el.removeEventListener("scroll", stop);
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, [resumeDelay]);

  // Ref callback
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);

  // Manual controls (for hover on desktop)
  const pause = useCallback(() => {
    isInteractingRef.current = true;
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    isInteractingRef.current = false;
  }, []);

  return { containerRef: setContainerRef, pause, resume };
}
