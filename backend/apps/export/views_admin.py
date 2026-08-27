"""Admin-facing viewsets for notifications, audit log, and settings CRUD.

Endpoints:
  GET/PATCH /api/v1/export/notifications/              — own notifications
  POST      /api/v1/export/notifications/read_all/     — mark all read
  POST      /api/v1/export/notifications/{id}/read/    — mark one read

  GET       /api/v1/export/audit-log/                  — transition history (admin/director/export_manager)

  GET/POST/PATCH/DELETE /api/v1/export/admin/seasons/  — Season CRUD (resource-permission gated)
  GET/POST/PATCH/DELETE /api/v1/export/admin/firms/         — ExportFirm CRUD (resource-permission gated)
  GET/POST/PATCH/DELETE /api/v1/export/admin/import-firms/  — ImportFirm CRUD (resource-permission gated)
  GET/POST/PATCH/DELETE /api/v1/export/admin/users/    — User CRUD (admin/superuser; POST/DELETE superuser only)
  PUT             /api/v1/export/admin/users/{pk}/permissions/   — Grant export permissions (admin only)

See AD-15 for the admin / director separation rationale.
"""
import logging

from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.core.models import ExportFirm, ImportFirm, RolePagePermission, Season, User
from apps.core.permission_registry import PAGE_REGISTRY
from apps.core.serializer_fields import RelativeFileField
from apps.core.permissions import (
    firm_write_permission,
    get_resource_permissions,
    write_permission,
    DynamicResourcePermission,
)
from apps.core.roles import (
    ADMIN_ONLY,
    AUDIT_VIEWERS,
    PRIVILEGED_ROLES as _PRIVILEGED_ROLES,
    can_manage_users,
    manageable_roles,
)
from apps.core.services.season import (
    close_preview, close_season, deactivate_season, open_season,
)
from apps.export.models import (
    AuditLog, Notification, ProcessNodeLink, TruckSplitDefault, invalidate_truck_split_cache,
)

logger = logging.getLogger(__name__)

# System-administration gates: only admin (or is_superuser) can change user
# roles or manage user permissions. Director/EM lost these powers in AD-15.
_ADMIN_ONLY = ADMIN_ONLY
# User-list visibility — admin always; EM keeps it for the comments/mentions UX.
_ADMIN_MANAGER = frozenset({'admin', 'export_manager'})


def _require_role(user, allowed: frozenset, verb: str = 'perform this action') -> None:
    """Raise PermissionDenied unless user.role is in allowed."""
    if getattr(user, 'role', None) not in allowed:
        raise PermissionDenied(f"Role '{user.role}' is not allowed to {verb}.")


def _require_superuser(user, verb: str = 'perform this action') -> None:
    """Raise PermissionDenied unless the user is a superuser."""
    if not getattr(user, 'is_superuser', False):
        raise PermissionDenied(f"Superuser privileges are required to {verb}.")


def _is_full_admin(user) -> bool:
    """Superuser or the admin role — bypasses delegated-manager scoping."""
    return getattr(user, 'is_superuser', False) or getattr(user, 'role', None) == 'admin'


def _is_delegated_manager(user) -> bool:
    """A non-admin role granted a fixed manageable set under ADR-022.

    Used to gate create / delete / set-password — which AD-15 keeps superuser-only
    for the admin tier — WITHOUT widening them to the admin role. Only a role that
    is an explicit key in MANAGEABLE_BY_ROLE (e.g. loading_dept_head) qualifies.
    """
    from apps.core.roles import MANAGEABLE_BY_ROLE
    return getattr(user, 'role', None) in MANAGEABLE_BY_ROLE


def _assert_can_manage(actor, target) -> None:
    """Raise PermissionDenied unless `actor` may manage `target`'s current role (ADR-022)."""
    if _is_full_admin(actor):
        return
    if getattr(target, 'role', None) not in manageable_roles(actor):
        raise PermissionDenied(
            f"Role '{actor.role}' is not allowed to manage user '{target.username}'."
        )


def _assert_can_assign_role(actor, role: str) -> None:
    """Raise PermissionDenied unless `actor` may assign `role` to a user (ADR-022).

    Guards both the create path and the role-change path so a delegated manager
    can neither create nor promote/demote a user into a role outside their set.
    """
    if _is_full_admin(actor):
        return
    if role not in manageable_roles(actor):
        raise PermissionDenied(
            f"Role '{actor.role}' is not allowed to assign role '{role}'."
        )


# ---------------------------------------------------------------------------
# Serializers (inline — kept here to avoid a separate file for admin-only shapes)
# ---------------------------------------------------------------------------

class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ['id', 'kind', 'message', 'link', 'read_at', 'is_read', 'created_at']
        read_only_fields = fields

    def get_is_read(self, obj: Notification) -> bool:
        return obj.read_at is not None


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id', 'user', 'user_name', 'action', 'model_name',
            'object_id', 'object_repr', 'detail', 'created_at',
        ]
        read_only_fields = fields

    def get_user_name(self, obj: AuditLog) -> str | None:
        if obj.user_id is None:
            return None
        return getattr(obj.user, 'username', None)


