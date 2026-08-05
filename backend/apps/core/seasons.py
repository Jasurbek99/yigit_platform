"""Season resolution — the single home for "which season?".

`Season.is_active` historically did two unrelated jobs: it named the *write
target* (which season new rows are stamped with) and it was used ad-hoc as the
*read scope* (which season an endpoint returns). Closing a season splits those:
the write target moves, but a user may still choose to read a past season.

    get_active_season()      → write target
    resolve_season(request)  → read scope

`core/` is upstream of every other app, so this is the only legal home for it.
"""
from django.core.exceptions import ImproperlyConfigured
from django.db.models import Q, QuerySet
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

    # int(), not raw.isdigit(): str.isdigit() is True for non-ASCII digit
    # characters like U+00B2 that int() rejects, so an isdigit() guard lets a
    # malformed id through to an unhandled ValueError — a 500, not a 404.
    try:
        season = Season.objects.filter(pk=int(raw)).first()
    except ValueError:
        season = None
    if season is None:
        raise NotFound(f'Season {raw} not found.')

    if season.is_closed and not can_view_closed(request.user):
        raise PermissionDenied('You do not have permission to view closed seasons.')

    return season


def assert_season_open(season: Season | None) -> None:
    """Guard for every write path. No-op when `season` is None or open."""
    if season is not None and season.is_closed:
        raise SeasonClosedError(season)


def freeze_season_of(obj) -> Season | None:
    """The Season a row belongs to, for the write freeze (D1).

    The single anchor definition, read by BOTH layers — `SeasonNotClosed`
    on a saved row and `assert_create_target_open` on an unsaved one — so a
    create and a later edit of the same row can never disagree.

    Order of authority:
      1. `type(obj).freeze_season` — an explicit model hook, for models whose
         anchor is not a plain `season`/`shipment` FK. `ContractSale` defines
         it: its `shipment` is nullable but its `contract` is not, and
         `contract.season` is authoritative.
      2. `obj.season`.
      3. `obj.shipment.season` — join-scoped children.

    Args:
        obj: A model instance, saved or unsaved.

    Returns:
        The Season, or None when the row genuinely belongs to none — an
        unlinked legacy `Task` / `QuotaUsageRecord` / `CustomsExpense`, none of
        which has an alternate anchor. `assert_season_open` treats None as open.
    """
    if hasattr(type(obj), 'freeze_season'):
        return obj.freeze_season
    season = getattr(obj, 'season', None)
    if season is not None:
        return season
    return getattr(getattr(obj, 'shipment', None), 'season', None)


def _model_kwargs(model, validated_data: dict) -> dict:
    """The subset of `validated_data` that `model(**kwargs)` accepts.

    Drops m2m and write-only non-model keys, which would raise TypeError.
    """
    names = set()
    for field in model._meta.concrete_fields:
        names.add(field.name)
        names.add(field.attname)
    return {key: value for key, value in validated_data.items() if key in names}


def assert_bulk_seasons_open(queryset: QuerySet, season_path: str = 'season') -> None:
    """Guard for a bulk write that selects rows by a raw id list.

    Layer-1 object permissions never fire on those paths — there is no
    `get_object()` — so the season has to be checked against the rows
    themselves. One query regardless of how many ids were submitted, and it
    rejects the whole batch: a partially-applied bulk write against a frozen
    season is worse than a rejected one.

    Args:
        queryset: The rows about to be mutated.
        season_path: ORM path from the model to Season. Use
            ``'shipment__season'`` for join-scoped children.

    Raises:
        SeasonClosedError: If any row in `queryset` belongs to a closed season.
    """
    closed = Season.objects.filter(
        # .order_by() strips Meta.ordering — MSSQL rejects ORDER BY inside a
        # subquery without TOP/OFFSET (see .claude/rules/mssql-compat.md).
        pk__in=queryset.order_by().values(season_path),
        closed_at__isnull=False,
    ).first()
    if closed is not None:
        raise SeasonClosedError(closed)


def assert_season_id_open(season_id) -> None:
    """Guard for a write whose season arrives in the request BODY.

    `set_selection` and the two `initialize_week` actions take a season id from
    the payload and create rows under it, so neither layer-1 nor a queryset
    check can see it.

    Args:
        season_id: Raw season id from the request body; falsy is a no-op.

    Raises:
        SeasonClosedError: If that season exists and is closed.
    """
    if not season_id:
        return
    assert_season_open(Season.objects.filter(pk=season_id).first())


