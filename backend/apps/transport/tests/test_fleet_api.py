import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.core.models import RoleResourcePermission
from apps.transport.models import (
    DevicePosition, Driver, DriverDocument, TraccarDevice, Trailer, Truck, TruckHead,
    TruckHeadDocument,
)
from apps.transport.services.files import MAX_FILES_PER_RECORD

User = get_user_model()


class TruckHeadApiTests(TestCase):
    def setUp(self):
        # Fleet writes are gated on the `transport.fleet` page row (CanEditFleet,
        # 2026-09-03) and the matrix is fail-closed, so the seeded defaults have
        # to exist before any editor can POST. cache.clear() drops the 60 s
        # per-role page cache another test class may have warmed.
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op', password='x', role='sales_rep')
        truck = Truck.objects.create(plate='4378AHF', fleet_no='TR050')
        self.device = TraccarDevice.objects.create(traccar_id=67, name='4378AHF TR050', truck=truck, status='online')
        DevicePosition.objects.create(device=self.device, latitude='37.9', longitude='58.4')
        # `truck_model` is required on save as of 2026-09-10, so the rows the
        # PATCH tests below edit carry one — otherwise every one of them would
        # 400 on the new rule instead of exercising the device re-matching it
        # is actually about. The blank-row cases have their own tests.
        TruckHead.objects.create(
            id=13, plate_number='3269AHF', owner_type='company',
            truck_model='MAN TGX', traccar_device=self.device,
        )
        TruckHead.objects.create(id=14, plate_number='9999XYZ', owner_type='company', is_active=False)

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get('/api/v1/transport/truck-heads/').status_code, 401)

    def test_list_returns_active_with_has_gps_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/truck-heads/').json()
        plates = {r['plate_number'] for r in rows}
        self.assertIn('3269AHF', plates)
        self.assertNotIn('9999XYZ', plates)          # inactive omitted
        row = next(r for r in rows if r['plate_number'] == '3269AHF')
        self.assertTrue(row['has_gps'])
        # search
        rows2 = self.client.get('/api/v1/transport/truck-heads/?search=3269').json()
        self.assertEqual([r['plate_number'] for r in rows2], ['3269AHF'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '5555AHF'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_create_matches_device_by_plate_and_avoids_id_collision(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(
            '/api/v1/transport/truck-heads/',
            {'plate_number': '4378AHF', 'truck_model': 'MAN TGX'},
            format='json',
        )
        self.assertEqual(r.status_code, 201)
        th = TruckHead.objects.get(plate_number='4378AHF')
        self.assertEqual(th.traccar_device, self.device)   # matched by plate
        self.assertGreater(th.id, 14)                       # no collision with imported ids

    def test_deactivate_via_patch(self):
        self.client.force_authenticate(self.editor)
        r = self.client.patch('/api/v1/transport/truck-heads/13/', {'is_active': False}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(TruckHead.objects.get(id=13).is_active)

    def test_create_with_cyrillic_homoglyph_plate_does_not_match_device(self):
        self.client.force_authenticate(self.editor)
        # Distractor: a REAL Latin truck+device whose plate is what '4378АHF'
        # (Cyrillic 'А') would shrink to if normalize_plate() ran without the
        # Cyrillic guard first. Must NOT be matched.
        latin_truck = Truck.objects.create(plate='4378HF', fleet_no='TR077')
        collide_device = TraccarDevice.objects.create(
            traccar_id=402, name='4378HF TR077', truck=latin_truck, status='online',
        )
        r = self.client.post(
            '/api/v1/transport/truck-heads/',
            {'plate_number': '4378АHF', 'truck_model': 'MAN TGX'},
            format='json',
        )  # 'А' here is Cyrillic (U+0410), not Latin 'A'
        self.assertEqual(r.status_code, 201)
        th = TruckHead.objects.get(plate_number='4378АHF')
        self.assertIsNone(th.traccar_device)
        self.assertNotEqual(th.traccar_device, collide_device)

    def test_patch_plate_change_rematches_device(self):
        self.client.force_authenticate(self.editor)
        other_truck = Truck.objects.create(plate='7777ZZZ', fleet_no='TR777')
        other_device = TraccarDevice.objects.create(
            traccar_id=777, name='7777ZZZ TR777', truck=other_truck, status='online',
        )
        r = self.client.patch(
            '/api/v1/transport/truck-heads/13/', {'plate_number': '7777ZZZ'}, format='json',
        )
        self.assertEqual(r.status_code, 200)
        th = TruckHead.objects.get(id=13)
        self.assertEqual(th.traccar_device, other_device)

    def test_include_inactive_lists_inactive_rows(self):
        self.client.force_authenticate(self.viewer)
        # default: active only
        default = self.client.get('/api/v1/transport/truck-heads/').json()
        self.assertNotIn('9999XYZ', {r['plate_number'] for r in default})
        # include_inactive=true: inactive shown
        allrows = self.client.get('/api/v1/transport/truck-heads/?include_inactive=true').json()
        self.assertIn('9999XYZ', {r['plate_number'] for r in allrows})

    def test_patch_with_unchanged_plate_does_not_rematch_device(self):
        # Admin edit modal always sends plate_number, even when only editing
        # another field. Sending the SAME plate must not re-run the matcher
        # (and must not clear a working GPS link if the matcher would return
        # None today).
        self.client.force_authenticate(self.editor)
        with patch('apps.transport.serializers.device_for_plate') as mock_match:
            r = self.client.patch(
                '/api/v1/transport/truck-heads/13/',
                {'plate_number': '3269AHF', 'capacity': '20000.00'},
                format='json',
            )
        self.assertEqual(r.status_code, 200)
        mock_match.assert_not_called()
        th = TruckHead.objects.get(id=13)
        self.assertEqual(th.traccar_device, self.device)
        self.assertEqual(str(th.capacity), '20000.00')

    def test_patch_with_changed_plate_calls_device_for_plate_once(self):
        self.client.force_authenticate(self.editor)
        with patch('apps.transport.serializers.device_for_plate') as mock_match:
            mock_match.return_value = None
            r = self.client.patch(
                '/api/v1/transport/truck-heads/13/', {'plate_number': '7777ZZZ'}, format='json',
            )
        self.assertEqual(r.status_code, 200)
        mock_match.assert_called_once_with('7777ZZZ')
        # The changed plate is saved and the device is re-matched to whatever
        # device_for_plate returned — here None, so a stale link is cleared
        # (truck 13 started linked to self.device). Asserting the effect, not
        # just the call, guards against a regression that keeps the old device.
        th = TruckHead.objects.get(id=13)
        self.assertEqual(th.plate_number, '7777ZZZ')
        self.assertIsNone(th.traccar_device)


class TrailerApiTests(TestCase):
    def setUp(self):
        # Fleet writes are gated on the `transport.fleet` page row (CanEditFleet,
        # 2026-09-03) and the matrix is fail-closed, so the seeded defaults have
        # to exist before any editor can POST. cache.clear() drops the 60 s
        # per-role page cache another test class may have warmed.
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr2', password='x', role='director')
        self.viewer = User.objects.create_user(username='op2', password='x', role='sales_rep')
        Trailer.objects.create(id=1, plate_number='2602TAH', owner_type='company')
        Trailer.objects.create(id=2, plate_number='9000ZZZ', owner_type='company', is_active=False)

    def test_list_active_only_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/trailers/').json()
        plates = {r['plate_number'] for r in rows}
        self.assertIn('2602TAH', plates)
        self.assertNotIn('9000ZZZ', plates)
        rows2 = self.client.get('/api/v1/transport/trailers/?search=2602').json()
        self.assertEqual([r['plate_number'] for r in rows2], ['2602TAH'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.client.post('/api/v1/transport/trailers/', {'plate_number': '3TAH'}, format='json').status_code,
            403,
        )

    def test_editor_creates_and_deactivates(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/v1/transport/trailers/', {'plate_number': '5TAH'}, format='json')
        self.assertEqual(r.status_code, 201)
        tid = r.json()['id']
        d = self.client.patch(f'/api/v1/transport/trailers/{tid}/', {'is_active': False}, format='json')
        self.assertEqual(d.status_code, 200)
        self.assertFalse(Trailer.objects.get(id=tid).is_active)

    def test_include_inactive_lists_inactive_rows(self):
        self.client.force_authenticate(self.viewer)
        # default: active only
        default = self.client.get('/api/v1/transport/trailers/').json()
        self.assertNotIn('9000ZZZ', {r['plate_number'] for r in default})
        # include_inactive=true: inactive shown
        allrows = self.client.get('/api/v1/transport/trailers/?include_inactive=true').json()
        self.assertIn('9000ZZZ', {r['plate_number'] for r in allrows})


class DriverApiTests(TestCase):
    def setUp(self):
        # Fleet writes are gated on the `transport.fleet` page row (CanEditFleet,
        # 2026-09-03) and the matrix is fail-closed, so the seeded defaults have
        # to exist before any editor can POST. cache.clear() drops the 60 s
        # per-role page cache another test class may have warmed.
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr3', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op3', password='x', role='sales_rep')
        # ids mirror Z_TIRWEB's preserved-id space (real rows start at 5).
        Driver.objects.create(id=5, name='ABRAY ANNAKULYYEW', logo_ref='318',
                              driver_logo_code='195.02.A001')
        Driver.objects.create(id=6, name='ARSLAN BERDIYEW', is_active=False, logo_ref='334',
                              driver_logo_code='195.02.A002')

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get('/api/v1/transport/drivers/').status_code, 401)

    def test_list_active_only_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/drivers/').json()
        names = {r['name'] for r in rows}
        self.assertIn('ABRAY ANNAKULYYEW', names)
        self.assertNotIn('ARSLAN BERDIYEW', names)          # inactive omitted
        rows2 = self.client.get('/api/v1/transport/drivers/?search=ANNAKUL').json()
        self.assertEqual([r['name'] for r in rows2], ['ABRAY ANNAKULYYEW'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.client.post('/api/v1/transport/drivers/', {'name': 'NOBODY'}, format='json').status_code,
            403,
        )

    def test_editor_creates_with_phone_and_deactivates(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(
            '/api/v1/transport/drivers/',
            {
                'name': 'TEST SURUJI', 'phone': '+99365123456',
                # Required as of 2026-09-10 — see DriverAdminSerializer.validate.
                'passport_serial': 'I-AN 1112223', 'passport_issue_date': '2021-04-05',
            },
            format='json',
        )
        self.assertEqual(r.status_code, 201)
        did = r.json()['id']
        self.assertEqual(r.json()['phone'], '+99365123456')
        # Must land ABOVE the IDENTITY_INSERT'd import ids. If the identity
        # counter had not advanced, a new driver would get id 1-6 — exactly the
        # range `transport_responsible` option ids occupy, which Shipment.driver_id
        # is currently mis-bound to on the frontend.
        self.assertGreater(did, 6)
        d = self.client.patch(f'/api/v1/transport/drivers/{did}/', {'is_active': False}, format='json')
        self.assertEqual(d.status_code, 200)
        self.assertFalse(Driver.objects.get(id=did).is_active)

    def test_id_is_read_only(self):
        # Shipment.driver_id points into this id space with no FK to protect it,
        # so a client must not be able to move a row to another id.
        self.client.force_authenticate(self.editor)
        r = self.client.patch('/api/v1/transport/drivers/5/', {'id': 999}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Driver.objects.filter(id=5).exists())
        self.assertFalse(Driver.objects.filter(id=999).exists())

    def test_boss_may_write(self):
        # boss was 403'd here until SHIPMENT_EDITOR_ROLES was widened
        # (2026-08-20). The gate reads the matrix now (CanEditFleet on the
        # `fleet` resource), where boss holds create+edit — so this passes for
        # the opposite reason: the matrix IS consulted.
        boss = User.objects.create_user(username='patron', password='x', role='boss')
        self.client.force_authenticate(boss)
        r = self.client.post(
            '/api/v1/transport/drivers/',
            {'name': 'BOSS PICK', 'passport_serial': 'I-AN 4445556',
             'passport_issue_date': '2021-04-05'},
            format='json',
        )
        self.assertEqual(r.status_code, 201)
        p = self.client.patch(f"/api/v1/transport/drivers/{r.json()['id']}/",
                              {'is_active': False}, format='json')
        self.assertEqual(p.status_code, 200)

    def test_include_inactive_lists_inactive_rows(self):
        self.client.force_authenticate(self.viewer)
        default = self.client.get('/api/v1/transport/drivers/').json()
        self.assertNotIn('ARSLAN BERDIYEW', {r['name'] for r in default})
        allrows = self.client.get('/api/v1/transport/drivers/?include_inactive=true').json()
        self.assertIn('ARSLAN BERDIYEW', {r['name'] for r in allrows})

    def test_logo_identifiers_are_exposed_but_read_only(self):
        # Shown so an operator can tell apart two drivers who share a name
        # (ids 30/31 are both BATYROW BAYRAMMYRAT). Read-only because the import
        # refreshes them from Z_TIRWEB on every run — an edit here would be
        # silently reverted — and because the duplicate retirement keys on them.
        self.client.force_authenticate(self.editor)
        row = next(r for r in self.client.get('/api/v1/transport/drivers/').json() if r['id'] == 5)
        self.assertEqual(row['logo_ref'], '318')
        self.assertEqual(row['driver_logo_code'], '195.02.A001')

        r = self.client.patch('/api/v1/transport/drivers/5/',
                              {'logo_ref': 'HACKED', 'driver_logo_code': 'HACKED'}, format='json')
        self.assertEqual(r.status_code, 200)
        driver = Driver.objects.get(id=5)
        self.assertEqual(driver.logo_ref, '318')
        self.assertEqual(driver.driver_logo_code, '195.02.A001')


class FleetWriteGateIsTheMatrixTests(TestCase):
    """Fleet writes read the `fleet` RESOURCE from the permission matrix.

    Before 2026-09-03 the gate was the hardcoded SHIPMENT_EDITOR_ROLES set, so
    changing who may edit the fleet needed a deploy. These tests pin what
    replaced it: a Resources-tab row an admin can flip, in both directions.
    Page (`transport.fleet`) and resource (`fleet`) are a deliberate split —
    the page decides who sees the screen, the resource who may write — so the
    last test pins that seeing the page is not itself permission to edit.
    """

    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.head = TruckHead.objects.create(plate_number='7000AHF', owner_type='company')

    def test_revoking_the_resource_row_blocks_a_seeded_editor(self):
        RoleResourcePermission.objects.filter(
            role='warehouse_chief', resource_code='fleet',
        ).update(can_create=False, can_edit=False)
        cache.clear()
        self.client.force_authenticate(
            User.objects.create_user(username='wc', password='x', role='warehouse_chief')
        )
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '7777AHF'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_granting_the_resource_row_admits_a_role_that_had_no_fleet_access(self):
        RoleResourcePermission.objects.update_or_create(
            role='transport', resource_code='fleet',
            defaults={'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': False},
        )
        cache.clear()
        self.client.force_authenticate(
            User.objects.create_user(username='tr', password='x', role='transport')
        )
        r = self.client.post(
            '/api/v1/transport/truck-heads/',
            {'plate_number': '7778AHF', 'truck_model': 'MAN TGX'},
            format='json',
        )
        self.assertEqual(r.status_code, 201)
        p = self.client.patch(f"/api/v1/transport/truck-heads/{r.json()['id']}/",
                              {'is_active': False}, format='json')
        self.assertEqual(p.status_code, 200)

    def test_create_and_edit_are_separate_checkboxes(self):
        """`can_create` off but `can_edit` on: POST refused, PATCH allowed."""
        RoleResourcePermission.objects.filter(
            role='warehouse_chief', resource_code='fleet',
        ).update(can_create=False, can_edit=True)
        cache.clear()
        self.client.force_authenticate(
            User.objects.create_user(username='wc2', password='x', role='warehouse_chief')
        )
        post = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '7779AHF'}, format='json')
        self.assertEqual(post.status_code, 403)
        patch = self.client.patch(f'/api/v1/transport/truck-heads/{self.head.id}/',
                                  {'is_active': False}, format='json')
        self.assertEqual(patch.status_code, 200)

    def test_seeing_the_page_is_not_permission_to_write(self):
        """Page and resource are separate authorities: `transport.fleet` visible,
        `fleet` resource absent → the screen loads, the save 403s."""
        RoleResourcePermission.objects.filter(
            role='warehouse_chief', resource_code='fleet',
        ).delete()
        cache.clear()
        self.client.force_authenticate(
            User.objects.create_user(username='wc3', password='x', role='warehouse_chief')
        )
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '7780AHF'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_reads_stay_open_to_a_role_without_the_resource(self):
        """The Sheet's truck / driver selectors list the catalog for everyone."""
        self.client.force_authenticate(
            User.objects.create_user(username='sr', password='x', role='sales_rep')
        )
        self.assertEqual(self.client.get('/api/v1/transport/truck-heads/').status_code, 200)


class TruckModelFieldTests(TestCase):
    """`truck_model` — free-text make and model on the tractor."""

    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr9', password='x', role='export_manager')
        TruckHead.objects.create(id=21, plate_number='1111AAA', truck_model='MAN TGX')

    def test_list_exposes_truck_model(self):
        self.client.force_authenticate(self.editor)
        rows = self.client.get('/api/v1/transport/truck-heads/').json()
        row = next(r for r in rows if r['plate_number'] == '1111AAA')
        self.assertEqual(row['truck_model'], 'MAN TGX')

    def test_editor_writes_truck_model(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(
            '/api/v1/transport/truck-heads/',
            {'plate_number': '2222BBB', 'truck_model': 'DAF XF 480'},
            format='json',
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(TruckHead.objects.get(plate_number='2222BBB').truck_model, 'DAF XF 480')

    def test_truck_model_is_required_on_create(self):
        """Owner request 2026-09-10 — a truck may not be registered model-less.

        Enforced in the serializer rather than on the model because the TIR
        import writes these same rows and carries no model column; all 92
        imported heads start blank and are filled in as they are edited.
        """
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '3333CCC'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('truck_model', r.json())
        self.assertFalse(TruckHead.objects.filter(plate_number='3333CCC').exists())

    def test_blank_model_cannot_be_left_blank_by_a_patch_that_omits_it(self):
        """The effective value is what counts, not the payload.

        An imported head has no model. A PATCH that changes something else must
        not sail through just because it never mentions `truck_model`.
        """
        head = TruckHead.objects.create(plate_number='4444DDD', truck_model='')
        self.client.force_authenticate(self.editor)
        r = self.client.patch(
            f'/api/v1/transport/truck-heads/{head.id}/', {'owner_name': 'X'}, format='json',
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn('truck_model', r.json())

    def test_deactivating_a_blank_row_still_works(self):
        """`is_active`-only is the one exempt payload.

        Deactivation is how a wrongly-imported head is retired, and that row is
        exactly the one nobody will ever supply a model for. A required field
        must not make a row impossible to switch off.
        """
        head = TruckHead.objects.create(plate_number='5555EEE', truck_model='')
        self.client.force_authenticate(self.editor)
        r = self.client.patch(
            f'/api/v1/transport/truck-heads/{head.id}/', {'is_active': False}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        head.refresh_from_db()
        self.assertFalse(head.is_active)


class DriverPassportTests(TestCase):
    """Passport serial + issue date: written by fleet editors, hidden from everyone else."""

    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr7', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op7', password='x', role='sales_rep')
        self.driver = Driver.objects.create(id=41, name='MERET SAPAROW')

    def test_editor_writes_and_reads_passport_fields(self):
        self.client.force_authenticate(self.editor)
        r = self.client.patch(
            f'/api/v1/transport/drivers/{self.driver.id}/',
            {'passport_serial': 'I-AN 1234567', 'passport_issue_date': '2021-04-15'},
            format='json',
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['passport_serial'], 'I-AN 1234567')
        self.assertEqual(r.json()['passport_issue_date'], '2021-04-15')
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.passport_serial, 'I-AN 1234567')

    def test_non_editor_never_sees_passport_fields(self):
        """The Sheet's driver picker reads this same route — passport identity
        must not ride along to every authenticated user."""
        self.driver.passport_serial = 'I-AN 7654321'
        self.driver.save()
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/drivers/').json()
        row = next(r for r in rows if r['id'] == self.driver.id)
        self.assertNotIn('passport_serial', row)
        self.assertNotIn('passport_issue_date', row)

    def test_passport_fields_are_required_on_create(self):
        """Owner request 2026-09-10 — a driver may not exist without a passport.

        This is also what closed the picker's inline "+ Add driver": it POSTed a
        name alone, so it would now 400 on every use. Drivers are created in
        Fleet Management, which collects both fields and the scan.
        """
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/v1/transport/drivers/', {'name': 'NO PASSPORT YET'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('passport_serial', r.json())
        self.assertIn('passport_issue_date', r.json())
        self.assertFalse(Driver.objects.filter(name='NO PASSPORT YET').exists())

    def test_half_a_passport_is_still_a_400(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(
            '/api/v1/transport/drivers/',
            {'name': 'SERIAL ONLY', 'passport_serial': 'I-AN 1234567'},
            format='json',
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn('passport_issue_date', r.json())
        self.assertNotIn('passport_serial', r.json())

    def test_blank_passport_cannot_be_left_blank_by_a_patch_that_omits_it(self):
        """All 153 imported drivers start blank; a PATCH must fill them, not skip."""
        self.client.force_authenticate(self.editor)
        r = self.client.patch(
            f'/api/v1/transport/drivers/{self.driver.id}/', {'phone': '+99365000000'},
            format='json',
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn('passport_serial', r.json())

    def test_deactivating_a_blank_driver_still_works(self):
        """`is_active`-only is exempt — deactivation is how a duplicate driver is
        retired (a delete would come back on the next TIR import), and the
        duplicate is precisely the row nobody will fill in."""
        self.client.force_authenticate(self.editor)
        r = self.client.patch(
            f'/api/v1/transport/drivers/{self.driver.id}/', {'is_active': False},
            format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.driver.refresh_from_db()
        self.assertFalse(self.driver.is_active)

    def test_search_matches_passport_serial_for_an_editor(self):
        self.driver.passport_serial = 'I-AN 9090909'
        self.driver.save()
        self.client.force_authenticate(self.editor)
        rows = self.client.get('/api/v1/transport/drivers/?search=9090909').json()
        self.assertEqual([r['id'] for r in rows], [self.driver.id])

    def test_search_is_not_a_passport_oracle_for_everyone_else(self):
        """Hiding the field on the serializer is not enough on its own: a
        searchable passport serial hands back the matching driver's NAME, which
        is the very thing the split serializer exists to withhold."""
        self.driver.passport_serial = 'I-AN 9090909'
        self.driver.save()
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/drivers/?search=9090909').json()
        self.assertEqual(rows, [])
        # The same viewer still searches name and phone normally.
        by_name = self.client.get('/api/v1/transport/drivers/?search=MERET').json()
        self.assertEqual([r['id'] for r in by_name], [self.driver.id])


def _jpg(name='passport.jpg', size=64):
    """A minimal file whose magic bytes really are JPEG."""
    return SimpleUploadedFile(name, b'\xff\xd8\xff' + b'\x00' * size, content_type='image/jpeg')


def _pdf(name='passport.pdf', size=64):
    return SimpleUploadedFile(name, b'%PDF-1.4' + b'\x00' * size, content_type='application/pdf')


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class DriverDocumentTests(TestCase):
    """Passport scans — upload, list, download, delete."""

    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr8', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op8', password='x', role='sales_rep')
        self.driver = Driver.objects.create(id=51, name='GURBAN ORAZOW')
        self.url = f'/api/v1/transport/drivers/{self.driver.id}/documents/'

    def test_upload_accepts_several_files_in_one_request(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(self.url, {'files': [_jpg('front.jpg'), _pdf('scan.pdf')]}, format='multipart')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(r.json()), 2)
        self.assertEqual(self.driver.documents.count(), 2)
        self.assertEqual(
            {d.mime_type for d in self.driver.documents.all()},
            {'image/jpeg', 'application/pdf'},
        )

    def test_upload_rejects_other_file_types(self):
        self.client.force_authenticate(self.editor)
        bad = SimpleUploadedFile('passport.png', b'\x89PNG\r\n\x1a\n', content_type='image/png')
        r = self.client.post(self.url, {'files': [bad]}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.driver.documents.count(), 0)

    def test_upload_rejects_a_renamed_file(self):
        """Extension says .jpg, bytes say PNG — the magic-byte check catches it."""
        self.client.force_authenticate(self.editor)
        liar = SimpleUploadedFile('passport.jpg', b'\x89PNG\r\n\x1a\n', content_type='image/jpeg')
        r = self.client.post(self.url, {'files': [liar]}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.driver.documents.count(), 0)

    def test_one_bad_file_rejects_the_whole_batch(self):
        """Validation runs before any DB write — a half-accepted upload would
        leave the operator guessing which passport page landed."""
        self.client.force_authenticate(self.editor)
        bad = SimpleUploadedFile('back.gif', b'GIF89a', content_type='image/gif')
        r = self.client.post(self.url, {'files': [_jpg('front.jpg'), bad]}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.driver.documents.count(), 0)

    def test_upload_enforces_the_per_driver_cap(self):
        self.client.force_authenticate(self.editor)
        for i in range(MAX_FILES_PER_RECORD):
            self.client.post(self.url, {'files': [_jpg(f'p{i}.jpg')]}, format='multipart')
        r = self.client.post(self.url, {'files': [_jpg('one-too-many.jpg')]}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.driver.documents.count(), MAX_FILES_PER_RECORD)

    def test_upload_rejects_an_empty_request(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(r.status_code, 400)

    def test_non_editor_cannot_list_upload_or_download(self):
        """Reads are closed here, unlike the rest of the fleet catalog."""
        doc = DriverDocument.objects.create(
            driver=self.driver, file='driver_passports/x.jpg', original_filename='x.jpg',
            mime_type='image/jpeg', size_bytes=10, uploaded_by=self.editor,
        )
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(
            self.client.post(self.url, {'files': [_jpg()]}, format='multipart').status_code, 403,
        )
        self.assertEqual(self.client.get(f'{self.url}{doc.id}/download/').status_code, 403)
        self.assertEqual(self.client.delete(f'{self.url}{doc.id}/').status_code, 403)

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_list_returns_metadata_without_a_file_url(self):
        """No /media/ path is exposed: nginx serves that directory with no auth."""
        self.client.force_authenticate(self.editor)
        self.client.post(self.url, {'files': [_jpg('front.jpg')]}, format='multipart')
        rows = self.client.get(self.url).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['original_filename'], 'front.jpg')
        self.assertEqual(rows[0]['uploaded_by_name'], 'mgr8')
        self.assertNotIn('file', rows[0])

    def test_filename_is_stripped_of_path_components(self):
        self.client.force_authenticate(self.editor)
        self.client.post(
            self.url, {'files': [_jpg('../../etc/passwd.jpg')]}, format='multipart',
        )
        self.assertEqual(self.driver.documents.first().original_filename, 'passwd.jpg')

    def test_download_streams_the_file(self):
        self.client.force_authenticate(self.editor)
        doc_id = self.client.post(
            self.url, {'files': [_pdf('scan.pdf')]}, format='multipart',
        ).json()[0]['id']
        r = self.client.get(f'{self.url}{doc_id}/download/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'application/pdf')
        self.assertTrue(b''.join(r.streaming_content).startswith(b'%PDF-'))

    def test_delete_removes_the_row(self):
        self.client.force_authenticate(self.editor)
        doc_id = self.client.post(
            self.url, {'files': [_jpg('front.jpg')]}, format='multipart',
        ).json()[0]['id']
        self.assertEqual(self.client.delete(f'{self.url}{doc_id}/').status_code, 204)
        self.assertEqual(self.driver.documents.count(), 0)

    def test_another_drivers_document_is_not_reachable(self):
        other = Driver.objects.create(id=52, name='OTHER DRIVER')
        doc = DriverDocument.objects.create(
            driver=other, file='driver_passports/y.jpg', original_filename='y.jpg',
            mime_type='image/jpeg', size_bytes=10, uploaded_by=self.editor,
        )
        self.client.force_authenticate(self.editor)
        self.assertEqual(self.client.get(f'{self.url}{doc.id}/download/').status_code, 404)
        self.assertEqual(self.client.delete(f'{self.url}{doc.id}/').status_code, 404)

    def test_document_count_rides_on_the_driver_row(self):
        self.client.force_authenticate(self.editor)
        self.client.post(self.url, {'files': [_jpg('front.jpg')]}, format='multipart')
        rows = self.client.get('/api/v1/transport/drivers/').json()
        row = next(r for r in rows if r['id'] == self.driver.id)
        self.assertEqual(row['document_count'], 1)
@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class TruckHeadDocumentTests(TestCase):
    """Tech passport (тех паспорт) scans on a tractor — upload, list, download, delete."""

    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr11', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op11', password='x', role='sales_rep')
        self.truck = TruckHead.objects.create(id=61, plate_number='6161AAA', truck_model='MAN TGX')
        self.url = f'/api/v1/transport/truck-heads/{self.truck.id}/documents/'

    def test_upload_accepts_several_files_in_one_request(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(self.url, {'files': [_jpg('front.jpg'), _pdf('scan.pdf')]}, format='multipart')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(r.json()), 2)
        self.assertEqual(self.truck.documents.count(), 2)
        self.assertEqual(
            {d.mime_type for d in self.truck.documents.all()},
            {'image/jpeg', 'application/pdf'},
        )

    def test_upload_rejects_other_file_types(self):
        self.client.force_authenticate(self.editor)
        bad = SimpleUploadedFile('tehpasport.png', b'\x89PNG\r\n\x1a\n', content_type='image/png')
        r = self.client.post(self.url, {'files': [bad]}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.truck.documents.count(), 0)

    def test_one_bad_file_rejects_the_whole_batch(self):
        self.client.force_authenticate(self.editor)
        bad = SimpleUploadedFile('back.gif', b'GIF89a', content_type='image/gif')
        r = self.client.post(self.url, {'files': [_jpg('front.jpg'), bad]}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.truck.documents.count(), 0)

    def test_upload_enforces_the_per_truck_cap(self):
        self.client.force_authenticate(self.editor)
        for i in range(MAX_FILES_PER_RECORD):
            self.client.post(self.url, {'files': [_jpg(f'p{i}.jpg')]}, format='multipart')
        r = self.client.post(self.url, {'files': [_jpg('one-too-many.jpg')]}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.truck.documents.count(), MAX_FILES_PER_RECORD)

    def test_upload_rejects_an_empty_request(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(r.status_code, 400)

    def test_non_editor_cannot_list_upload_download_or_delete(self):
        """Reads are closed here, unlike the rest of the truck catalog."""
        doc = TruckHeadDocument.objects.create(
            truck_head=self.truck, file='truck_documents/x.jpg', original_filename='x.jpg',
            mime_type='image/jpeg', size_bytes=10, uploaded_by=self.editor,
        )
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(
            self.client.post(self.url, {'files': [_jpg()]}, format='multipart').status_code, 403,
        )
        self.assertEqual(self.client.get(f'{self.url}{doc.id}/download/').status_code, 403)
        self.assertEqual(self.client.delete(f'{self.url}{doc.id}/').status_code, 403)

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_list_returns_metadata_without_a_file_url(self):
        """No /media/ path is exposed: nginx serves that directory with no auth."""
        self.client.force_authenticate(self.editor)
        self.client.post(self.url, {'files': [_jpg('front.jpg')]}, format='multipart')
        rows = self.client.get(self.url).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['original_filename'], 'front.jpg')
        self.assertEqual(rows[0]['uploaded_by_name'], 'mgr11')
        self.assertNotIn('file', rows[0])

    def test_filename_is_stripped_of_path_components(self):
        self.client.force_authenticate(self.editor)
        self.client.post(self.url, {'files': [_jpg('../../etc/passwd.jpg')]}, format='multipart')
        self.assertEqual(self.truck.documents.first().original_filename, 'passwd.jpg')

    def test_download_streams_the_file(self):
        self.client.force_authenticate(self.editor)
        doc_id = self.client.post(
            self.url, {'files': [_pdf('tehpasport.pdf')]}, format='multipart',
        ).json()[0]['id']
        r = self.client.get(f'{self.url}{doc_id}/download/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'application/pdf')
        self.assertTrue(b''.join(r.streaming_content).startswith(b'%PDF-'))

    def test_delete_removes_the_row(self):
        self.client.force_authenticate(self.editor)
        doc_id = self.client.post(
            self.url, {'files': [_jpg('front.jpg')]}, format='multipart',
        ).json()[0]['id']
        self.assertEqual(self.client.delete(f'{self.url}{doc_id}/').status_code, 204)
        self.assertEqual(self.truck.documents.count(), 0)

    def test_another_trucks_document_is_not_reachable(self):
        other = TruckHead.objects.create(id=62, plate_number='6262BBB', truck_model='DAF XF')
        doc = TruckHeadDocument.objects.create(
            truck_head=other, file='truck_documents/y.jpg', original_filename='y.jpg',
            mime_type='image/jpeg', size_bytes=10, uploaded_by=self.editor,
        )
        self.client.force_authenticate(self.editor)
        self.assertEqual(self.client.get(f'{self.url}{doc.id}/download/').status_code, 404)
        self.assertEqual(self.client.delete(f'{self.url}{doc.id}/').status_code, 404)

    def test_document_count_rides_on_the_truck_row(self):
        self.client.force_authenticate(self.editor)
        self.client.post(self.url, {'files': [_jpg('front.jpg')]}, format='multipart')
        rows = self.client.get('/api/v1/transport/truck-heads/').json()
        row = next(r for r in rows if r['id'] == self.truck.id)
        self.assertEqual(row['document_count'], 1)

    def test_document_count_is_visible_to_a_non_editor_but_the_scans_are_not(self):
        """A count is not sensitive, so it stays on the shared picker serializer —
        unlike the driver's passport scalars, which need their own class."""
        self.client.force_authenticate(self.editor)
        self.client.post(self.url, {'files': [_jpg('front.jpg')]}, format='multipart')
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/truck-heads/').json()
        row = next(r for r in rows if r['id'] == self.truck.id)
        self.assertEqual(row['document_count'], 1)
        self.assertEqual(self.client.get(self.url).status_code, 403)


class MissingDetailsTests(TestCase):
    """`missing_details` tells the Sheet what a fleet row still needs.

    It ships the *status* of a driver's passport, never its values, so the
    warning marker can be shown to every role while `DriverSerializer` keeps
    withholding the passport itself from anyone who cannot edit the fleet.
    """

    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr9', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op9', password='x', role='sales_rep')

    def _scan(self, driver):
        DriverDocument.objects.create(
            driver=driver, file=SimpleUploadedFile('p.jpg', b'x'),
            original_filename='p.jpg', mime_type='image/jpeg', size_bytes=1,
            uploaded_by=self.editor,
        )

    def _drivers(self, user):
        self.client.force_authenticate(user)
        return {r['id']: r for r in self.client.get('/api/v1/transport/drivers/').json()}

    def _heads(self, user):
        self.client.force_authenticate(user)
        return {r['id']: r for r in self.client.get('/api/v1/transport/truck-heads/').json()}

    def test_complete_driver_reports_nothing_missing(self):
        d = Driver.objects.create(id=5, name='TOLY', passport_serial='I-AŞ 1234',
                                  passport_issue_date='2020-01-01')
        self._scan(d)
        self.assertEqual(self._drivers(self.viewer)[5]['missing_details'], [])

    def test_driver_reports_each_missing_piece(self):
        Driver.objects.create(id=6, name='HIC ZAT')
        row = self._drivers(self.viewer)[6]
        self.assertEqual(
            sorted(row['missing_details']),
            ['passport_issue_date', 'passport_scan', 'passport_serial'],
        )

    def test_driver_missing_only_the_scan(self):
        Driver.objects.create(id=7, name='SKAN YOK', passport_serial='I-AŞ 9',
                              passport_issue_date='2021-05-05')
        self.assertEqual(self._drivers(self.viewer)[7]['missing_details'], ['passport_scan'])

    def test_status_reaches_a_role_that_may_not_read_the_passport(self):
        """The whole point: the marker is visible where the passport is not."""
        Driver.objects.create(id=8, name='GIZLIN')
        row = self._drivers(self.viewer)[8]
        self.assertIn('passport_serial', row['missing_details'])
        self.assertNotIn('passport_serial', row)
        self.assertNotIn('passport_issue_date', row)

    def test_fleet_editor_gets_the_same_field_alongside_the_passport(self):
        Driver.objects.create(id=9, name='ADMIN GORER')
        row = self._drivers(self.editor)[9]
        self.assertIn('passport_serial', row.get('missing_details', []))
        self.assertIn('passport_serial', row)

    def test_truck_head_reports_model_and_tech_passport(self):
        TruckHead.objects.create(id=21, plate_number='1111AAA', owner_type='company')
        self.assertEqual(
            sorted(self._heads(self.viewer)[21]['missing_details']),
            ['tech_passport_scan', 'truck_model'],
        )

    def test_complete_truck_head_reports_nothing_missing(self):
        head = TruckHead.objects.create(id=22, plate_number='2222BBB',
                                        owner_type='company', truck_model='MAN TGX')
        TruckHeadDocument.objects.create(
            truck_head=head, file=SimpleUploadedFile('t.jpg', b'x'),
            original_filename='t.jpg', mime_type='image/jpeg', size_bytes=1,
            uploaded_by=self.editor,
        )
        self.assertEqual(self._heads(self.viewer)[22]['missing_details'], [])

    def test_blank_model_string_counts_as_missing(self):
        """`truck_model` defaults to '' rather than NULL — whitespace is not a model."""
        TruckHead.objects.create(id=23, plate_number='3333CCC', owner_type='company',
                                 truck_model='   ')
        self.assertIn('truck_model', self._heads(self.viewer)[23]['missing_details'])
