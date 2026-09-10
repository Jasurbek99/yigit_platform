"""Slice 4a — shipment firm-split ↔ contract bridge (service + endpoint)."""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, ExportFirm, ImportFirm, Season, ShipmentStatusType, User
from apps.export.models import (
    PackingTemplate, PackingTemplateShare, Shipment, ShipmentFirmSplit,
)
from apps.contracts.models import Contract, ContractSale
from apps.contracts.services.shipment_firm_contracts import (
    framework_contracts_for_pair,
    link_split_to_contract,
    money_warning,
    parse_price_per_kg,
)


def _season() -> Season:
    s, _ = Season.objects.get_or_create(
        name='2025', defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
    )
    return s


def _draft_status() -> ShipmentStatusType:
    s, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={'name_tk': 'draft', 'name_en': 'Draft', 'name_ru': 'Draft', 'step_order': 0, 'phase': 'PREP'},
    )
    return s


def _efirm(code: str) -> ExportFirm:
    return ExportFirm.objects.create(code=code, name_tk=f'Export {code}')


def _ifirm(code: str) -> ImportFirm:
    return ImportFirm.objects.create(code=code, name_company=f'Import {code}')


def _shipment(import_firm, code='0101001/25') -> Shipment:
    return Shipment.objects.create(
        shipment_code=code,
        date=datetime.date(2025, 9, 22),
        season=_season(),
        status=_draft_status(),
        import_firm=import_firm,
    )


def _split(shipment, firm, weight='9000.00', amount='8000.00') -> ShipmentFirmSplit:
    return ShipmentFirmSplit.objects.create(
        shipment=shipment, export_firm=firm, weight_kg=weight, amount_usd=amount,
    )


class MoneyWarningTest(TestCase):
    def test_thresholds(self) -> None:
        self.assertEqual(money_warning('12000'), 'bank')
        self.assertEqual(money_warning('10000'), 'bank')
        self.assertEqual(money_warning('9999.99'), 'cash')
        self.assertIsNone(money_warning(None))


class LinkServiceTest(TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.ygt = _efirm('YGT')
        self.shipment = _shipment(self.buyer)
        self.split = _split(self.shipment, self.ygt)
        self.user = User.objects.create(username='shohrat', role='export_manager')
        # Linking is refused on a truck with no packing template, so every truck
        # under test carries one — a whole-truck load for the single firm here.
        _apply_packing(self.shipment, _SHARE_A)

    def test_one_time_creates_contract_and_bridge(self) -> None:
        sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='one_time', contract_id=None, user=self.user, price_per_kg='0.90',
        )
        self.assertEqual(sale.contract.contract_type, Contract.TYPE_ONE_TIME)
        self.assertEqual(sale.contract.export_firm_id, self.ygt.id)
        self.assertEqual(sale.contract.import_firm_id, self.buyer.id)
        self.assertEqual(sale.contract.passport_sdelka, '')
        self.assertTrue(sale.contract.contract_number)  # auto-numbered
        self.assertEqual(sale.shipment_id, self.shipment.id)
        self.assertEqual(sale.quantity_kg, Decimal('9000.00'))
        self.assertEqual(sale.total_usd, Decimal('8000.00'))
        self.assertIsNone(sale.invoice_number)  # filled later by a person

    def test_framework_link_reuses_existing(self) -> None:
        fw = Contract.objects.create(
            contract_number='177/25-YGT-EXP', seq=177, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        before = Contract.objects.count()
        sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='framework', contract_id=fw.id, user=self.user,
        )
        self.assertEqual(sale.contract_id, fw.id)
        self.assertEqual(Contract.objects.count(), before)  # no new contract

    def test_framework_options_only_active_pair(self) -> None:
        Contract.objects.create(
            contract_number='1/25-YGT-EXP', seq=1, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        # one_time + a different buyer must not appear
        other = _ifirm('B2')
        Contract.objects.create(
            contract_number='2/25-YGT-EXP', seq=2, contract_year=2025,
            contract_type=Contract.TYPE_ONE_TIME,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        Contract.objects.create(
            contract_number='3/25-YGT-EXP', seq=3, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=other, season=_season(),
        )
        opts = framework_contracts_for_pair(self.ygt.id, self.buyer.id)
        self.assertEqual([c.contract_number for c in opts], ['1/25-YGT-EXP'])

    def test_relink_framework_is_idempotent(self) -> None:
        fw = Contract.objects.create(
            contract_number='5/25-YGT-EXP', seq=5, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                               mode='framework', contract_id=fw.id, user=self.user)
        link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                               mode='framework', contract_id=fw.id, user=self.user)
        self.assertEqual(
            ContractSale.objects.filter(shipment=self.shipment, export_firm=self.ygt).count(), 1,
        )

    def test_no_buyer_raises(self) -> None:
        shipment = _shipment(None, code='0101002/25')
        _split(shipment, self.ygt)
        with self.assertRaises(ValueError):
            link_split_to_contract(shipment=shipment, export_firm_id=self.ygt.id,
                                   mode='one_time', contract_id=None, user=self.user,
                                   price_per_kg='0.90')

    def test_bad_framework_contract_raises(self) -> None:
        other_pair = Contract.objects.create(
            contract_number='9/25-YGT-EXP', seq=9, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=_ifirm('BX'), season=_season(),
        )
        with self.assertRaises(ValueError):
            link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                                   mode='framework', contract_id=other_pair.id, user=self.user)


