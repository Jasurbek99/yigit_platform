import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Positioning and dismissal machinery for the Sheet's cell overlays
 * (`SheetTruckSelectEditor`, `SheetDriverSelectEditor`).
 *
 * `.sheet-cell` has `contain: layout paint` and `.sheet-grid` scrolls with
 * overflow, so an in-flow panel gets clipped and mispositioned inside the
 * editing cell. The caller keeps `anchorRef` in flow (it measures the cell's
 * real on-screen position) and portals the panel itself to `document.body`
 * with `position: fixed` at `coords` — the same escape hatch AntD's own
 * Select dropdowns use.
 *
 * Both dismissal paths deliberately ignore anything inside
 * `.ant-select-dropdown`. Those dropdowns are portaled to `document.body`
 * too (NOT overridden via `getPopupContainer`, since the grid would clip
 * them), so by DOM containment they are "outside" the panel. Without the
 * exclusion, clicking an option or scrolling a long option list would
 * dismiss the editor mid-pick.
 *
 * Scrolling re-anchors rather than dismisses: the panel is `position: fixed`
 * and does not ride the grid's scroll container, so it would otherwise be
 * left hovering over the wrong row. It only dismisses once the cell has left
 * the viewport entirely, where there is nothing left to anchor to.
 *
 * @param onDismiss Called at most once, when the editor should close — an
 *   outside click, or the cell scrolling off screen. The caller decides
 *   whether that commits or cancels.
 */
export function useAnchoredCellPanel(onDismiss: () => void) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  // Latest `onDismiss` for the document listeners below, without
  // re-subscribing them (and without a stale closure) on every keystroke.
  // Assigned during render on purpose — moving it into a useEffect would let a
  // listener fire against the previous render's selection.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // The caller unmounts us in response to `onDismiss`, but that goes through a
  // store update and lands on the next render. Latch so a scroll landing in
  // that gap cannot re-anchor a panel that is already on its way out.
  // `dismiss` closes over refs only, so the listeners below can capture the
  // first render's copy safely.
  const dismissedRef = useRef(false);
  function dismiss() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    dismissRef.current();
  }

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom, left: rect.left });
    }
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (panelRef.current && !panelRef.current.contains(target) && !isInsideDropdown(target)) {
        dismiss();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // capture=true so this catches the grid's inner scroll container, not just
  // window-level scroll. `scroll` does not bubble, but the capture phase
  // still runs from the root down to the target.
  useEffect(() => {
    function handleScroll(e: Event) {
      if (dismissedRef.current || isInsideDropdown(e.target)) return;
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (isOffScreen(rect)) {
        dismiss();
        return;
      }
      setCoords({ top: rect.bottom, left: rect.left });
    }
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  return { anchorRef, panelRef, coords };
}

/**
 * `e.target` is `document` or `window` for a page-level scroll, and neither
 * has `closest` — hence the optional calls rather than a cast.
 */
function isInsideDropdown(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.('.ant-select-dropdown'));
}

/**
 * Strict comparisons on purpose: jsdom reports an all-zero rect, which sits
 * exactly on the viewport's corner and must still count as visible, or every
 * test would see the editor dismiss itself on the first scroll.
 */
function isOffScreen(rect: DOMRect): boolean {
  return (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  );
}
