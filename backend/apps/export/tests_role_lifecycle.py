"""Full create -> edit -> 13-step lifecycle -> delete walk, one role per step.

Exercises the export process end to end. Create / edit / delete / cancel run
through the API so the DRF permission layer and the season write-freeze are in
the path. The lifecycle walk itself runs through `transition_to()` -- the
service layer is where the per-edge role gate lives, so calling it directly
keeps this suite about the graph rather than about DRF. That the ENDPOINT is
now reachable for the roles that own the edges is pinned separately by
TransitionEndpointReachabilityTests below (F12, fixed 2026-09-01).

Safe by construction: `config/settings.py` routes every test run to
`test_YIGIT_PLATFROM` on localhost, and the production DATABASES block carries
no TEST entry, so this can never touch `YIGIT_PLATFROM_NEW`.

The step->role map mirrors `TRANSITIONS` in `apps/export/services/shipment.py`,
which is the only authority. `ShipmentStatusType.required_role` and
`.step_order` disagree with it in three places and are deliberately not used
here -- see `docs/ROLE_PROCESS_TEST_PLAN.md` section 2.

Run:
    python manage.py test apps.export.tests_role_lifecycle --keepdb
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    Season,
    ShipmentStatusType,
    TomatoVariety,
    User,
)
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services import transition_to

# (target status, role that owns the edge into it). Straight from TRANSITIONS.
# `yola_chykdy` is document_team's, NOT transport's, despite what the DB's
# required_role column says -- that divergence is the point of pinning it here.
LIFECYCLE = [
    ('gumruk_girish',  'document_team'),
    ('gumruk_chykysh', 'document_team'),
    ('yuklenme',       'warehouse_chief'),
    ('yola_chykdy',    'document_team'),
    ('serhet_gechdi',  'transport'),
    ('dest_entry',     'sales_rep'),
    ('barysh_gumrugi', 'sales_rep'),
    ('bardy',          'sales_rep'),
    ('satylyar',       'sales_rep'),
    ('satyldy',        'sales_rep'),
    ('tamamlandy',     'finansist'),
]

# Roles that own no edge anywhere in the graph and hold no privilege bypass.
NO_EDGE_ROLES = ['weight_master', 'accountant', 'seller', 'greenhouse_manager']

# transition_to() lets these skip the per-edge role check entirely.
PRIVILEGED = ['export_manager', 'director', 'boss']

STATUSES = [
    ('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS'),
    ('gumruk_chykysh', 2, 'CUSTOMS'), ('yuklenme', 3, 'LOADING'),
    ('yola_chykdy', 4, 'TRANSIT'), ('serhet_gechdi', 5, 'BORDER'),
    ('dest_entry', 6, 'BORDER'), ('barysh_gumrugi', 7, 'BORDER'),
    ('transshipment', 8, 'SALES'), ('bardy', 9, 'SALES'),
    ('satylyar', 10, 'SALES'), ('satyldy', 11, 'SALES'),
    ('tamamlandy', 12, 'COMPLETE'), ('cancelled', 99, 'CANCELLED'),
]

ALL_ROLES = [
    'admin', 'export_manager', 'director', 'boss', 'document_team',
    'warehouse_chief', 'loading_dept_head', 'loading_dept_head_deputy',
    'weight_master', 'transport', 'sales_rep', 'finansist', 'accountant',
    'greenhouse_manager', 'seller',
]


class LifecycleBase(TestCase):
    """Shared fixtures. Real permission matrix, real status types."""

    @classmethod
    def setUpTestData(cls):
        # The production matrix, so a 403 here means the same thing it means in
        # production. Hand-written RoleResourcePermission rows would also need
        # their permission-cache entries kept in step -- see
        # tests_boss_transitions for what goes wrong when they are not.
        call_command('seed_permissions')
        for code, order, phase in STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase, 'is_active': True},
            )
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )
        cls.country = Country.objects.create(
            name_tk='KZ', name_en='KZ', name_ru='KZ', code='KZ',
        )
        cls.customer = Customer.objects.create(name='LifecycleCustomer')
        cls.block = GreenhouseBlock.objects.create(code='LC-1', name='Lifecycle block')
        cls.variety = TomatoVariety.objects.create(name='Pembe', code='PMB')
        cls.users = {
            role: User.objects.create_user(
                username='lc_' + role, password='pw', role=role,
            )
            for role in ALL_ROLES
        }
        # A superuser would bypass every gate below and make the suite vacuous.
        cls.users['admin'].is_superuser = False
        cls.users['admin'].save(update_fields=['is_superuser'])

    def client_as(self, role):
        c = APIClient()
        c.force_authenticate(user=self.users[role])
        return c

    def make_shipment(self, code, has_peregruz=False):
        """A draft carrying both halves of the two-row flow, ready to advance."""
        s = Shipment.objects.create(
            shipment_code=code,
            date='2025-11-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            country=self.country,
            customer=self.customer,
            has_peregruz=has_peregruz,
        )
        ShipmentBlockSource.objects.create(shipment=s, block=self.block, weight_kg=20000)
        return s

    def transition(self, role, shipment, target):
        """Fire a transition through the HTTP endpoint.

        Reachable by any role holding `shipment.can_edit`; which EDGE that role
        may then walk is decided by `transition_to()`. See
        TransitionEndpointReachabilityTests.
        """
        return self.client_as(role).post(
            '/api/v1/export/shipments/{}/transition/'.format(shipment.pk),
            {'new_status': target}, format='json',
        )

    def fire(self, role, shipment, target):
        """Fire a transition at the service layer, where the role gate lives.

        The lifecycle walk uses this rather than the endpoint so a failure here
        means "the graph is wrong", never "the DRF layer refused". Endpoint
        reachability is pinned separately.
        """
        transition_to(shipment, target, self.users[role])
        shipment.refresh_from_db()

    def advance_to(self, shipment, target):
        """Walk the shipment up to (and including) `target` using owning roles."""
        for code, role in LIFECYCLE:
            self.fire(role, shipment, code)
            if code == target:
                return


class FullLifecycleWalkTests(LifecycleBase):
    """The happy path: every step fired by the role that owns it."""

    def test_walks_all_eleven_steps_each_by_its_owning_role(self):
        s = self.make_shipment('LC-WALK-1')
        for target, role in LIFECYCLE:
            self.fire(role, s, target)
            self.assertEqual(s.status.code, target)
        self.assertEqual(s.status.code, 'tamamlandy')

    def test_every_step_wrote_a_status_log_row(self):
        s = self.make_shipment('LC-WALK-2')
        self.advance_to(s, 'tamamlandy')
        self.assertEqual(s.status_log.count(), len(LIFECYCLE))

    def test_peregruz_branch_routes_through_transshipment(self):
        """has_peregruz=True takes barysh_gumrugi -> transshipment -> bardy."""
        s = self.make_shipment('LC-PEREGRUZ', has_peregruz=True)
        self.advance_to(s, 'barysh_gumrugi')
        self.fire('sales_rep', s, 'transshipment')
        self.fire('sales_rep', s, 'bardy')
        self.assertEqual(s.status.code, 'bardy')

    def test_manual_transition_ignores_the_peregruz_predicate(self):
        """The fork's predicates steer auto-advance only.

        A shipment with has_peregruz=False can still be sent to transshipment
        by hand. Pinned so a future change to manual routing is visible.
        """
        s = self.make_shipment('LC-NOPRG', has_peregruz=False)
        self.advance_to(s, 'barysh_gumrugi')
        self.fire('sales_rep', s, 'transshipment')
        self.assertEqual(s.status.code, 'transshipment')


class LifecycleRoleGateTests(LifecycleBase):
    """The gate refuses everyone who does not own the edge."""

    def test_each_step_refuses_a_role_that_does_not_own_it(self):
        for target, owner in LIFECYCLE:
            s = self.make_shipment('LC-GATE-' + target[:8])
            for prior_target, prior_role in LIFECYCLE:
                if prior_target == target:
                    break
                self.fire(prior_role, s, prior_target)

            intruder = 'weight_master' if owner != 'weight_master' else 'transport'
            with self.assertRaises(PermissionError) as ctx:
                self.fire(intruder, s, target)
            self.assertIn('cannot trigger transition', str(ctx.exception))

    def test_roles_owning_no_edge_cannot_start_the_process(self):
        for role in NO_EDGE_ROLES:
            s = self.make_shipment('LC-NOEDGE-' + role[:6])
            with self.assertRaises(PermissionError):
                self.fire(role, s, 'gumruk_girish')

    def test_privileged_roles_bypass_the_per_step_role_check(self):
        for role in PRIVILEGED:
            s = self.make_shipment('LC-PRIV-' + role[:6])
            self.fire(role, s, 'gumruk_girish')
            self.assertEqual(
                s.status.code, 'gumruk_girish',
                role + ' is in PRIVILEGED_ROLES and should bypass the edge check',
            )

    def test_privilege_bypasses_the_role_check_but_never_the_state_machine(self):
        s = self.make_shipment('LC-SKIP')
        with self.assertRaises(ValueError):
            self.fire('director', s, 'tamamlandy')

    def test_transition_endpoint_refuses_cancelled_and_points_at_cancel(self):
        s = self.make_shipment('LC-CANCELROUTE')
        resp = self.transition('director', s, 'cancelled')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('cancel', str(resp.data).lower())


class DraftGuardTests(LifecycleBase):
    """A half-built draft must be joined before it can advance."""

    def _bare_draft(self, code, country=None, customer=None, blocks=False):
        s = Shipment.objects.create(
            shipment_code=code, date='2025-11-01', season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            country=country, customer=customer,
        )
        if blocks:
            ShipmentBlockSource.objects.create(
                shipment=s, block=self.block, weight_kg=1000,
            )
        return s

    def test_supply_only_draft_cannot_advance(self):
        s = self._bare_draft('LC-SUPPLY', blocks=True)
        with self.assertRaises(ValueError) as ctx:
            self.fire('document_team', s, 'gumruk_girish')
        self.assertIn('country', str(ctx.exception))
        self.assertIn('customer', str(ctx.exception))

    def test_destination_only_draft_cannot_advance(self):
        s = self._bare_draft(
            'LC-DEST', country=self.country, customer=self.customer,
        )
        with self.assertRaises(ValueError) as ctx:
            self.fire('document_team', s, 'gumruk_girish')
        self.assertIn('block_sources', str(ctx.exception))

    def test_a_joined_draft_advances(self):
        s = self._bare_draft(
            'LC-JOINED', country=self.country, customer=self.customer, blocks=True,
        )
        self.fire('document_team', s, 'gumruk_girish')
        self.assertEqual(s.status.code, 'gumruk_girish')


class CreateEditDeleteTests(LifecycleBase):
    """Write, edit and every deletion path, per role."""

    def _payload(self, **over):
        base = {
            'is_draft': True,
            'skip_forecast_check': True,
            'weight_net': '20000.00',
            'block_ids': [self.block.pk],
            'varieties': [self.variety.pk],
            'harvest_status': 'ok',
        }
        base.update(over)
        return base

    def test_export_manager_can_create_a_draft(self):
        resp = self.client_as('export_manager').post(
            '/api/v1/export/shipments/', self._payload(), format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(Shipment.objects.filter(pk=resp.data['id']).exists())

    def test_a_role_without_shipment_create_is_refused(self):
        resp = self.client_as('seller').post(
            '/api/v1/export/shipments/', self._payload(), format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_export_manager_can_edit(self):
        s = self.make_shipment('LC-EDIT')
        resp = self.client_as('export_manager').patch(
            '/api/v1/export/shipments/{}/'.format(s.pk),
            {'notes': 'edited'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        s.refresh_from_db()
        self.assertEqual(s.notes, 'edited')

    def test_a_role_without_shipment_edit_is_refused(self):
        s = self.make_shipment('LC-EDIT-NO')
        resp = self.client_as('seller').patch(
            '/api/v1/export/shipments/{}/'.format(s.pk),
            {'notes': 'nope'}, format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_no_http_delete_verb_on_the_endpoint(self):
        """Deletion is only ever an explicit action, never DELETE."""
        s = self.make_shipment('LC-VERB')
        resp = self.client_as('admin').delete(
            '/api/v1/export/shipments/{}/'.format(s.pk),
        )
        self.assertEqual(resp.status_code, 405)

    def test_soft_delete_then_restore_round_trips(self):
        s = self.make_shipment('LC-SOFT')
        c = self.client_as('export_manager')
        self.assertEqual(
            c.post('/api/v1/export/shipments/{}/soft-delete/'.format(s.pk)).status_code,
            200,
        )
        s.refresh_from_db()
        self.assertIsNotNone(s.deleted_at)
        self.assertEqual(
            c.post('/api/v1/export/shipments/{}/restore/'.format(s.pk)).status_code,
            200,
        )
        s.refresh_from_db()
        self.assertIsNone(s.deleted_at)

    def test_soft_delete_is_open_to_every_authenticated_role(self):
        """Pins `_OPEN_ACTIONS` in ShipmentViewSet.get_permissions.

        soft-delete deliberately drops DynamicResourcePermission so Sheet
        viewers without shipment.can_delete can still bin a row. That means
        weight_master and seller can soft-delete too -- recorded so the breadth
        is a decision on the record rather than a surprise.
        """
        for role in ('weight_master', 'seller', 'transport'):
            s = self.make_shipment('LC-SOFT-' + role[:6])
            resp = self.client_as(role).post(
                '/api/v1/export/shipments/{}/soft-delete/'.format(s.pk),
            )
            self.assertEqual(
                resp.status_code, 200,
                '{}: {}'.format(role, getattr(resp, 'data', resp)),
            )

    def test_soft_delete_is_idempotent(self):
        s = self.make_shipment('LC-SOFT-TWICE')
        c = self.client_as('export_manager')
        c.post('/api/v1/export/shipments/{}/soft-delete/'.format(s.pk))
        s.refresh_from_db()
        first = s.deleted_at
        self.assertEqual(
            c.post('/api/v1/export/shipments/{}/soft-delete/'.format(s.pk)).status_code,
            200,
        )
        s.refresh_from_db()
        self.assertEqual(s.deleted_at, first)

    def test_admin_hard_deletes_a_draft(self):
        s = self.make_shipment('LC-HARD')
        resp = self.client_as('admin').post(
            '/api/v1/export/shipments/{}/hard-delete/'.format(s.pk),
        )
        self.assertIn(resp.status_code, (200, 204), getattr(resp, 'data', resp))
        self.assertFalse(Shipment.objects.filter(pk=s.pk).exists())
        self.assertFalse(ShipmentBlockSource.objects.filter(shipment_id=s.pk).exists())

    def test_hard_delete_is_refused_to_every_non_admin(self):
        for role in ('boss', 'director', 'export_manager', 'document_team', 'seller'):
            s = self.make_shipment('LC-HD-' + role[:6])
            resp = self.client_as(role).post(
                '/api/v1/export/shipments/{}/hard-delete/'.format(s.pk),
            )
            self.assertEqual(resp.status_code, 403, role + ' must not hard-delete')
            self.assertTrue(Shipment.objects.filter(pk=s.pk).exists())

    def test_hard_delete_is_refused_once_the_shipment_has_left_draft(self):
        s = self.make_shipment('LC-HD-LIVE')
        self.fire('document_team', s, 'gumruk_girish')
        self.assertEqual(s.status.code, 'gumruk_girish')
        resp = self.client_as('admin').post(
            '/api/v1/export/shipments/{}/hard-delete/'.format(s.pk),
        )
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(Shipment.objects.filter(pk=s.pk).exists())


class CancelTests(LifecycleBase):
    """Cancel is a lifecycle decision with its own gate and its own reason."""

    def test_cancel_requires_a_reason(self):
        s = self.make_shipment('LC-CANCEL-NOREASON')
        resp = self.client_as('export_manager').post(
            '/api/v1/export/shipments/{}/cancel/'.format(s.pk),
            {'reason': ''}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_privileged_roles_can_cancel(self):
        for role in ('export_manager', 'director'):
            s = self.make_shipment('LC-CANCEL-' + role[:6])
            resp = self.client_as(role).post(
                '/api/v1/export/shipments/{}/cancel/'.format(s.pk),
                {'reason': 'test'}, format='json',
            )
            self.assertEqual(
                resp.status_code, 200,
                '{}: {}'.format(role, getattr(resp, 'data', resp)),
            )
            s.refresh_from_db()
            self.assertEqual(s.status.code, 'cancelled')

    def test_boss_cannot_cancel(self):
        """/cancel/ gates on core.roles.PRIVILEGED_ROLES, which excludes boss.

        Note `apps/export/services/shipment.py` defines a DIFFERENT set under
        the same name that DOES include boss -- that one governs the per-edge
        bypass, not this endpoint. Pinned because the shadowed name is easy to
        read the wrong way round.
        """
        s = self.make_shipment('LC-CANCEL-BOSS')
        resp = self.client_as('boss').post(
            '/api/v1/export/shipments/{}/cancel/'.format(s.pk),
            {'reason': 'test'}, format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_operational_roles_cannot_cancel(self):
        for role in ('document_team', 'warehouse_chief', 'transport', 'sales_rep'):
            s = self.make_shipment('LC-CX-' + role[:6])
            resp = self.client_as(role).post(
                '/api/v1/export/shipments/{}/cancel/'.format(s.pk),
                {'reason': 'test'}, format='json',
            )
            self.assertEqual(resp.status_code, 403, role + ' must not cancel')


class TransitionEndpointReachabilityTests(LifecycleBase):
    """POST /transition/ admits `shipment.can_edit`; the EDGE gate stays in the service.

    Until 2026-09-01 this action inherited `DynamicResourcePermission`, which maps
    POST -> `shipment.can_create`. That flag is 0 for document_team, transport,
    sales_rep and finansist -- the roles owning 10 of the 11 lifecycle edges -- so
    DRF refused them before `transition_to()`'s per-edge gate ever ran, and only
    export_manager / director / boss could drive a step by hand
    (docs/ROLE_ACCESS_AUDIT.md F12). A transition EDITS a shipment, it does not
    create one, and the Detail hero already gated its button on
    `canDo(user, 'shipment', 'edit')` -- the frontend and backend simply disagreed
    on which flag.

    The point of this class is that the gate MOVED rather than vanished: reaching
    the endpoint is not permission to walk an edge. A role with `can_edit` but no
    edge (loading_dept_head -- see FINDINGS_BACKLOG P5) gets through DRF and is
    then refused by `transition_to()` with its own message.
    """

    #: (role, status to stand on, edge it owns) for the four edge-owning roles
    #: that hold NO `shipment.can_create` -- the ones F12 locked out.
    EDGE_OWNERS_WITHOUT_CREATE = [
        ('document_team', None,            'gumruk_girish'),
        ('transport',     'yola_chykdy',   'serhet_gechdi'),
        ('sales_rep',     'serhet_gechdi', 'dest_entry'),
        ('finansist',     'satyldy',       'tamamlandy'),
    ]

    #: Holds `shipment.can_edit`, owns no edge anywhere in TRANSITIONS.
    #: The loading department's real accounts -- FINDINGS_BACKLOG P5, untouched
    #: by this fix: they reach the endpoint and the graph still refuses them.
    EDIT_BUT_NO_EDGE = ['loading_dept_head', 'loading_dept_head_deputy']

    #: No `shipment.can_edit` at all -- refused by DRF, before the graph.
    NO_SHIPMENT_EDIT = ['weight_master', 'accountant']

    def test_edge_owning_roles_reach_the_endpoint_and_walk_their_edge(self):
        from apps.core.models import RoleResourcePermission

        for role, stand_on, target in self.EDGE_OWNERS_WITHOUT_CREATE:
            with self.subTest(role=role):
                # The premise: none of them can create a shipment. If this ever
                # flips, the test stops proving that can_edit is what admits them.
                perm = RoleResourcePermission.objects.get(
                    role=role, resource_code='shipment',
                )
                self.assertFalse(perm.can_create, role + ' unexpectedly has can_create')
                self.assertTrue(perm.can_edit, role + ' unexpectedly lacks can_edit')

                s = self.make_shipment('LC-RCH-' + role[:6])
                if stand_on is not None:
                    self.advance_to(s, stand_on)
                resp = self.transition(role, s, target)
                self.assertEqual(resp.status_code, 200, getattr(resp, 'data', resp))
                s.refresh_from_db()
                self.assertEqual(s.status.code, target)

    def test_a_role_with_edit_but_no_edge_is_refused_by_the_graph_not_by_drf(self):
        """The gate moved, it did not disappear.

        `transition_to()`'s message is the proof: the request reached the service
        layer and the per-edge role check is what turned it away.
        """
        for i, role in enumerate(self.EDIT_BUT_NO_EDGE):
            with self.subTest(role=role):
                # head and deputy share their first 8 characters — index the code.
                s = self.make_shipment('LC-NOEDGE-{}'.format(i))
                resp = self.transition(role, s, 'gumruk_girish')
                self.assertEqual(resp.status_code, 403, getattr(resp, 'data', resp))
                self.assertIn('cannot trigger transition', str(resp.data))

    def test_a_role_without_shipment_edit_never_reaches_the_graph(self):
        for role in self.NO_SHIPMENT_EDIT:
            with self.subTest(role=role):
                s = self.make_shipment('LC-NOEDIT-' + role[:6])
                resp = self.transition(role, s, 'gumruk_girish')
                self.assertEqual(resp.status_code, 403, getattr(resp, 'data', resp))
                # DRF's generic message, NOT transition_to's -- the request died
                # at the permission layer.
                self.assertNotIn('cannot trigger transition', str(resp.data))

    def test_privileged_roles_do_reach_the_endpoint(self):
        """They bypass the per-edge check inside transition_to()."""
        for role in PRIVILEGED:
            s = self.make_shipment('LC-REACH-OK-' + role[:6])
            resp = self.transition(role, s, 'gumruk_girish')
            self.assertEqual(resp.status_code, 200, getattr(resp, 'data', resp))

    def test_can_edit_is_what_decides_reachability(self):
        """Revoking can_edit alone closes the endpoint again.

        Isolates the cause: nothing about document_team changes except the one
        flag the permission class reads.
        """
        from django.core.cache import cache

        from apps.core.models import RoleResourcePermission
        from apps.core.permissions import PERM_CACHE_PREFIX, PERM_CACHE_TTL

        perm = RoleResourcePermission.objects.get(
            role='document_team', resource_code='shipment',
        )
        self.assertTrue(perm.can_edit)
        # get_resource_perm memoises per (role, resource) in a process-wide cache
        # with no per-test reset, so the entry must be written in step with the
        # row -- and restored afterwards, or later modules in the same run
        # inherit a crippled document_team. See tests_boss_transitions.
        key = '{}:resource:document_team:shipment'.format(PERM_CACHE_PREFIX)
        previous = cache.get(key)
        try:
            cache.set(key, {
                'can_view': perm.can_view, 'can_create': perm.can_create,
                'can_edit': False, 'can_delete': perm.can_delete,
            }, PERM_CACHE_TTL)
            s = self.make_shipment('LC-REACH-REVOKE')
            resp = self.transition('document_team', s, 'gumruk_girish')
            self.assertEqual(resp.status_code, 403, getattr(resp, 'data', resp))
            self.assertNotIn('cannot trigger transition', str(resp.data))
        finally:
            if previous is None:
                cache.delete(key)
            else:
                cache.set(key, previous, PERM_CACHE_TTL)