class SeasonSerializer(serializers.ModelSerializer):
    status = serializers.CharField(read_only=True)
    closed_by_name = serializers.CharField(source='closed_by.username', read_only=True, default=None)

    # DECLARED EXPLICITLY ON PURPOSE — do not collapse this into `Meta.fields`.
    # Left to `ModelSerializer` to build, `is_active` gets an auto-derived
    # field-level `UniqueValidator` whose queryset is already narrowed to the
    # rows holding the flag (DRF 3.17 maps the
    # `uq_season_single_active` *conditional* UniqueConstraint this way —
    # verified by inspecting `serializer.fields['is_active'].validators`; it is
    # NOT the serializer-level `UniqueTogetherValidator` that AD-16 and commit
    # dbe9ad8 describe, and `Meta.validators = []` therefore would not remove
    # it). That validator 400s every write of `is_active=True` while any other
    # row holds the flag — which is *always*, since swapping the write target
    # is the whole point. An explicitly declared field gets no auto-derived
    # validators at all, which is what makes the delegation below reachable.
    #
    # `required=False` (not a `default`): a body that omits the key must leave
    # the flag alone rather than silently deactivate the season on a rename.
    is_active = serializers.BooleanField(required=False)

    class Meta:
        model = Season
        fields = [
            'id', 'name', 'start_date', 'end_date', 'is_active',
            'status', 'closed_at', 'closed_by', 'closed_by_name',
        ]
        read_only_fields = ['status', 'closed_at', 'closed_by', 'closed_by_name']

    def validate_is_active(self, value: bool) -> bool:
        """Reject activating a closed season.

        Reopening is unsupported (AD-16). `SeasonViewSet.perform_update()`
        would route this to `open_season()`, which refuses a closed target —
        but with a `ValueError` the generic `update()` does not catch, so the
        client would get a raw 500. Catching it here reuses
        `Season.assert_activation_allowed()`, the same predicate `save()`
        enforces, so the two cannot drift, and re-raises as a DRF
        `ValidationError` for a field-keyed 400. The model's own
        `django.core.exceptions.ValidationError` is not translated by the
        custom exception handler, so it cannot be allowed to reach `save()`.

        This is a field-level 400, not the `season_closed` 409 family: that
        contract is reserved for writes to rows *scoped by* a season
        (`SeasonClosedError` in `apps.core.seasons`); `Season` is the subject
        of the freeze, not a row anchored to one — see `SeasonViewSet`'s
        docstring, which already makes the same call for `open_season()`.
        The client is sending an invalid value for this field, not acting on
        frozen data.
        """
        instance = self.instance
        if not value or instance is None:
            return value
        try:
            Season(
                name=instance.name, closed_at=instance.closed_at, is_active=value,
            ).assert_activation_allowed()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages[0]) from exc
        return value


class ExportFirmSerializer(serializers.ModelSerializer):
    # Root-relative /media/... urls — see RelativeFileField for why an absolute
    # url built from the Host header is wrong behind both of our proxies.
    director_signature = RelativeFileField(required=False, allow_null=True)
    director_seal = RelativeFileField(required=False, allow_null=True)

    class Meta:
        model = ExportFirm
        fields = [
            'id', 'code', 'name_short', 'name_tk', 'name_en', 'name_ru',
            'address_tk', 'address_en', 'address_ru',
            'bank_details_tk', 'bank_details_en', 'bank_details_ru',
            'director', 'director_tk', 'director_signature', 'director_seal',
            'tax_code', 'swift_code', 'one_c_code',
            'color', 'sort_order',
            'is_active', 'is_gapy_satys',
        ]


