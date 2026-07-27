import { CommentsDrawer } from '@/components/comments/CommentsDrawer';

interface ICommentsDrawerOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Anchors `CommentsDrawer` to the viewport instead of the host page.
 *
 * The drawer renders inline (`getContainer={false}`) with `position: absolute`,
 * so it docks to its nearest positioned ancestor. On the Sheet that ancestor
 * is `.sheet-page` — a fixed-height, non-scrolling shell (only its internal
 * grid scrolls) — so "absolute" already reads as "pinned to the viewport".
 * The Detail page is a normal scrolling document: a plain `position: relative`
 * wrapper would let the drawer scroll away with the page content instead of
 * staying docked (confirmed visually — the panel scrolled out of view).
 *
 * This wrapper gives the drawer a `position: fixed` ancestor instead, so it
 * stays pinned regardless of how tall or scrolled the host page is. Kept
 * outside `CommentsDrawer` itself so the Sheet's own layout is untouched.
 *
 * The drawer is deliberately non-modal (`mask={false}` — see CommentsDrawer),
 * so the rest of the page must stay clickable while it's open. The fixed
 * outer layer is `pointerEvents: none` and only its 360px-wide, right-docked
 * inner column (matching the drawer's own `width={360}`) re-enables pointer
 * events — confirmed by hand: an earlier version made the whole viewport
 * `pointerEvents: auto`, which silently ate every click on the page (even
 * with the drawer closed) until the column was narrowed to match the panel.
 *
 * That narrowed column was still rendered unconditionally, though — only the
 * `CommentsDrawer` inside it was gated on `open`. A closed drawer therefore
 * left a 360px-wide, full-viewport-height, invisible `pointerEvents: auto`
 * strip docked to the right edge, silently swallowing clicks on whatever real
 * content sits there (RouteTimelineRail, the Links card, "View activity log").
 * The clickable column itself must be gated on `open` so nothing intercepts
 * pointer events in the closed state — not just the drawer it contains.
 */
export function CommentsDrawerOverlay({ open, onClose }: ICommentsDrawerOverlayProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      {open && (
        <div style={{ width: 360, pointerEvents: 'auto' }}>
          <CommentsDrawer open={open} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
