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
  const targetSpeedRef = useRef(speed);
  const currentSpeedRef = useRef(speed);

  const setSpeed = (newSpeed: number) => {
    targetSpeedRef.current = newSpeed;
  };

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

      // Smoothly transition speed
      const speedDiff = targetSpeedRef.current - currentSpeedRef.current;
      if (Math.abs(speedDiff) > 0.1) {
        currentSpeedRef.current += speedDiff * 0.1; // Smooth transition
      } else {
        currentSpeedRef.current = targetSpeedRef.current;
      }

      const distance = (currentSpeedRef.current * delta) / 1000;

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
  }, [speed, direction, pauseOnHover]);

  return { containerRef, setSpeed };
}