class TruckSplitDefaultSerializer(serializers.ModelSerializer):
    """CRUD shape for the official kg-per-firm export-doc lookup table."""
    updated_by_name = serializers.CharField(source='updated_by.username', read_only=True, default=None)

    class Meta:
        model = TruckSplitDefault
        fields = ['id', 'num_firms', 'kg_per_firm', 'notes', 'updated_at', 'updated_by_name']
        read_only_fields = ['id', 'updated_at', 'updated_by_name']

    def validate_num_firms(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError('num_firms must be >= 1')
        return value

    def validate_kg_per_firm(self, value):
        if value <= 0:
            raise serializers.ValidationError('kg_per_firm must be > 0')
        return value


class ProcessNodeLinkSerializer(serializers.ModelSerializer):
    """Admin CRUD shape for BPMN node -> screen route mappings.

    ``node_id`` is the join key to the diagram's node array and MUST stay
    read-only: a PATCH that could change it would silently orphan the row
    (the diagram would stop resolving a mapping for its old id).
    """

    class Meta:
        model = ProcessNodeLink
        fields = ['id', 'node_id', 'label', 'route', 'is_active']
        read_only_fields = ['id', 'node_id']


class ImportFirmSerializer(serializers.ModelSerializer):
    country_name = serializers.CharField(source='country.name_en', read_only=True, default=None)
    city_name = serializers.CharField(source='city.name', read_only=True, default=None)
    # See ExportFirmSerializer above.
    director_signature = RelativeFileField(required=False, allow_null=True)
    director_seal = RelativeFileField(required=False, allow_null=True)

    class Meta:
        model = ImportFirm
        fields = [
            'id', 'code', 'name_company', 'name_short',
            'country', 'country_name', 'city', 'city_name',
            'address', 'bank_details', 'contact_person', 'contact_person_tk', 'phone',
            'director_signature', 'director_seal',
            'color', 'sort_order',
            'is_active', 'is_gapy_satys',
        ]


class UserListSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'role', 'is_active', 'is_superuser', 'phone', 'permissions']
        # is_superuser is always read-only — it is managed at the DB / Django-admin level.
        read_only_fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_superuser', 'phone', 'permissions']

    def get_permissions(self, obj: User) -> list[str]:
        """Return custom export/core permission codenames for the user."""
        return list(
            obj.user_permissions.filter(
                content_type__app_label__in=['export', 'core'],
            ).values_list('codename', flat=True)
        )


class UserPatchSerializer(serializers.ModelSerializer):
    """Only role and is_active may be patched. Admin-only via partial_update gate (AD-15)."""

    class Meta:
        model = User
        fields = ['role', 'is_active']


# ---------------------------------------------------------------------------
# Viewsets
# ---------------------------------------------------------------------------

class NotificationViewSet(ReadOnlyModelViewSet):
    """Authenticated user sees only their own notifications.

    GET  /api/v1/export/notifications/           — list (supports ?unread=true)
    GET  /api/v1/export/notifications/{id}/      — detail
    POST /api/v1/export/notifications/read_all/  — mark all as read
    POST /api/v1/export/notifications/{id}/read/ — mark one as read
    """

    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        if self.request.query_params.get('unread', '').lower() == 'true':
            qs = qs.filter(read_at__isnull=True)
        return qs

    @action(detail=False, methods=['post'], url_path='read_all')
    def read_all(self, request):
        """POST /api/v1/export/notifications/read_all/ — mark every unread notification read."""
        now = timezone.now()
        updated = Notification.objects.filter(
            user=request.user,
            read_at__isnull=True,
        ).update(read_at=now)
        return Response({'marked_read': updated})

    @action(detail=True, methods=['post'], url_path='read')
    def read(self, request, pk=None):
        """POST /api/v1/export/notifications/{id}/read/ — mark a single notification read."""
        notification = self.get_object()
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=['read_at'])
        serializer = self.get_serializer(notification)
        return Response(serializer.data)


class AuditLogViewSet(ReadOnlyModelViewSet):
    """Read-only audit trail.

    Accessible to admin, director, and export_manager (AUDIT_VIEWERS — AD-15),
    plus boss (read-only oversight, 2026-08-05).

    GET /api/v1/export/audit-log/          — list (filter ?model_name=&action=&object_id=&user=)
    GET /api/v1/export/audit-log/{id}/     — detail
    """

    permission_classes = [IsAuthenticated]
    serializer_class = AuditLogSerializer

    queryset = AuditLog.objects.select_related('user').order_by('-created_at')

    def check_permissions(self, request):
        super().check_permissions(request)
        # 'boss' widened at the call site, not in AUDIT_VIEWERS itself — the
        # audit log is read-only oversight and the boss's process sidebar links
        # to it (2026-08-05 boss-process-visibility).
        _require_role(request.user, AUDIT_VIEWERS | {'boss'}, 'view audit logs')

    def get_queryset(self):
        qs = AuditLog.objects.select_related('user').order_by('-created_at')
        params = self.request.query_params
        if model_name := params.get('model_name'):
            qs = qs.filter(model_name=model_name)
        if action_val := params.get('action'):
            qs = qs.filter(action=action_val)
        if object_id := params.get('object_id'):
            try:
                qs = qs.filter(object_id=int(object_id))
            except (ValueError, TypeError):
                pass
        if user_id := params.get('user'):
            try:
                qs = qs.filter(user_id=int(user_id))
            except (ValueError, TypeError):
                pass
        return qs


