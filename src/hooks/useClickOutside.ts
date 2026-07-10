import { useEffect, useRef } from "react";

/**
 * Calls `handler` when a click/touch happens outside the referenced element.
 * Pass `enabled` to temporarily disable listening.
 */
export function useClickOutside<T extends HTMLElement>(
  handler: () => void,
  enabled = true
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        handler();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [handler, enabled]);

  return ref;
}
