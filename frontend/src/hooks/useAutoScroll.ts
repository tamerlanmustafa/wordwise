import { useEffect, useRef } from 'react';

interface UseAutoScrollOptions {
  speed?: number;
  direction?: 'left' | 'right';
  pauseOnHover?: boolean;
}

export function useAutoScroll({
  speed = 0.5,
  direction = 'right',
  pauseOnHover = true
}: UseAutoScrollOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(false);
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollPosition = 0;
    const scrollSpeed = direction === 'right' ? speed : -speed;

    const animate = () => {
      if (!isPausedRef.current && container) {
        scrollPosition += scrollSpeed;

        const maxScroll = container.scrollWidth - container.clientWidth;

        // Seamless loop: when we reach halfway, reset to start
        // This works because we duplicate the content
        if (direction === 'right' && scrollPosition >= maxScroll / 2) {
          scrollPosition = 0;
        } else if (direction === 'left' && scrollPosition <= -maxScroll / 2) {
          scrollPosition = maxScroll / 2;
        }

        container.scrollLeft = scrollPosition;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    // Handle pause on hover
    const handleMouseEnter = () => {
      if (pauseOnHover) {
        isPausedRef.current = true;
      }
    };

    const handleMouseLeave = () => {
      if (pauseOnHover) {
        isPausedRef.current = false;
      }
    };

    if (pauseOnHover) {
      container.addEventListener('mouseenter', handleMouseEnter);
      container.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (pauseOnHover && container) {
        container.removeEventListener('mouseenter', handleMouseEnter);
        container.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [speed, direction, pauseOnHover]);

  return containerRef;
}