def _require_season_edit(user) -> None:
    """Raise PermissionDenied unless `user` holds season.can_edit.

    `close`/`open` are edits to an existing Season row, not creations, and
    `close-preview` is advisory data for someone about to decide whether to
    close (design spec §7) — none of the three is a plain read, so none can
    rely on `DynamicResourcePermission`'s method->flag mapping alone (POST ->
    can_create for close/open; GET -> can_view for close-preview, which is
    weaker than intended). `SeasonViewSet.permission_classes` is left as-is
    (so plain list/retrieve/create/update/delete keep the existing
    can_view/can_create/can_edit/can_delete mapping); this is an additional
    explicit check run at the top of all three actions instead, per
    `get_resource_permissions()` (core/permissions.py) rather than a new
    permission class.

    Note: because `DynamicResourcePermission` still runs first as a
    class-level permission, the effective gate is `can_create AND can_edit`
    for close/open and `can_view AND can_edit` for close-preview. Every role
    holding `season` resource permissions today (admin/director/
    export_manager) gets the blanket `_VCRUD` tuple in
    `seed_permissions.RESOURCE_DEFAULTS` — all four flags True — so this
    never bites in practice. A role configured with edit=True but
    create=False/view=False for 'season' would be wrongly denied by the
    class-level check before reaching this one; no such role exists in the
    seeder today.
    """
    if getattr(user, 'is_superuser', False):
        return
    role = getattr(user, 'role', None)
    if not role or not get_resource_permissions(role).get('season', {}).get('edit'):
        raise PermissionDenied('season.edit required.')


class SeasonViewSet(ModelViewSet):
    """Season CRUD + lifecycle actions (close / open / close-preview).

    List/retrieve/writes are ALL gated dynamically on resource_code='season'
    (RoleResourcePermission), via DynamicResourcePermission — GET requires
    can_view, same as every other action. Not every authenticated role holds
    it: per default seed, admin / director / export_manager / boss have
    season.can_view (blanket, alongside full or read-only CRUD); finansist
    holds season.can_view only, so it can list seasons to drive the header
    season switcher without gaining season write access (Task 15b — finansist
    holds closed_season.can_view but was missing the season.can_view needed to
    populate that switcher's options). Every other role has neither.

    `SeasonNotClosed` is deliberately NOT added here. That permission blocks
    writes to rows *scoped by* a season (via `freeze_season_of()` reaching a
    `season`/`shipment` FK); `Season` is the subject of the freeze, not a row
    scoped by one. If `Season` ever anchored to itself, `close_season()` would
    become self-blocking and a closed season could never be acted on again
    (not even to open its successor). Refusing to reopen a closed season is
    instead domain logic inside `open_season()` (raises `ValueError` -> 409
    with a specific message), which is more useful to the caller than the
    generic `SeasonClosedError`.

    GET    /api/v1/export/admin/seasons/               — list
    GET    /api/v1/export/admin/seasons/{id}/          — detail
    POST   /api/v1/export/admin/seasons/                — create
    PATCH  /api/v1/export/admin/seasons/{id}/          — update
    DELETE /api/v1/export/admin/seasons/{id}/          — delete
    GET    /api/v1/export/admin/seasons/{id}/close-preview/ — counts for the confirm dialog
    POST   /api/v1/export/admin/seasons/{id}/close/    — freeze and hide the season
    POST   /api/v1/export/admin/seasons/{id}/open/     — make this the write target
    """

    resource_code = 'season'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = SeasonSerializer
    queryset = Season.objects.all().order_by('-start_date')

    def perform_create(self, serializer: SeasonSerializer) -> None:
        """Create the row, then route an Active tick through `open_season()`.

        Never writes `is_active=True` on the INSERT. Two reasons, and the
        first is the one that made a writable `is_active` unusable before:
        `uq_season_single_active` is a filtered unique index, so an INSERT
        carrying True while another row holds the flag is a straight
        `IntegrityError`. Creating the row UPCOMING and then opening it lets
        `open_season()` demote the incumbent and promote this row inside one
        transaction, which is the only sequence that never transiently
        violates the index — and it writes the AuditLog row.

        `open_season()` mutates the instance it is handed, so the
        `serializer.data` that `CreateModelMixin.create()` renders afterwards
        already shows `is_active: true` / `status: 'ACTIVE'`.
        """
        wants_active = serializer.validated_data.pop('is_active', False)
        season = serializer.save(is_active=False)
        if wants_active:
            open_season(season, self.request.user)

    def perform_update(self, serializer: SeasonSerializer) -> None:
        """Save the plain fields, then route an `is_active` transition.

        The flag itself is popped out of `validated_data` so the generic
        `ModelSerializer.update()` never writes it — the two services own that
        column, which is what keeps them the single source of truth for the
        atomic incumbent swap and the audit trail:

          False -> True  `open_season()`    — demote incumbent + promote, one
                                              transaction, one AuditLog row.
          True  -> False `deactivate_season()` — stand down WITHOUT closing.
                                              Leaves no active season, which
                                              is legitimate (D7 fails closed)
                                              and deliberately not the same as
                                              `close_season()`: nothing is
                                              frozen and `closed_at` stays
                                              NULL.

        A body that omits `is_active` (a rename) defaults `wants_active` to
        the current value, so neither branch fires. Activating a CLOSED season
        never reaches here — `SeasonSerializer.validate_is_active()` 400s it
        during `is_valid()`.
        """
        season = serializer.instance
        was_active = season.is_active
        wants_active = serializer.validated_data.pop('is_active', was_active)
        serializer.save()
        if wants_active and not was_active:
            open_season(season, self.request.user)
        elif was_active and not wants_active:
            deactivate_season(season, self.request.user)

    @action(detail=True, methods=['get'], url_path='close-preview')
    def close_preview_action(self, request, pk=None):
        """GET .../{id}/close-preview/ — counts for the confirm dialog.

        Gated on season.can_edit, not can_view (design spec §7): this is
        advisory data for someone about to decide whether to close, not a
        general-purpose read endpoint.
        """
        _require_season_edit(request.user)
        return Response(close_preview(self.get_object()))

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """POST .../{id}/close/ — freeze and hide the season."""
        _require_season_edit(request.user)
        season = self.get_object()
        try:
            close_season(season, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(season).data)

    @action(detail=True, methods=['post'])
    def open(self, request, pk=None):
        """POST .../{id}/open/ — make this the write target."""
        _require_season_edit(request.user)
        season = self.get_object()
        try:
            open_season(season, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(season).data)


