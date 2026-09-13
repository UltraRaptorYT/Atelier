'use client';
import { useEffect, useRef, useState } from 'react';

/** Native fullscreen with an in-page fallback for embedded/unsupported browsers. */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [native, setNative] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const change = () => setNative(document.fullscreenElement === ref.current);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('fullscreenchange', change);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  async function toggle() {
    if (document.fullscreenElement === ref.current) {
      await document.exitFullscreen().catch(() => {});
    } else if (expanded) {
      setExpanded(false);
    } else {
      try {
        if (!ref.current?.requestFullscreen) throw new Error('Fullscreen unavailable');
        await ref.current.requestFullscreen();
      } catch { setExpanded(true); }
    }
  }
  async function exit() {
    setExpanded(false);
    if (document.fullscreenElement === ref.current) await document.exitFullscreen().catch(() => {});
  }
  return { ref, isFullscreen: native || expanded, toggle, exit };
}
