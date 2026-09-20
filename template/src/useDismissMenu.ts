import { useEffect, useRef, type RefObject } from 'react';

/**
 * Close a popover when the pointer goes down outside it.
 *
 * There was no click-outside handling anywhere in this app before 2026-09-15 —
 * the download menu closed only on Escape, on choosing an item, or on a
 * diagram switch. Both menus now share this one listener, which is attached
 * only while a menu is open.
 *
 * `pointerdown`, not `click`: a press that starts outside the menu and ends
 * inside it (a drag over the panel) should still dismiss, and pointerdown
 * fires before the canvas can begin a pan.
 */
export function useDismissMenu(
  open: boolean,
  onDismiss: () => void,
  refs: Array<RefObject<HTMLElement | null>>,
): void {
  // The caller passes a fresh array literal every render, so the array itself
  // cannot be a dependency without re-attaching the document listener on each
  // render. The latest refs and callback are read through a ref instead, and
  // the effect depends only on whether the menu is open.
  const latest = useRef({ refs, onDismiss });
  latest.current = { refs, onDismiss };

  useEffect(() => {
    if (!open) return undefined;
    const handle = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const { refs: current, onDismiss: dismiss } = latest.current;
      if (current.some((ref) => ref.current?.contains(target))) return;
      dismiss();
    };
    document.addEventListener('pointerdown', handle);
    return () => document.removeEventListener('pointerdown', handle);
  }, [open]);
}