class TruckSplitDefaultViewSet(ModelViewSet):
    """TruckSplitDefault CRUD — official kg-per-firm by # of firms on a truck.

    Write access gated dynamically on resource_code='truck_split_default'.
    Per default seed: admin and director have full CRUD; export_manager is
    read-only (Gap 7 / ADR-016). The values feed `get_default_truck_weight()`
    which is used by `set_firm_splits` to fill `ShipmentFirmSplit.weight_kg`
    and auto-create draft `QuotaUsageRecord` rows.

    Permission: gated dynamically on resource_code='truck_split_default'.

    GET    /api/v1/export/admin/truck-splits/       — list
    GET    /api/v1/export/admin/truck-splits/{id}/  — detail
    POST   /api/v1/export/admin/truck-splits/       — create
    PATCH  /api/v1/export/admin/truck-splits/{id}/  — update
    DELETE /api/v1/export/admin/truck-splits/{id}/  — delete
    """

    resource_code = 'truck_split_default'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = TruckSplitDefaultSerializer
    queryset = TruckSplitDefault.objects.all().order_by('num_firms')

    def perform_create(self, serializer):
        instance = serializer.save(updated_by=self.request.user)
        invalidate_truck_split_cache(instance.num_firms)

    def perform_update(self, serializer):
        instance = serializer.save(updated_by=self.request.user)
        invalidate_truck_split_cache(instance.num_firms)

    def perform_destroy(self, instance):
        n = instance.num_firms
        instance.delete()
        invalidate_truck_split_cache(n)


class ExportFirmViewSet(ModelViewSet):
    """ExportFirm CRUD.

    All authenticated users may list/retrieve.
    Writes gated dynamically on resource_code='export_firm' (RoleResourcePermission).
    Per default seed: admin / director / export_manager have full CRUD.

    GET    /api/v1/export/admin/firms/       — list
    GET    /api/v1/export/admin/firms/{id}/  — detail
    POST   /api/v1/export/admin/firms/       — create
    PATCH  /api/v1/export/admin/firms/{id}/  — update
    DELETE /api/v1/export/admin/firms/{id}/  — delete
    """

    resource_code = 'export_firm'
    parser_classes = [MultiPartParser, JSONParser]
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = ExportFirmSerializer
    queryset = ExportFirm.objects.all().order_by('name_en')


class ProcessNodeLinkViewSet(ModelViewSet):
    """Admin-only list + edit for the boss process diagram's node -> screen mapping.

    No create/delete: the 20 node_ids are fixed by the diagram's data array
    and seeded via migration 0060 — a new node requires a diagram change plus
    a migration, not an admin-panel action.

    Gated inline (admin role or superuser) rather than through
    DynamicResourcePermission. Adding a 'process_node_link' resource_code to
    the matrix would be picked up by the blanket
    ``**{r: _VCRUD for r in _ALL_RESOURCES}`` spreads that RESOURCE_DEFAULTS
    already uses for director / export_manager / boss in seed_permissions.py
    (and core migration 0033 re-applies for boss on every RESOURCE_REGISTRY
    entry), silently granting those roles access this task explicitly
    withholds ("admin full CRUD, everyone else nothing"). An inline check is
    simpler and does not depend on per-role override rows to deny it.
    See UserManagementViewSet above for the same inline-gating pattern.

    GET   /api/v1/export/admin/process-node-links/       — list
    GET   /api/v1/export/admin/process-node-links/{id}/  — detail
    PATCH /api/v1/export/admin/process-node-links/{id}/  — update label/route/is_active
    """

    permission_classes = [IsAuthenticated]
    serializer_class = ProcessNodeLinkSerializer
    queryset = ProcessNodeLink.objects.all().order_by('node_id')
    http_method_names = ['get', 'patch', 'head', 'options']

    def check_permissions(self, request):
        super().check_permissions(request)
        if not _is_full_admin(request.user):
            raise PermissionDenied('Admin privileges are required to manage process node links.')


