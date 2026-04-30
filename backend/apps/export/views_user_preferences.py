"""Per-user Sheet row preferences — order + hide.

Endpoints:
    GET  /api/v1/export/user/sheet-preferences/   → current user's row_order + hidden_rows
    PATCH /api/v1/export/user/sheet-preferences/  → bulk update (debounced from frontend)

Auth: IsAuthenticated only — every logged-in user may read/write their own prefs.
Security: every queryset is hard-scoped to request.user; other users' prefs
are never exposed.

ADR-0003: Per-user row order stored in DB (UserSheetRowPref), synced debounced from frontend.
ADR-0008: position and is_hidden are flat columns — no JSONField (MSSQL forbids it).
"""
from django.db import transaction
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.export.models import UserSheetRowPref
from apps.export.models.sheet_settings import SheetRowSetting


class UserSheetPreferencesView(APIView):
    """GET / PATCH /api/v1/export/user/sheet-preferences/

    GET response shape:
        {
            "row_order": [<row_id>, ...],    // only ids where user.position IS NOT NULL,
                                              // ordered by position ASC
            "hidden_rows": [<row_id>, ...],  // ids where user.is_hidden=True
            "updated_at": "ISO8601 | null"   // latest pref.updated_at for this user
        }

    PATCH body (partial — absent key = no-op):
        {
            "row_order": [<row_id>, ...]?,   // fully replaces user positions
            "hidden_rows": [<row_id>, ...]?  // fully replaces user hidden set
        }

    Note: update_or_create is used per row in a small loop (≤50 rows). Correct
    batch_size=500 bulk_create is not applicable here because the correct
    atomic per-(user, row) semantics require upsert, not insert. The loop is
    safe for ≤50 rows; document the trade-off with this comment.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        """Return current user's row order and hidden rows."""
        if not request.user.is_authenticated:
            return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

        prefs = list(
            UserSheetRowPref.objects.filter(user=request.user)
            .select_related()
            .order_by('position', 'row__display_order')
        )

        row_order = [
            p.row_id
            for p in sorted(
                (p for p in prefs if p.position is not None),
                key=lambda p: p.position,
            )
        ]
        hidden_rows = [p.row_id for p in prefs if p.is_hidden]

        latest_updated_at = None
        if prefs:
            latest = max((p.updated_at for p in prefs if p.updated_at), default=None)
            if latest:
                latest_updated_at = latest.isoformat()

        return Response({
            'row_order': row_order,
            'hidden_rows': hidden_rows,
            'updated_at': latest_updated_at,
        })

    def patch(self, request: Request) -> Response:
        """Bulk-update the current user's row order and/or hidden rows.

        Each present key fully replaces the user's current state for that
        dimension. Absent key = no-op for that dimension.

        Idempotent: same payload twice → same DB state.
        """
        if not request.user.is_authenticated:
            return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

        body = request.data
        has_row_order = 'row_order' in body
        has_hidden_rows = 'hidden_rows' in body

        if not has_row_order and not has_hidden_rows:
            # Nothing to update — return current state
            return self.get(request)

        # --- Validation: collect all row_ids from both keys ---
        row_order_ids: list[int] = []
        hidden_row_ids: list[int] = []

        if has_row_order:
            row_order_ids = list(body.get('row_order', []))
            if not isinstance(row_order_ids, list):
                return Response(
                    {'error': 'row_order must be a list of row ids.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(set(row_order_ids)) != len(row_order_ids):
                return Response(
                    {'error': 'row_order contains duplicate row ids.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if has_hidden_rows:
            hidden_row_ids = list(body.get('hidden_rows', []))
            if not isinstance(hidden_row_ids, list):
                return Response(
                    {'error': 'hidden_rows must be a list of row ids.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(set(hidden_row_ids)) != len(hidden_row_ids):
                return Response(
                    {'error': 'hidden_rows contains duplicate row ids.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        all_submitted_ids: set[int] = set(row_order_ids) | set(hidden_row_ids)

        if all_submitted_ids:
            # Validate that all submitted ids exist in active SheetRowSetting rows
            existing_ids = set(
                SheetRowSetting.objects.active()
                .filter(pk__in=all_submitted_ids)
                .values_list('pk', flat=True)
            )
            unknown = sorted(all_submitted_ids - existing_ids)
            if unknown:
                return Response(
                    {'error': 'unknown_row_ids', 'ids': unknown},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # --- Atomic apply ---
        with transaction.atomic():
            if has_row_order:
                self._apply_row_order(request.user, row_order_ids)

            if has_hidden_rows:
                self._apply_hidden_rows(request.user, hidden_row_ids)

        return self.get(request)

    # ── Private helpers ──────────────────────────────────────────────────────

    def _apply_row_order(self, user, row_order_ids: list[int]) -> None:
        """Fully replace user's position values.

        For each id in row_order_ids: set position = (index + 1) * 1024.
        For any existing pref NOT in row_order_ids: set position = NULL
        (they fall back to admin display_order but retain their is_hidden state).
        """
        # Assign new positions (upsert per row, ≤50 rows — loop is fine)
        id_to_position: dict[int, int] = {
            row_id: (idx + 1) * 1024
            for idx, row_id in enumerate(row_order_ids)
        }

        # Apply explicit positions
        for row_id, pos in id_to_position.items():
            UserSheetRowPref.objects.update_or_create(
                user=user,
                row_id=row_id,
                defaults={'position': pos},
            )

        # NULL out positions for rows that were previously positioned but
        # are absent from the new payload.
        if row_order_ids:
            (
                UserSheetRowPref.objects
                .filter(user=user, position__isnull=False)
                .exclude(row_id__in=row_order_ids)
                .update(position=None)
            )
        else:
            # Empty row_order → clear all user positions
            UserSheetRowPref.objects.filter(user=user, position__isnull=False).update(position=None)

    def _apply_hidden_rows(self, user, hidden_row_ids: list[int]) -> None:
        """Fully replace user's hidden set.

        For each id in hidden_row_ids: set is_hidden=True.
        For any existing pref with is_hidden=True whose id is NOT in
        hidden_row_ids: set is_hidden=False (unhide).
        """
        hidden_set: set[int] = set(hidden_row_ids)

        # Hide listed rows (upsert — ≤50 rows)
        for row_id in hidden_set:
            UserSheetRowPref.objects.update_or_create(
                user=user,
                row_id=row_id,
                defaults={'is_hidden': True},
            )

        # Unhide rows that were previously hidden but are not in the new set
        if hidden_set:
            (
                UserSheetRowPref.objects
                .filter(user=user, is_hidden=True)
                .exclude(row_id__in=hidden_set)
                .update(is_hidden=False)
            )
        else:
            # Empty hidden_rows → unhide everything
            UserSheetRowPref.objects.filter(user=user, is_hidden=True).update(is_hidden=False)
