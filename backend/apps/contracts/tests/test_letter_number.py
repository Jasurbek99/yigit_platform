"""Request-letter numbers per export firm × letter type × year (spec 2026-10-05)."""
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.contracts.models import Contract, ContractSale, LetterNumberBase
from apps.contracts.services.letter_number import (
    allocate_letter_number, ensure_letter_numbers, letter_year, number_taken,
)
from apps.contracts.services.shipment_firm_contracts import link_split_to_contract
from apps.contracts.tests.test_contract_sale_api import (
    _SeededPermsMixin, _make_contract, _make_export_firm, _make_import_firm, _make_invoice,
    _make_season, _make_user,
)
from apps.contracts.tests.test_document_generation import _make_packed_shipment


def _sale(contract, date, shipment=None, **numbers) -> ContractSale:
    sale = ContractSale.objects.create(
        contract=contract, invoice_date=date, total_usd=Decimal('100.00'),
        shipment=shipment, **numbers,
    )
    sale.refresh_from_db()  # a 'YYYY-MM-DD' date stays a str in memory otherwise
    return sale


class AllocateLetterNumberTest(TestCase):
    def setUp(self):
        self.season = _make_season()
        self.imp = _make_import_firm('IMPLTR')
        self.dm = _make_export_firm('DMLTR')
        self.ma = _make_export_firm('MALTR')
        self.c_dm = _make_contract('LTR-DM', self.dm, self.imp, self.season)
        self.c_ma = _make_contract('LTR-MA', self.ma, self.imp, self.season)

    def test_no_floor_starts_at_one(self):
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2026), 1)

    def test_starts_above_floor(self):
        LetterNumberBase.objects.create(export_firm=self.dm, letter_type='fito', year=2026, last_number=40)
        self.assertEqual(allocate_letter_number(self.dm.id, 'fito', 2026), 41)

    def test_types_count_separately(self):
        _sale(self.c_dm, '2026-10-01', ct1_number=1)
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2026), 2)
        self.assertEqual(allocate_letter_number(self.dm.id, 'customs', 2026), 1)

    def test_firms_count_separately(self):
        _sale(self.c_dm, '2026-10-01', fito_number=1)
        self.assertEqual(allocate_letter_number(self.ma.id, 'fito', 2026), 1)

    def test_new_year_restarts(self):
        _sale(self.c_dm, '2026-12-30', ct1_number=5)
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2027), 1)

    def test_reuses_freed_gap(self):
        _sale(self.c_dm, '2026-10-01', ct1_number=1)
        _sale(self.c_dm, '2026-10-02', ct1_number=3)
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2026), 2)

    def test_undated_sale_counts_by_truck_year(self):
        shipment = _make_packed_shipment(self.season, self.imp, code='0505002/25')  # 2025-10-01
        _sale(self.c_dm, None, shipment=shipment, ct1_number=1)
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2025), 2)

    def test_locks_floor_row(self):
        with mock.patch.object(
            LetterNumberBase.objects, 'select_for_update',
            wraps=LetterNumberBase.objects.select_for_update,
        ) as spy:
            allocate_letter_number(self.dm.id, 'ct1', 2026)
        spy.assert_called_once_with()

    def test_number_taken(self):
        sale = _sale(self.c_dm, '2026-10-01', ct1_number=4)
        other = _sale(self.c_dm, '2026-10-02')
        self.assertTrue(number_taken(other, 'ct1', 4))
        self.assertFalse(number_taken(sale, 'ct1', 4))   # its own number
        self.assertFalse(number_taken(other, 'fito', 4))


