"""The Truck Destinations page edits the country's "Serhet nokady".

The value is stored on ``Country`` — a shipment references ``country``, never a
``TruckDestination`` row, and two destinations may share one country (or have
none, like Gapy Satys). The admin page is only where it is *edited*, so the
serializer reads and writes through to the Country row. The consequences that
follow from that choice are what these tests pin: a country-less destination
cannot hold one, and two destinations on the same country see one value.
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import BorderPoint, Country, TruckDestination, User


class TruckDestinationBorderPointTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.admin = User(username='td_admin', role='admin')
        cls.admin.set_password('pass')
        cls.admin.save()
        cls.farap = BorderPoint.objects.create(name='Farap', name_ru='Фарап')
        cls.garabogaz = BorderPoint.objects.create(name='Garabogaz', name_ru='Гарабогаз')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.kazakhstan = Country.objects.create(
            name_tk='Gazagystan', name_en='Kazakhstan', code='KZ',
        )

    def test_setting_it_writes_through_to_the_country(self):
        dest = TruckDestination.objects.create(name='Gazak', country=self.kazakhstan)

        response = self.client.patch(
            f'/api/v1/core/truck-destinations/{dest.id}/',
            {'border_point': self.farap.id},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['border_point'], self.farap.id)
        self.assertEqual(response.data['border_point_name'], 'Farap')
        self.kazakhstan.refresh_from_db()
        self.assertEqual(self.kazakhstan.border_point_id, self.farap.id)

    def test_it_can_be_cleared(self):
        self.kazakhstan.border_point = self.farap
        self.kazakhstan.save(update_fields=['border_point'])
        dest = TruckDestination.objects.create(name='Gazak', country=self.kazakhstan)

        response = self.client.patch(
            f'/api/v1/core/truck-destinations/{dest.id}/',
            {'border_point': None},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['border_point'])
        self.kazakhstan.refresh_from_db()
        self.assertIsNone(self.kazakhstan.border_point_id)

    def test_a_destination_with_no_country_is_refused(self):
        """Gapy Satys has country=NULL — there is nowhere to store the value."""
        dest = TruckDestination.objects.create(name='Gapy Satys')

        response = self.client.patch(
            f'/api/v1/core/truck-destinations/{dest.id}/',
            {'border_point': self.farap.id},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('border_point', response.data)

    def test_a_country_less_destination_reads_as_null(self):
        TruckDestination.objects.create(name='Gapy Satys')

        row = next(
            r for r in self.client.get('/api/v1/core/truck-destinations/').data['results']
            if r['name'] == 'Gapy Satys'
        )

        self.assertIsNone(row['border_point'])
        self.assertIsNone(row['border_point_name'])

    def test_two_destinations_on_one_country_share_the_value(self):
        """Documented consequence of storing it on Country, not on the row."""
        first = TruckDestination.objects.create(name='Gazak', country=self.kazakhstan)
        second = TruckDestination.objects.create(name='Gazak-2', country=self.kazakhstan)

        self.client.patch(
            f'/api/v1/core/truck-destinations/{first.id}/',
            {'border_point': self.garabogaz.id},
            format='json',
        )
        response = self.client.get(f'/api/v1/core/truck-destinations/{second.id}/')

        self.assertEqual(response.data['border_point'], self.garabogaz.id)

    def test_it_can_be_set_on_create(self):
        response = self.client.post(
            '/api/v1/core/truck-destinations/',
            {'name': 'Gazak', 'country': self.kazakhstan.id, 'border_point': self.farap.id},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.kazakhstan.refresh_from_db()
        self.assertEqual(self.kazakhstan.border_point_id, self.farap.id)
