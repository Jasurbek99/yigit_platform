"""Tests for user-added customs expense categories ("Täze goş" in the Awanslar expense form).

Categories live in core.ShipmentOptionType under category='customs_expense'. The 13
original codes are seeded by a data migration; any customs-expense writer may add more.

Run specifically:
    python manage.py test apps.export.tests_customs_expense_category
"""
from django.urls import reverse

from apps.core.models import ShipmentOptionType, User
from apps.export.models import CUSTOMS_EXPENSE_OPTION_CATEGORY, CustomsExpense
from apps.export.tests_customs_expense import CustomsExpenseSetUpMixin


class CustomsExpenseCategoryMixin(CustomsExpenseSetUpMixin):
    def _categories_url(self) -> str:
        return reverse('customs-expense-category-list')

    def _add_category(self, user: User, **payload):
        self._login(user)
        return self.client.post(self._categories_url(), payload, format='json')

    def _user(self, role: str) -> User:
        return User.objects.create_user(username=f'u_{role}', password='pass', role=role)


class TestCustomsExpenseCategoryList(CustomsExpenseCategoryMixin):

    def test_seeded_categories_are_listed_for_any_user(self):
        self._login(self.reader)
        response = self.client.get(self._categories_url(), {'page_size': 200})
        self.assertEqual(response.status_code, 200)
        codes = {row['code'] for row in response.data['results']}
        self.assertTrue({'GUMRUKLEME', 'CT1', 'OTHER'} <= codes)

    def test_inactive_categories_are_hidden(self):
        ShipmentOptionType.objects.filter(
            category=CUSTOMS_EXPENSE_OPTION_CATEGORY, code='FITO',
        ).update(is_active=False)
        self._login(self.reader)
        response = self.client.get(self._categories_url(), {'page_size': 200})
        codes = {row['code'] for row in response.data['results']}
        self.assertNotIn('FITO', codes)


class TestCustomsExpenseCategoryCreate(CustomsExpenseCategoryMixin):

    def test_finansist_adds_category_with_generated_code(self):
        response = self._add_category(self._user('finansist'), label_tk='Ýol haky')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['code'], 'YOL_HAKY')
        self.assertEqual(response.data['label_tk'], 'Ýol haky')
        self.assertTrue(
            ShipmentOptionType.objects.filter(
                category=CUSTOMS_EXPENSE_OPTION_CATEGORY, code='YOL_HAKY', is_active=True,
            ).exists()
        )

    def test_document_team_can_add_category(self):
        response = self._add_category(
            self._user('document_team'), label_tk='Möhür', label_ru='Печать', label_en='Stamp',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['label_ru'], 'Печать')

    def test_non_writer_gets_403(self):
        response = self._add_category(self.reader, label_tk='Ýol haky')
        self.assertEqual(response.status_code, 403)

    def test_turkmen_name_is_required(self):
        response = self._add_category(self.writer, label_tk='  ', label_ru='Штраф')
        self.assertEqual(response.status_code, 400)
        self.assertIn('label_tk', response.data)

    def test_duplicate_name_is_rejected(self):
        response = self._add_category(self.writer, label_tk='gümrüklemek')
        self.assertEqual(response.status_code, 400)
        self.assertIn('label_tk', response.data)

    def test_name_of_a_deactivated_category_can_be_added_again(self):
        ShipmentOptionType.objects.filter(
            category=CUSTOMS_EXPENSE_OPTION_CATEGORY, code='FITO',
        ).update(is_active=False)
        response = self._add_category(self.writer, label_tk='Fitosanitariýa güwänamasy')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['code'], 'FITOSANITARIYA_GUWANAMAS')

    def test_colliding_code_gets_a_suffix(self):
        first = self._add_category(self.writer, label_tk='Ýol')
        second = self._add_category(self.writer, label_tk='Yol')
        self.assertEqual(first.data['code'], 'YOL')
        self.assertEqual(second.data['code'], 'YOL_2')

    def test_name_without_latin_letters_still_gets_a_code(self):
        response = self._add_category(self.writer, label_tk='Штраф')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['code'])


class TestCustomsExpenseWithAddedCategory(CustomsExpenseCategoryMixin):

    def test_expense_accepts_added_category_and_shows_its_name(self):
        code = self._add_category(self.writer, label_tk='Ýol haky').data['code']
        response = self.client.post(
            self._list_url(),
            {'expense_date': '2026-06-15', 'category': code, 'amount': '120.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['category'], code)
        self.assertEqual(response.data['category_display'], 'Ýol haky')

    def test_unknown_category_is_rejected(self):
        self._login(self.writer)
        response = self.client.post(
            self._list_url(),
            {'expense_date': '2026-06-15', 'category': 'NOT_A_CATEGORY', 'amount': '120.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('category', response.data)

    def test_ledger_shows_added_category_name(self):
        code = self._add_category(self.writer, label_tk='Ýol haky').data['code']
        CustomsExpense.objects.create(
            expense_date='2026-06-15', category=code, amount='75.00',
            shipment=self.shipment, created_by=self.writer,
        )
        response = self.client.get(self._ledger_url())
        row = next(r for r in response.data['by_category'] if r['category'] == code)
        self.assertEqual(row['category_display'], 'Ýol haky')