class EnsureLetterNumbersTest(TestCase):
    def setUp(self):
        self.season = _make_season()
        imp = _make_import_firm('IMPLTE')
        self.firm = _make_export_firm('LTEFIRM')
        self.contract = _make_contract('LTE-1', self.firm, imp, self.season)
        self.shipment = _make_packed_shipment(self.season, imp, code='0505001/25')
        self.shipment.refresh_from_db()

    def test_fills_all_three(self):
        sale = ensure_letter_numbers(_sale(self.contract, None, shipment=self.shipment))
        sale.refresh_from_db()
        self.assertEqual((sale.ct1_number, sale.fito_number, sale.customs_number), (1, 1, 1))

    def test_year_falls_back_to_truck_date(self):
        sale = _sale(self.contract, None, shipment=self.shipment)
        self.assertEqual(letter_year(sale), 2025)

    def test_keeps_existing_and_fills_missing(self):
        sale = ensure_letter_numbers(_sale(self.contract, '2026-01-05', ct1_number=9))
        sale.refresh_from_db()
        self.assertEqual((sale.ct1_number, sale.fito_number), (9, 1))

    def test_stale_instance_does_not_renumber(self):
        # Two requests load the same bare sale; the first numbers it and commits.
        sale = _sale(self.contract, '2026-01-05', shipment=self.shipment)
        stale = ContractSale.objects.get(pk=sale.pk)
        ensure_letter_numbers(ContractSale.objects.get(pk=sale.pk))
        ensure_letter_numbers(stale)
        sale.refresh_from_db()
        self.assertEqual((sale.ct1_number, stale.ct1_number), (1, 1))

    def test_undated_sale_without_truck_counts_by_creation_year(self):
        a = ensure_letter_numbers(_sale(self.contract, None))
        b = ensure_letter_numbers(_sale(self.contract, None))
        self.assertEqual(sorted([a.ct1_number, b.ct1_number]), [1, 2])

    def test_closed_season_left_alone(self):
        type(self.season).objects.filter(pk=self.season.pk).update(closed_at=timezone.now())
        sale = _sale(self.contract, None, shipment=self.shipment)
        ensure_letter_numbers(ContractSale.objects.get(pk=sale.pk))
        sale.refresh_from_db()
        self.assertIsNone(sale.ct1_number)


