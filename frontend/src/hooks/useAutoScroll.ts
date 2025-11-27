import { useRef, useEffect } from "react";

interface UseAutoScrollOptions {
  speed?: number;
  direction?: "left" | "right";
}

export function useAutoScroll({
  speed = 30,
  direction = "right",
}: UseAutoScrollOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let animationId: number;
    let lastTime = 0;
    let isInitialized = false;

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

      if (!lastTime) lastTime = timestamp;
      const delta = timestamp - lastTime;
      lastTime = timestamp;

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

      animationId = requestAnimationFrame(scroll);
    };

    animationId = requestAnimationFrame(scroll);

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [speed, direction]);

  return containerRef;
}
