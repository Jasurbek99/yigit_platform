import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CommentsDrawerOverlay } from './CommentsDrawerOverlay';

// The real CommentsDrawer pulls in useSheetStore + CommentList/CommentComposer
// (API + i18n). This test is only about the overlay's own pointer-events
// gating, so the drawer itself is stubbed out.
vi.mock('./CommentsDrawer', () => ({
  CommentsDrawer: () => <div data-testid="comments-drawer-stub" />,
}));

/**
 * Regression test for the invisible click-blocker (Task 9 review Finding 1):
 * an earlier version rendered the 360px, pointerEvents:'auto' column
 * unconditionally and only gated the `<CommentsDrawer>` inside it on `open`.
 * That left a full-height, right-docked strip silently swallowing clicks on
 * real page content (RouteTimelineRail, Links card, activity log link) even
 * with the drawer closed.
 *
 * jsdom does no hit-testing and ignores CSS `pointer-events` when dispatching
 * events, so "does a click reach the element behind it" can't be exercised
 * here — the reliable assertion is DOM presence: the clickable column must
 * not exist at all while closed.
 *
 * Confirmed this test fails against the pre-fix code: temporarily reverted
 * the `{open && (...)}` gate to the original unconditional `<div>`, ran
 * `npx vitest run CommentsDrawerOverlay`, and the closed-state assertion
 * failed (`expected 0 to be undefined`/element found when none was expected).
 * Re-applying the gate turns it green again.
 */
describe('CommentsDrawerOverlay', () => {
  it('renders no clickable column when closed — nothing intercepts clicks', () => {
    const { container } = render(<CommentsDrawerOverlay open={false} onClose={() => {}} />);
    const clickableColumn = container.querySelector('[style*="pointer-events: auto"]');
    expect(clickableColumn).toBeNull();
  });

  it('renders the clickable column when open', () => {
    const { container } = render(<CommentsDrawerOverlay open={true} onClose={() => {}} />);
    const clickableColumn = container.querySelector('[style*="pointer-events: auto"]');
    expect(clickableColumn).not.toBeNull();
  });
});