class LetterNumberWiringTest(_SeededPermsMixin, TestCase):
    """Numbers are given at «Привязать», manual sale create and letter download."""

    def setUp(self):
        from rest_framework.test import APIClient

        from apps.contracts.tests.test_shipment_firm_contracts import _SHARE_A, _apply_packing
        from apps.export.models import ShipmentFirmSplit

        self.client = APIClient()
        self.user = _make_user('ltr_wire', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.imp = _make_import_firm('IMPWIRE')
        self.firm = _make_export_firm('WIREF')
        self.contract = _make_contract('WIRE-C1', self.firm, self.imp, self.season)
        self.contract.contract_type = Contract.TYPE_FRAMEWORK
        self.contract.save(update_fields=['contract_type'])
        self.shipment = _make_packed_shipment(self.season, self.imp, code='0606001/25')
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.firm,
            weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
        )
        _apply_packing(self.shipment, _SHARE_A)
        self.sale = _make_invoice(self.contract, invoice_number=1)
        self.sale.shipment = self.shipment
        self.sale.export_firm = self.firm
        self.sale.save(update_fields=['shipment', 'export_firm'])

    def _link(self):
        sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.firm.id,
            mode='framework', contract_id=self.contract.id, user=self.user,
        )
        sale.refresh_from_db()
        return sale

    def test_link_numbers_all_three(self):
        sale = self._link()
        self.assertEqual((sale.ct1_number, sale.fito_number, sale.customs_number), (1, 1, 1))

    def test_relink_keeps_numbers(self):
        self._link()
        ContractSale.objects.filter(pk=self.sale.pk).update(ct1_number=8)
        self.assertEqual(self._link().ct1_number, 8)

    def test_download_numbers_a_bare_sale(self):
        resp = self.client.get(f'/api/v1/contracts/sales/{self.sale.id}/document/', {'type': 'fito_ru'})
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.fito_number, 1)

    def test_download_keeps_numbers(self):
        ContractSale.objects.filter(pk=self.sale.pk).update(fito_number=12)
        self.client.get(f'/api/v1/contracts/sales/{self.sale.id}/document/', {'type': 'fito_ru'})
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.fito_number, 12)

    def test_invoice_download_does_not_number_letters(self):
        resp = self.client.get(f'/api/v1/contracts/sales/{self.sale.id}/document/',
                               {'type': 'invoice_ru', 'place_loading': 'Kaka'})
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.sale.refresh_from_db()
        self.assertIsNone(self.sale.ct1_number)

    def test_packet_zip_numbers_every_sale(self):
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.id}/packet.zip',
                               {'place_loading': 'Kaka'})
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.customs_number, 1)

    def test_manual_sale_create_numbers_letters(self):
        resp = self.client.post('/api/v1/contracts/sales/', {
            'contract': self.contract.pk, 'invoice_number': 2, 'invoice_date': '2025-10-01',
            'quantity_kg': '100.00', 'price_per_kg': '0.0870', 'status': 'sent',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        sale = ContractSale.objects.get(pk=resp.json()['id'])
        self.assertEqual(sale.ct1_number, 1)


class LetterNumberBaseApiTest(TestCase):
    URL = '/api/v1/contracts/letter-number-bases/'

    def setUp(self):
        from apps.core.models import User
        from rest_framework.test import APIClient

        self.firm = _make_export_firm('LBAPI')
        self.admin = User.objects.create(username='lb_admin', role='admin')
        self.manager = User.objects.create(username='lb_em', role='export_manager')
        self.client = APIClient()

    def _put(self, **body):
        return self.client.put(self.URL, {'export_firm': self.firm.id, 'year': 2026, **body}, format='json')

    def test_get_defaults_to_zero(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.get(self.URL, {'year': 2026})
        self.assertEqual(resp.status_code, 200, resp.content)
        row = next(r for r in resp.json()['rows'] if r['export_firm_code'] == 'LBAPI')
        self.assertEqual((row['ct1'], row['fito'], row['customs']), (0, 0, 0))

    def test_admin_put_one_type(self):
        self.client.force_authenticate(self.admin)
        resp = self._put(letter_type='fito', last_number=40)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual((resp.json()['fito'], resp.json()['ct1']), (40, 0))
        base = LetterNumberBase.objects.get(export_firm=self.firm, letter_type='fito', year=2026)
        self.assertEqual((base.last_number, base.updated_by_id), (40, self.admin.id))

    def test_bad_type_is_400(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self._put(letter_type='cmr', last_number=1).status_code, 400)

    def test_negative_is_400(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self._put(letter_type='ct1', last_number=-1).status_code, 400)

    def test_non_admin_put_is_403(self):
        self.client.force_authenticate(self.manager)
        self.assertEqual(self._put(letter_type='ct1', last_number=1).status_code, 403)


class LetterNumberEditApiTest(_SeededPermsMixin, TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from apps.export.models import ShipmentFirmSplit

        self.client = APIClient()
        self.client.force_authenticate(user=_make_user('ltr_edit', 'export_manager'))
        season = _make_season()
        imp = _make_import_firm('IMPEDIT')
        self.firm = _make_export_firm('EDITF')
        contract = _make_contract('EDIT-C1', self.firm, imp, season)
        self.shipment = _make_packed_shipment(season, imp, code='0808001/25')
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.firm,
            weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
        )
        self.a = _sale(contract, '2026-10-01', shipment=self.shipment, ct1_number=4)
        ContractSale.objects.filter(pk=self.a.pk).update(export_firm=self.firm)
        self.b = _sale(contract, '2026-10-02', ct1_number=5)
        self.c = _sale(contract, '2025-11-02', ct1_number=9)

    def _patch(self, sale, body):
        return self.client.patch(f'/api/v1/contracts/sales/{sale.id}/letter-numbers/', body, format='json')

    def test_free_number_saves(self):
        resp = self._patch(self.b, {'ct1_number': 20})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['ct1_number'], 20)
        self.b.refresh_from_db()
        self.assertEqual(self.b.ct1_number, 20)

    def test_taken_number_is_400(self):
        resp = self._patch(self.b, {'ct1_number': 4})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.json())

    def test_same_value_is_ok(self):
        self.assertEqual(self._patch(self.b, {'ct1_number': 5}).status_code, 200)

    def test_other_year_is_ok(self):
        self.assertEqual(self._patch(self.b, {'ct1_number': 9}).status_code, 200)

    def test_zero_is_400(self):
        self.assertEqual(self._patch(self.b, {'fito_number': 0}).status_code, 400)

    def test_empty_body_is_400(self):
        self.assertEqual(self._patch(self.b, {}).status_code, 400)

    def test_role_without_sale_edit_is_403(self):
        # boss holds sale edit by design (seed_permissions, 2026-08-05); block_manager does not.
        self.client.force_authenticate(user=_make_user('ltr_bm', 'block_manager'))
        self.assertEqual(self._patch(self.b, {'ct1_number': 30}).status_code, 403)

    def test_packet_lists_letter_numbers(self):
        resp = self.client.get('/api/v1/contracts/document-packets/', {'shipment': self.shipment.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        firm = resp.json()['results'][0]['firms'][0]
        self.assertEqual((firm['ct1_number'], firm['fito_number']), (4, None))
