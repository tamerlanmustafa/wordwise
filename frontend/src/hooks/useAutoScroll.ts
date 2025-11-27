import { useRef, useEffect } from "react";

interface UseAutoScrollOptions {
  speed?: number;
  direction?: "left" | "right";
  pauseOnHover?: boolean;
}

export function useAutoScroll({
  speed = 30,
  direction = "right",
  pauseOnHover = true,
}: UseAutoScrollOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isPausedRef = useRef(false);
  const handlersAttachedRef = useRef(false);

  useEffect(() => {
    let animationId: number;
    let lastTime = 0;
    let isInitialized = false;

    const handleMouseEnter = () => {
      isPausedRef.current = true;
    };
    const handleMouseLeave = () => {
      isPausedRef.current = false;
    };

    const scroll = (timestamp: number) => {
      const el = containerRef.current;
      if (!el) {
        animationId = requestAnimationFrame(scroll);
        return;
      }

      // Initialize starting position once
      if (!isInitialized) {
        isInitialized = true;
        if (direction === "left") {
          el.scrollLeft = el.scrollWidth - el.clientWidth;
        }
      }

      // Attach hover listeners once when element is available
      if (!handlersAttachedRef.current && pauseOnHover) {
        handlersAttachedRef.current = true;
        el.addEventListener("mouseenter", handleMouseEnter);
        el.addEventListener("mouseleave", handleMouseLeave);
      }

      if (!lastTime) lastTime = timestamp;
      const delta = timestamp - lastTime;
      lastTime = timestamp;

      // Only scroll if not paused
      if (!isPausedRef.current) {
        const distance = (speed * delta) / 1000;

        if (direction === "right") {
          el.scrollLeft += distance;
          const max = el.scrollWidth - el.clientWidth;
          if (el.scrollLeft >= max / 2) {
            el.scrollLeft = 0;
          }
        } else {
          el.scrollLeft -= distance;
          const max = el.scrollWidth - el.clientWidth;
          if (el.scrollLeft <= max / 2) {
            el.scrollLeft = max;
          }
        }
      }

      animationId = requestAnimationFrame(scroll);
    };

    animationId = requestAnimationFrame(scroll);

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      const el = containerRef.current;
      if (el && handlersAttachedRef.current) {
        el.removeEventListener("mouseenter", handleMouseEnter);
        el.removeEventListener("mouseleave", handleMouseLeave);
        handlersAttachedRef.current = false;
      }
    };
  }, [speed, direction, pauseOnHover]);

  return containerRef;
}
