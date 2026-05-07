import { useRef } from 'react';

export function useDoubleTap(callback: () => void, delay = 300) {
  const lastTap = useRef(0);
  return () => {
    const now = Date.now();
    if (now - lastTap.current < delay) {
      lastTap.current = 0;
      callback();
    } else {
      lastTap.current = now;
    }
  };
}