class EndpointSmokeTest(TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.ygt = _efirm('YGT')
        self.shipment = _shipment(self.buyer)
        _split(self.shipment, self.ygt, amount='12000.00')
        _apply_packing(self.shipment, _SHARE_A)
        self.admin = User.objects.create(username='admin1', role='admin', is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_get_lists_rows_with_options_and_warning(self) -> None:
        r = self.client.get(f'/api/v1/contracts/shipment-firm-contracts/?shipment={self.shipment.id}')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(len(body['rows']), 1)
        row = body['rows'][0]
        self.assertEqual(row['export_firm'], self.ygt.id)
        self.assertEqual(row['money_warning'], 'bank')
        self.assertIsNone(row['linked'])

    def test_post_one_time_then_get_shows_linked(self) -> None:
        r = self.client.post('/api/v1/contracts/shipment-firm-contracts/', {
            'shipment': self.shipment.id, 'export_firm': self.ygt.id, 'mode': 'one_time',
            'price_per_kg': '0.90',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['contract_type'], 'ONE_TIME')

        r2 = self.client.get(f'/api/v1/contracts/shipment-firm-contracts/?shipment={self.shipment.id}')
        self.assertIsNotNone(r2.json()['rows'][0]['linked'])


class ContractStatusEndpointTest(TestCase):
    """The Sheet's contracts-cell icon reads this map — one entry per truck."""

    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.ygt = _efirm('YGT')
        self.hj = _efirm('HJ')
        self.shipment = _shipment(self.buyer)
        _split(self.shipment, self.ygt)
        _split(self.shipment, self.hj)
        _apply_packing(self.shipment, _SHARE_A, _SHARE_B)
        self.admin = User.objects.create(username='admin2', role='admin', is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.user = self.admin

    def _get(self) -> dict:
        r = self.client.get('/api/v1/contracts/shipment-contract-status/')
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_absent_until_a_firm_is_linked_then_counts_up(self) -> None:
        self.assertNotIn(str(self.shipment.id), self._get())

        link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                               mode='one_time', contract_id=None, user=self.user,
                               price_per_kg='0.90')
        self.assertEqual(self._get()[str(self.shipment.id)], 1)

        link_split_to_contract(shipment=self.shipment, export_firm_id=self.hj.id,
                               mode='one_time', contract_id=None, user=self.user,
                               price_per_kg='0.90')
        self.assertEqual(self._get()[str(self.shipment.id)], 2)

    def test_void_sale_does_not_count(self) -> None:
        sale = link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                                      mode='one_time', contract_id=None, user=self.user,
                                      price_per_kg='0.90')
        sale.status = ContractSale.STATUS_VOID
        sale.save()
        self.assertNotIn(str(self.shipment.id), self._get())


class BuyerGeneratorFieldsTest(TestCase):
    """The Sheet contracts cell renders the contract generator inline, so the
    payload carries the two buyer-level facts that button needs: whether the
    template supports the destination country, and the director name to pre-fill.
    Both are shipment-level — every firm split of a truck shares one buyer."""

    def setUp(self) -> None:
        self.ygt = _efirm('YGT')
        self.admin = User.objects.create(username='admin3', role='admin', is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _get(self, shipment) -> dict:
        r = self.client.get(f'/api/v1/contracts/shipment-firm-contracts/?shipment={shipment.id}')
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_supported_country_reports_true_and_the_saved_director(self) -> None:
        kz = Country.objects.create(code='KZ', name_tk='Gazagystan', name_ru='Казахстан')
        buyer = ImportFirm.objects.create(
            code='B-KZ', name_company='Import KZ', country=kz, contact_person='Иванов И.И.',
        )
        shipment = _shipment(buyer, code='0101010/25')
        _split(shipment, self.ygt)

        body = self._get(shipment)
        self.assertTrue(body['contract_template_supported'])
        self.assertEqual(body['import_firm_director'], 'Иванов И.И.')

    def test_unsupported_country_reports_false(self) -> None:
        tr = Country.objects.create(code='TR', name_tk='Turkiye', name_ru='Турция')
        buyer = ImportFirm.objects.create(code='B-TR', name_company='Import TR', country=tr)
        shipment = _shipment(buyer, code='0101011/25')
        _split(shipment, self.ygt)

        body = self._get(shipment)
        self.assertFalse(body['contract_template_supported'])
        self.assertIsNone(body['import_firm_director'])

    def test_shipment_without_a_buyer_reports_false_and_null(self) -> None:
        shipment = _shipment(None, code='0101012/25')
        _split(shipment, self.ygt)

        body = self._get(shipment)
        self.assertFalse(body['contract_template_supported'])
        self.assertIsNone(body['import_firm_director'])


# One share per firm split, positional — the same firm↔share rule the apply-template
# endpoint uses. `_split` leaves split_order at its default, so number the splits
# here or `order_by('split_order')` has nothing to order by.
def _apply_packing(shipment, *shares) -> PackingTemplate:
    template = PackingTemplate.objects.create(
        name=f'T{shipment.pk}', net_kg='18000.00', gross_kg='20442.00',
        box_count=2912, pallet_count='33.0', pallet_weight_kg='412.00',
    )
    for order, share in enumerate(shares, start=1):
        PackingTemplateShare.objects.create(template=template, share_order=order, **share)
    for order, split in enumerate(shipment.firm_splits.order_by('id'), start=1):
        ShipmentFirmSplit.objects.filter(pk=split.pk).update(split_order=order)
    shipment.packing_template = template
    shipment.save(update_fields=['packing_template'])
    return template


_SHARE_A = dict(net_kg='10000.00', gross_kg='11373.00', box_count=1618,
                pallet_count='18.0', pallet_weight_kg='229.00')
_SHARE_B = dict(net_kg='8000.00', gross_kg='9099.00', box_count=1294,
                pallet_count='15.0', pallet_weight_kg='183.00')


class PackingFromTemplateTest(TestCase):
    """Applying a packing template copies each share onto the firm's sale — but
    that copy hits nothing when the contract is linked afterwards, because the
    sale did not exist yet. The link must back-fill, or the firm's invoice
    renders with no pieces, no gross and no pallet sentence.
    """

    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.first = _efirm('AAA')
        self.second = _efirm('BBB')
        self.shipment = _shipment(self.buyer)
        _split(self.shipment, self.first, weight='10000.00')
        _split(self.shipment, self.second, weight='8000.00')
        self.user = User.objects.create(username='linker', role='export_manager')
        _apply_packing(self.shipment, _SHARE_A, _SHARE_B)

    def _link(self, firm):
        return link_split_to_contract(
            shipment=self.shipment, export_firm_id=firm.id,
            mode='one_time', contract_id=None, user=self.user, price_per_kg='0.90',
        )

    def test_the_firms_own_share_lands_on_its_sale(self) -> None:
        sale = self._link(self.second)
        self.assertEqual(sale.gross_kg, Decimal('9099.00'))
        self.assertEqual(sale.box_count, 1294)
        self.assertEqual(sale.pallet_count, Decimal('15.0'))
        self.assertEqual(sale.pallet_weight_kg, Decimal('183.00'))

    def test_each_firm_gets_its_own_share_not_the_trucks_total(self) -> None:
        self.assertEqual(self._link(self.first).gross_kg, Decimal('11373.00'))
        self.assertEqual(self._link(self.second).gross_kg, Decimal('9099.00'))

    def test_an_operator_edit_survives_a_relink(self) -> None:
        sale = self._link(self.first)
        ContractSale.objects.filter(pk=sale.pk).update(box_count=1600)
        again = self._link(self.first)
        self.assertEqual(again.box_count, 1600)  # kept
        self.assertEqual(again.gross_kg, Decimal('11373.00'))  # still filled

    def test_a_truck_with_no_packing_template_is_refused(self) -> None:
        bare = _shipment(self.buyer, code='0101009/25')
        _split(bare, self.first)
        with self.assertRaisesRegex(ValueError, 'packing template'):
            link_split_to_contract(
                shipment=bare, export_firm_id=self.first.id,
                mode='one_time', contract_id=None, user=self.user, price_per_kg='0.90',
            )

    def test_the_invoice_document_then_carries_the_packing(self) -> None:
        """The reported symptom, end to end: pieces, gross and the pallet line."""
        from apps.contracts.services.document_context import build_invoice_context

        sale = self._link(self.second)
        sale.refresh_from_db()
        context = build_invoice_context(sale, 'en')
        self.assertEqual(context['line_items'][0]['pieces'], '1294')
        self.assertEqual(context['line_items'][0]['gross'], '9,099')
        self.assertIn('15 wooden pallets', context['pallet_note'])
        self.assertIn('183 kg', context['pallet_note'])

    def test_a_swapped_firm_is_left_blank_rather_than_given_the_wrong_share(self) -> None:
        """`scope='swap'` exchanges the two weights but keeps `split_order`, so
        the positional share stops matching. Back-filling it would print a gross
        and box count against a net they were never cut for."""
        splits = {s.export_firm_id: s for s in self.shipment.firm_splits.all()}
        first, second = splits[self.first.id], splits[self.second.id]
        first.weight_kg, second.weight_kg = second.weight_kg, first.weight_kg
        ShipmentFirmSplit.objects.filter(pk=first.pk).update(weight_kg=first.weight_kg)
        ShipmentFirmSplit.objects.filter(pk=second.pk).update(weight_kg=second.weight_kg)

        sale = self._link(self.first)  # now 8,000 kg, but share 1 is cut for 10,000
        self.assertEqual(sale.quantity_kg, Decimal('8000.00'))
        self.assertIsNone(sale.gross_kg)
        self.assertIsNone(sale.box_count)


class OneTimePriceTest(TestCase):
    """A one-time contract must carry the agreed price, because its document prints it.

    A framework contract's price is a term of an agreement already signed; a
    one-time contract has none, so without the operator's number the .docx
    renders a blank price, quantity and total. The service therefore refuses to
    create one without a price.
    """

    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.ygt = _efirm('YGT')
        self.shipment = _shipment(self.buyer)
        self.split = _split(self.shipment, self.ygt)
        self.user = User.objects.create(username='pricer', role='export_manager')
        _apply_packing(self.shipment, _SHARE_A)

    def _link(self, price):
        return link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='one_time', contract_id=None, user=self.user, price_per_kg=price,
        )

    def test_missing_price_is_refused_and_creates_nothing(self) -> None:
        before = Contract.objects.count()
        with self.assertRaisesRegex(ValueError, 'price per kg'):
            self._link(None)
        self.assertEqual(Contract.objects.count(), before)
        self.assertFalse(ContractSale.objects.filter(shipment=self.shipment).exists())

    def test_blank_zero_negative_and_gibberish_are_all_refused(self) -> None:
        for bad in ('', '   ', '0', '-1', 'abc', '10000'):
            with self.subTest(price=bad), self.assertRaises(ValueError):
                self._link(bad)

    def test_the_price_lands_on_the_contract_with_quantity_and_total(self) -> None:
        """All three, not just the price — the document reads all three."""
        sale = self._link('0.9000')
        contract = sale.contract
        self.assertEqual(contract.price_per_kg, Decimal('0.9000'))
        self.assertEqual(contract.planned_quantity_kg, Decimal('9000.00'))
        self.assertEqual(contract.planned_amount_usd, Decimal('8100.00'))

    def test_the_price_lands_on_the_sale_without_rewriting_the_trucks_amount(self) -> None:
        sale = self._link('0.9000')
        self.assertEqual(sale.price_per_kg, Decimal('0.9000'))
        # The split's own amount_usd (8000) is the export side's money and wins
        # over 9000 × 0.90; this call must not rewrite it.
        self.assertEqual(sale.total_usd, Decimal('8000.00'))

    def test_a_split_with_no_amount_takes_the_computed_total(self) -> None:
        ShipmentFirmSplit.objects.filter(pk=self.split.pk).update(amount_usd=None)
        sale = self._link('0.9000')
        self.assertEqual(sale.total_usd, Decimal('8100.00'))

    def test_framework_mode_needs_no_price(self) -> None:
        fw = Contract.objects.create(
            contract_number='42/25-YGT-EXP', seq=42, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='framework', contract_id=fw.id, user=self.user,
        )
        self.assertEqual(sale.contract_id, fw.id)

    def test_the_contract_document_then_prints_price_quantity_and_total(self) -> None:
        """End to end: the four placeholders that were blank before."""
        from apps.contracts.services.document_context import build_contract_context

        contract = self._link('0.9000').contract
        contract.refresh_from_db()
        context = build_contract_context(contract, 'ru')
        self.assertEqual(context['price'], '0,9')  # RU decimal comma
        self.assertTrue(context['quantity'])
        self.assertTrue(context['total_sum'])
        self.assertTrue(context['total_sum_words_ru'])

    def test_a_second_create_mints_a_new_contract_and_orphans_the_first(self) -> None:
        """The recovery path for a mistyped price — pinned, not endorsed.

        Nothing used to give an operator a reason to press *Create one-time*
        twice; a wrong price does. The sale is repointed at the new contract and
        the first is left with no sales, which is exactly the case the contract
        list allows deleting. Worth knowing before someone "fixes" a price by
        clicking again.
        """
        first = self._link('0.9000').contract
        second = self._link('0.8000').contract

        self.assertNotEqual(first.pk, second.pk)
        self.assertNotEqual(first.contract_number, second.contract_number)
        # One sale, pointing at the corrected contract.
        sales = ContractSale.objects.filter(shipment=self.shipment)
        self.assertEqual(sales.count(), 1)
        self.assertEqual(sales.first().contract_id, second.pk)
        # The first is orphaned but deletable — no sales attached.
        self.assertFalse(ContractSale.objects.filter(contract=first).exists())

    def test_parse_price_quantizes_to_four_places(self) -> None:
        self.assertEqual(parse_price_per_kg('0.9'), Decimal('0.9000'))
        self.assertEqual(parse_price_per_kg(1.25), Decimal('1.2500'))


class OneTimePriceEndpointTest(TestCase):
    """The POST refuses a priceless one_time with the message the panel shows."""

    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.ygt = _efirm('YGT')
        self.shipment = _shipment(self.buyer)
        _split(self.shipment, self.ygt)
        _apply_packing(self.shipment, _SHARE_A)
        self.admin = User.objects.create(username='admin3', role='admin', is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _post(self, **extra):
        body = {'shipment': self.shipment.id, 'export_firm': self.ygt.id, 'mode': 'one_time'}
        body.update(extra)
        return self.client.post(
            '/api/v1/contracts/shipment-firm-contracts/', body, format='json',
        )

    def test_without_a_price_it_is_400_with_a_readable_error(self) -> None:
        r = self._post()
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn('price per kg', r.json()['error'])

    def test_gibberish_is_400_not_500(self) -> None:
        """Decimal('abc') raises InvalidOperation, which is not a ValueError."""
        r = self._post(price_per_kg='abc')
        self.assertEqual(r.status_code, 400, r.content)

    def test_with_a_price_it_creates_the_contract(self) -> None:
        r = self._post(price_per_kg='0.85')
        self.assertEqual(r.status_code, 201, r.content)
        contract = Contract.objects.get(pk=r.json()['contract_id'])
        self.assertEqual(contract.price_per_kg, Decimal('0.8500'))
        self.assertEqual(contract.planned_amount_usd, Decimal('7650.00'))