class ImportFirmViewSet(ModelViewSet):
    """ImportFirm CRUD.

    All authenticated users may list/retrieve.
    Writes gated dynamically on resource_code='import_firm' (RoleResourcePermission).
    Per default seed: admin / director / export_manager have full CRUD.

    GET    /api/v1/export/admin/import-firms/       — list
    GET    /api/v1/export/admin/import-firms/{id}/  — detail
    POST   /api/v1/export/admin/import-firms/       — create
    PATCH  /api/v1/export/admin/import-firms/{id}/  — update
    DELETE /api/v1/export/admin/import-firms/{id}/  — delete
    """

    resource_code = 'import_firm'
    parser_classes = [MultiPartParser, JSONParser]
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = ImportFirmSerializer
    queryset = ImportFirm.objects.select_related('country', 'city').order_by('name_company')


class UserManagementViewSet(ModelViewSet):
    """User management — admin-only for mutations (AD-15).

    List and retrieve: admin or export_manager (or superuser) — EM keeps visibility for the comments/mentions UX.
    PATCH role/is_active: admin only (or superuser). Last-admin guard in perform_update.
    POST create user: superuser only.
    DELETE user: superuser only (self-deletion blocked).
    POST set-password: superuser only.

    GET    /api/v1/export/admin/users/                       — list all users
    GET    /api/v1/export/admin/users/{id}/                  — detail
    PATCH  /api/v1/export/admin/users/{id}/                  — update role + is_active (admin/superuser)
    POST   /api/v1/export/admin/users/                       — create user (superuser only)
    DELETE /api/v1/export/admin/users/{id}/                  — delete user (superuser only)
    POST   /api/v1/export/admin/users/{id}/set-password/     — change password (superuser only)
    """

    # Drop write_permission from the class level — each mutating method enforces
    # its own role/superuser guard inline, allowing superusers with any role to
    # pass through without being blocked by the write_permission role check.
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        qs = User.objects.prefetch_related('user_permissions').order_by('username')
        if user.is_superuser or getattr(user, 'role', None) in _ADMIN_MANAGER:
            return qs
        # Delegated managers (ADR-022) see only the users whose role they may
        # manage — e.g. loading_dept_head sees only deputies + weight masters.
        allowed = manageable_roles(user)
        if not allowed:
            _require_role(user, _ADMIN_MANAGER, 'view user list')  # raises
        return qs.filter(role__in=allowed)

    def get_serializer_class(self):
        if self.request.method == 'PATCH':
            return UserPatchSerializer
        return UserListSerializer

    def partial_update(self, request, *args, **kwargs):
        # Gate the caller: full admins always; delegated managers if they manage
        # anyone (target + new-role bounds are enforced in perform_update).
        if not _is_full_admin(request.user) and not can_manage_users(request.user):
            _require_role(request.user, _ADMIN_ONLY, 'update user roles')  # raises
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def perform_update(self, serializer):
        # Last-admin guard: prevent removing the only active admin from the system.
        # Blocks (1) admin demoting themselves and (2) admin demoting/deactivating
        # another admin while no other active admin exists. Promoting freely is OK.
        # Runs AFTER serializer.is_valid() so DRF has coerced is_active from any
        # truthy/falsy payload shape ("false", 0, "no") to a real bool — checking
        # request.data.is_active before validation is unsafe.
        #
        # Wrapped in transaction.atomic() with select_for_update() to close the
        # TOCTOU window: two concurrent PATCH requests demoting two different
        # admins could otherwise each observe other_admins=1 and both succeed,
        # leaving zero active admins. Locking the candidate rows for the count
        # prevents that.
        from django.db import transaction

        actor = self.request.user
        target_user = serializer.instance
        validated = serializer.validated_data
        new_role = validated.get('role', target_user.role)
        new_active = validated.get('is_active', target_user.is_active)

        # Delegated managers (ADR-022): the target's CURRENT role and the NEW role
        # must both be within the manager's set. This blocks pulling a user in
        # from, or pushing one out to, a role they don't control (e.g. admin).
        if not _is_full_admin(actor):
            _assert_can_manage(actor, target_user)
            _assert_can_assign_role(actor, new_role)
        demoting_admin = (
            target_user.role == 'admin'
            and (new_role != 'admin' or new_active is False)
        )
        with transaction.atomic():
            if demoting_admin:
                other_admins = (
                    User.objects
                    .select_for_update()
                    .filter(role='admin', is_active=True)
                    .exclude(id=target_user.id)
                    .count()
                )
                if other_admins == 0:
                    raise PermissionDenied(
                        'Cannot demote or deactivate the last active admin. '
                        'Promote another user to admin first.'
                    )
            serializer.save()

    def create(self, request):
        """POST /api/v1/export/admin/users/ — create a new platform user.

        Superuser only. Password is write-only and is NEVER returned in any
        response. Django's create_user() is used so the password is hashed.

        Required fields: username, password, role.
        Optional fields: first_name, last_name, email, phone, is_active.

        Delegated managers (ADR-022) may also create users, but only with a role
        inside their manageable set (validated after field checks below).
        """
        actor = request.user
        # AD-15 keeps create superuser-only for the admin tier; ADR-022 adds the
        # delegated path (loading_dept_head) without widening it to the admin role.
        if not actor.is_superuser and not _is_delegated_manager(actor):
            _require_superuser(actor, 'create users')  # raises

        username = request.data.get('username', '').strip()
        password = request.data.get('password', '')
        role = request.data.get('role', '').strip()

        errors: dict[str, list[str]] = {}

        if not username:
            errors['username'] = ['This field is required.']
        elif User.objects.filter(username=username).exists():
            errors['username'] = [f"Username '{username}' is already taken."]

        if not password:
            errors['password'] = ['This field is required.']

        if not role:
            errors['role'] = ['This field is required.']

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        # Delegated managers may only create users inside their manageable set.
        _assert_can_assign_role(actor, role)

        new_user = User.objects.create_user(
            username=username,
            password=password,
            role=role,
            first_name=request.data.get('first_name', ''),
            last_name=request.data.get('last_name', ''),
            email=request.data.get('email', ''),
            phone=request.data.get('phone') or None,
            is_active=bool(request.data.get('is_active', True)),
        )
        serializer = UserListSerializer(new_user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        """DELETE /api/v1/export/admin/users/{id}/ — permanently delete a user.

        Superuser only. Self-deletion is blocked to prevent accidental lockout.

        Delegated managers (ADR-022) may delete users within their manageable set.
        """
        actor = request.user
        # AD-15: delete stays superuser-only for admins; ADR-022 adds delegated path.
        if not actor.is_superuser and not _is_delegated_manager(actor):
            _require_superuser(actor, 'delete users')  # raises

        try:
            target_pk = int(pk)
        except (ValueError, TypeError):
            return Response({'error': 'Invalid user id.'}, status=status.HTTP_400_BAD_REQUEST)

        if target_pk == actor.id:
            return Response(
                {'error': 'Cannot delete your own account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        instance = self.get_object()
        _assert_can_manage(actor, instance)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='set-password')
    def set_password(self, request, pk=None):
        """POST /api/v1/export/admin/users/{id}/set-password/ — set a user's password.

        Superuser only. The password is NEVER echoed back in the response.

        Request body: { "password": "<new_password>" }
        Response:     { "detail": "Password updated." }

        Delegated managers (ADR-022) may reset passwords for users in their set.
        """
        actor = request.user
        # AD-15: password reset stays superuser-only for admins; ADR-022 delegated path.
        if not actor.is_superuser and not _is_delegated_manager(actor):
            _require_superuser(actor, 'set passwords')  # raises

        new_password = request.data.get('password', '')
        if not new_password:
            return Response(
                {'password': ['This field is required.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(new_password) < 5:
            return Response(
                {'password': ['Password must be at least 5 characters.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_user = self.get_object()
        _assert_can_manage(actor, target_user)
        target_user.set_password(new_password)
        target_user.save(update_fields=['password'])
        return Response({'detail': 'Password updated.'}, status=status.HTTP_200_OK)




# ---------------------------------------------------------------------------
# User export-permission management
# ---------------------------------------------------------------------------

class UserPermissionsView(APIView):
    """Grant or replace a user's custom export-app Django permissions.

    PUT /api/v1/export/admin/users/{pk}/permissions/

    Request body:
        { "permissions": ["add_weeklyharvestplan", "change_weeklyharvestplan"] }

    Response:
        { "permissions": ["add_weeklyharvestplan", "change_weeklyharvestplan"] }

    Clears all existing export-app custom permissions for the user, then grants
    the provided codenames. Only codenames that exist in the export app are
    accepted; unknown codenames cause a 400 error.
    """

    permission_classes = [IsAuthenticated]

    def put(self, request, pk: int):
        """Replace the target user's export permissions with the supplied list."""
        _require_role(request.user, _ADMIN_ONLY, 'manage user permissions')

        try:
            target_user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'error': f'User {pk} not found.'}, status=status.HTTP_404_NOT_FOUND)

        raw_codenames = request.data.get('permissions', [])
        if not isinstance(raw_codenames, list):
            raise ValidationError({'permissions': 'Must be a list of permission codenames.'})

        # Fetch all valid export-app and core-app permissions in a single query.
        # core-app permissions cover ExportFirm and ImportFirm model permissions.
        export_ct = ContentType.objects.filter(app_label__in=['export', 'core'])
        valid_perms = {
            p.codename: p
            for p in Permission.objects.filter(content_type__in=export_ct)
        }

        # Validate every supplied codename before making any changes.
        unknown = [c for c in raw_codenames if c not in valid_perms]
        if unknown:
            raise ValidationError(
                {'permissions': f"Unknown permission codenames: {unknown}"}
            )

        granted_perms = [valid_perms[c] for c in raw_codenames]

        # Clear existing export-app user permissions, then add the new set.
        current_export_perms = target_user.user_permissions.filter(content_type__in=export_ct)
        target_user.user_permissions.remove(*current_export_perms)
        if granted_perms:
            target_user.user_permissions.add(*granted_perms)

        return Response({'permissions': list(raw_codenames)})


# ---------------------------------------------------------------------------
# Delegated page-visibility management (ADR-022)
# ---------------------------------------------------------------------------

class ManagedPagePermissionsView(APIView):
    """Let a department head grant page visibility to the roles they manage.

    A bounded exception to AD-15: the admin permission-matrix CRUD stays
    admin-only, but a delegated manager (e.g. loading_dept_head) may toggle page
    visibility for the roles in their manageable set — limited to the pages the
    manager's OWN role can already see, and never an ``admin.*`` page (that would
    leak user/permission administration to subordinates).

    GET /api/v1/export/admin/managed-page-permissions/
        → { roles: [code...], pages: [{code,label}...], matrix: {role: {page: bool}} }
    PUT /api/v1/export/admin/managed-page-permissions/
        body: { matrix: {role: {page_code: bool}} }

    The PUT is a SURGICAL upsert: only the exact (managed_role, grantable_page)
    pairs in the payload are written via update_or_create. Rows for other roles,
    or for pages outside the grantable set (including ones the admin granted),
    are never touched or deleted. Out-of-bounds roles/pages are rejected (403).
    """

    permission_classes = [IsAuthenticated]

    def _managed_roles(self, actor) -> list[str]:
        """Roles this manager may grant pages to (their set, minus self + admin)."""
        return sorted(manageable_roles(actor) - {getattr(actor, 'role', None), 'admin'})

    def _grantable_pages(self, actor) -> list[str]:
        """Page codes the manager may delegate: own visible, non-admin pages.

        Full admins may delegate any non-admin page. A delegated manager may
        delegate only the non-admin pages their own role can currently see.
        Order follows PAGE_REGISTRY for a stable UI.
        """
        if _is_full_admin(actor):
            return [c for c in PAGE_REGISTRY if not c.startswith('admin.')]
        visible = set(
            RolePagePermission.objects
            .filter(role=actor.role, is_visible=True)
            .values_list('page_code', flat=True)
        )
        return [c for c in PAGE_REGISTRY if c in visible and not c.startswith('admin.')]

    def get(self, request):
        actor = request.user
        if not can_manage_users(actor):
            raise PermissionDenied('You are not allowed to manage staff page access.')

        managed = self._managed_roles(actor)
        grantable = self._grantable_pages(actor)

        rows = RolePagePermission.objects.filter(
            role__in=managed, page_code__in=grantable,
        ).values('role', 'page_code', 'is_visible')
        matrix: dict[str, dict[str, bool]] = {role: {} for role in managed}
        for row in rows:
            matrix[row['role']][row['page_code']] = row['is_visible']

        return Response({
            'roles': managed,
            'pages': [{'code': c, 'label': PAGE_REGISTRY[c]} for c in grantable],
            'matrix': matrix,
        })

    def put(self, request):
        from django.db import transaction
        from apps.core.views_permissions import _invalidate_perm_cache

        actor = request.user
        if not can_manage_users(actor):
            raise PermissionDenied('You are not allowed to manage staff page access.')

        matrix = request.data.get('matrix', {})
        if not isinstance(matrix, dict):
            return Response({'error': 'matrix must be an object'}, status=status.HTTP_400_BAD_REQUEST)

        managed = set(self._managed_roles(actor))
        grantable = set(self._grantable_pages(actor))

        updates: list[tuple[str, str, bool]] = []
        for role, pages in matrix.items():
            if role not in managed:
                raise PermissionDenied(f"You are not allowed to manage role '{role}'.")
            if not isinstance(pages, dict):
                continue
            for page_code, is_visible in pages.items():
                if page_code not in grantable:
                    raise PermissionDenied(f"Page '{page_code}' is not yours to grant.")
                updates.append((role, page_code, bool(is_visible)))

        with transaction.atomic():
            for role, page_code, is_visible in updates:
                RolePagePermission.objects.update_or_create(
                    role=role,
                    page_code=page_code,
                    defaults={'is_visible': is_visible},
                )

        _invalidate_perm_cache()
        return Response({'status': 'ok', 'count': len(updates)})