class SeasonScopedMixin:
    """Applies the resolved read scope to a viewset queryset.

    Scoping is the default and opting out is the explicit act — with ~20
    endpoints, a hand-written filter per viewset means the one that gets
    forgotten silently leaks closed-season data, which is precisely what this
    feature exists to prevent.

    Override `season_field` when the model reaches Season through a join:

        class TaskViewSet(SeasonScopedMixin, ModelViewSet):
            season_field = 'shipment__season'

    Set `include_null_link = True` when that join's anchor FK is nullable
    (e.g. `ContractSale.shipment`, `Task.shipment`, `QuotaUsageRecord.shipment`,
    `CustomsExpense.shipment`). A plain equality filter on `shipment__season`
    is an inner join and silently drops every row where the anchor is NULL —
    legacy/unlinked rows would vanish from every season's list, not just the
    "wrong" one. Those rows surface alongside an *open* resolved season and are
    hidden the moment a *closed* season is explicitly selected: browsing a
    closed season is browsing that season's archive, and an unlinked row
    belongs to no season, so it has no place there.
    """

    season_field: str = 'season'
    include_null_link: bool = False

    # Sentinel distinguishing "caller didn't pass a season" from "caller
    # passed season=None" (which is the legitimate close→open-gap value and
    # must still fail closed, not fall back to resolving one).
    _SEASON_NOT_GIVEN = object()

    def assert_update_target_open(self, serializer) -> None:
        """Reject an update that MOVES a row into a closed season (D1).

        `SeasonNotClosed` runs inside `get_object()`, so it sees the anchor the
        row has BEFORE the write. A PATCH that reassigns the anchor FK itself
        (`ContractSale.contract`, `WeeklyTruckAllocation.season`, …) therefore
        clears the object permission and then writes into the frozen season.
        This checks the anchor the row will have AFTER the write, so the origin
        and the destination both have to be open.

        Args:
            serializer: The validated update serializer.

        Raises:
            SeasonClosedError: If the update would move the row into a closed
                season.
        """
        instance = serializer.instance
        model = type(instance)
        # A fresh instance, not copy.copy(instance): a shallow copy shares
        # `_state` (and its related-object cache) with the real row, so
        # applying the incoming FKs would pollute the row the caller still
        # holds. Seeded by attname only — Model.__init__ rejects a mix of
        # `contract` and `contract_id` for the same field.
        merged = model(**{
            field.attname: getattr(instance, field.attname)
            for field in model._meta.concrete_fields
        })
        for key, value in _model_kwargs(model, serializer.validated_data).items():
            setattr(merged, key, value)
        assert_season_open(freeze_season_of(merged))

    def assert_create_target_open(self, serializer) -> None:
        """Reject a POST-to-collection that targets a closed season (D1).

        DRF's `CreateModelMixin` never calls `get_object()`, so the
        `SeasonNotClosed` object permission structurally cannot fire on a
        create — every scoped viewset must call this from its
        `perform_create()`. It is deliberately NOT a mixin-level
        `perform_create()`: most of these viewsets override `perform_create`
        and call `serializer.save(...)` directly instead of `super()`, so a
        mixin-level hook would be silently skipped on exactly the viewsets
        that need it (the same trap Task 5 documented for `get_queryset`).

        Resolves through `freeze_season_of()` on an UNSAVED instance built
        from the validated data, so a create and a later PATCH on the same row
        answer through exactly one anchor definition. Deriving the anchor from
        `season_field` instead (the first implementation) anchored
        `ContractSale` on its nullable `shipment` alone and silently missed its
        authoritative non-nullable `contract.season`.

        Requires a ModelSerializer. A plain `Serializer` has no `Meta.model`
        and may carry bare ids rather than instances (`CommentCreateSerializer`
        does both), so those viewsets must guard their create explicitly — and
        this raises rather than passing, so the gap is loud instead of silent.

        Residual limitation, deliberately not defended against: a key in
        `validated_data` that matches no concrete model field is dropped by
        `_model_kwargs`. For a ModelSerializer the keys are model field
        sources, so they line up; a hand-rolled `source=` mapping onto a
        non-field name would leave the anchor unset, and an unset anchor is
        legitimately a no-op (it is how a NULL-anchor legacy row passes).

        Args:
            serializer: The validated create serializer.

        Raises:
            SeasonClosedError: If the create targets a closed season.
            ImproperlyConfigured: If `serializer` is not a ModelSerializer.
        """
        model = getattr(getattr(serializer, 'Meta', None), 'model', None)
        if model is None:
            raise ImproperlyConfigured(
                f'{type(self).__name__}.assert_create_target_open() needs a '
                f'ModelSerializer; {type(serializer).__name__} has no Meta.model. '
                'Guard this create explicitly rather than letting it pass.'
            )
        unsaved = model(**_model_kwargs(model, serializer.validated_data))
        assert_season_open(freeze_season_of(unsaved))

    def apply_season_scope(self, qs: QuerySet, season=_SEASON_NOT_GIVEN) -> QuerySet:
        """Scope `qs` to the resolved season, failing CLOSED (D7, spec §3.1).

        No active season and no ?season= means we cannot say which season the
        caller is entitled to, so we return nothing rather than everything.
        Returning `qs` unfiltered would make every closed season readable by
        every user during the close→open gap — the feature's promise inverted,
        in exactly the state an admin creates deliberately at end of season.

        Detail routes are unaffected: they bypass scoping entirely, so a direct
        link still resolves during the gap.

        Pass `season` when the caller already resolved it for another reason
        (e.g. a `?shipment=<id>` pin exemption that needs to inspect the
        resolved season before deciding whether to scope at all) — this avoids
        calling `resolve_season()` twice, which would otherwise raise its
        `NotFound`/`PermissionDenied` side effects redundantly (harmless, but
        wasteful). Defaults to resolving it here.
        """
        if season is self._SEASON_NOT_GIVEN:
            season = resolve_season(self.request)
        if season is None:
            return qs.none()
        season_q = Q(**{self.season_field: season})
        if self.include_null_link and not season.is_closed:
            anchor_field, _, _ = self.season_field.rpartition('__')
            season_q |= Q(**{f'{anchor_field}__isnull': True})
        return qs.filter(season_q)
