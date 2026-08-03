"""Season resolution — the single home for "which season?".

`Season.is_active` historically did two unrelated jobs: it named the *write
target* (which season new rows are stamped with) and it was used ad-hoc as the
*read scope* (which season an endpoint returns). Closing a season splits those:
the write target moves, but a user may still choose to read a past season.

    get_active_season()      → write target
    resolve_season(request)  → read scope

`core/` is upstream of every other app, so this is the only legal home for it.
"""
from django.db.models import QuerySet
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.core.models import RoleResourcePermission, Season

CLOSED_SEASON_RESOURCE = 'closed_season'


class SeasonClosedError(Exception):
    """Raised when a write is attempted against a closed season."""

    def __init__(self, season: Season) -> None:
        self.season = season
        super().__init__(f'Season {season.name} is closed and read-only.')


def get_active_season() -> Season | None:
    """The write target.

    Deterministic without a tie-break: `uq_season_single_active` guarantees at
    most one row has is_active=True. Returns None between closing one season and
    opening the next, which is a legitimate end-of-season state.
    """
    return Season.objects.filter(is_active=True).first()


def can_view_closed(user) -> bool:
    """True if `user` may select a closed season.

    Backed by RoleResourcePermission(resource_code='closed_season').can_view so
    admins can grant it per role without a code change.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    role = getattr(user, 'role', None)
    if not role:
        return False
    return RoleResourcePermission.objects.filter(
        role=role, resource_code=CLOSED_SEASON_RESOURCE, can_view=True,
    ).exists()


def resolve_season(request) -> Season | None:
    """The read scope for this request.

    Reads ?season=<id>; falls back to the active season. A closed season is only
    resolvable by a user holding `closed_season.can_view`.

    Raises:
        NotFound: the requested season id does not exist.
        PermissionDenied: the season is closed and the user may not view it.

    PermissionDenied rather than an empty queryset is deliberate: an empty list
    for a season the user can see in the switcher reads as "this season has no
    data", which is a lie.
    """
    raw = (request.query_params.get('season') or '').strip()
    if not raw:
        return get_active_season()

    season = Season.objects.filter(pk=raw).first() if raw.isdigit() else None
    if season is None:
        raise NotFound(f'Season {raw} not found.')

    if season.is_closed and not can_view_closed(request.user):
        raise PermissionDenied('You do not have permission to view closed seasons.')

    return season


def assert_season_open(season: Season | None) -> None:
    """Guard for every write path. No-op when `season` is None or open."""
    if season is not None and season.is_closed:
        raise SeasonClosedError(season)


class SeasonScopedMixin:
    """Applies the resolved read scope to a viewset queryset.

    Scoping is the default and opting out is the explicit act — with ~20
    endpoints, a hand-written filter per viewset means the one that gets
    forgotten silently leaks closed-season data, which is precisely what this
    feature exists to prevent.

    Override `season_field` when the model reaches Season through a join:

        class TaskViewSet(SeasonScopedMixin, ModelViewSet):
            season_field = 'shipment__season'
    """

    season_field: str = 'season'

    def apply_season_scope(self, qs: QuerySet) -> QuerySet:
        season = resolve_season(self.request)
        if season is None:
            return qs
        return qs.filter(**{self.season_field: season})
