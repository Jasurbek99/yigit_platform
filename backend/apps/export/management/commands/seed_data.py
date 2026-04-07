"""Management command: load seed data from DDL v5.1 INSERT statements.

Usage:
    python manage.py seed_data          # load all reference data
    python manage.py seed_data --reset  # wipe and reload
"""
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction

import datetime

from django.utils import timezone

from apps.core.models import (
    Country, Season, ShipmentStatusType,
    TomatoVariety, ProductType, BorderPoint, LoadingLocation,
    GreenhouseBlock, User, ExportFirm, Customer, City,
)
from apps.export.models import Shipment, ShipmentFirmSplit


EXPORT_FIRMS = [
    {'code': 'YGT', 'name_tk': 'Ýigit H.J.', 'name_ru': 'Йигит Х.Дж.', 'name_en': 'YGT HJ', 'is_active': True},
    {'code': 'HMS', 'name_tk': 'Hemsaya H.J.', 'name_ru': 'Хемсая Х.Дж.', 'name_en': 'Hemsaya HJ', 'is_active': True},
    {'code': 'GB', 'name_tk': 'Gülbahar H.J.', 'name_ru': 'Гюльбахар Х.Дж.', 'name_en': 'Gulbahar HJ', 'is_active': True},
    {'code': 'MA', 'name_tk': 'Mähriban A.', 'name_ru': 'Мэхрибан А.', 'name_en': 'Mehriban A', 'is_active': True},
    {'code': 'DM', 'name_tk': 'Dürli Miweler H.J.', 'name_ru': 'Дюрли Мивелер Х.Дж.', 'name_en': 'Durli Miweler HJ', 'is_active': True},
]

SEASONS = [
    {'name': '2025-2026', 'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
]

COUNTRIES = [
    {'name_tk': 'GAZAGYSTAN', 'name_ru': 'Казахстан', 'name_en': 'Kazakhstan', 'code': 'KZ'},
    {'name_tk': 'RUSSIYA', 'name_ru': 'Россия', 'name_en': 'Russia', 'code': 'RU'},
    {'name_tk': 'OZBEKYSTAN', 'name_ru': 'Узбекистан', 'name_en': 'Uzbekistan', 'code': 'UZ'},
    {'name_tk': 'GYRGYSYSTAN', 'name_ru': 'Кыргызстан', 'name_en': 'Kyrgyzstan', 'code': 'KG'},
    {'name_tk': 'TAJIGISTAN', 'name_ru': 'Таджикистан', 'name_en': 'Tajikistan', 'code': 'TJ'},
    {'name_tk': 'BELARUS', 'name_ru': 'Беларусь', 'name_en': 'Belarus', 'code': 'BY'},
    {'name_tk': 'OWGANYSTAN', 'name_ru': 'Афганистан', 'name_en': 'Afghanistan', 'code': 'AF'},
    {'name_tk': 'TURKMENISTAN', 'name_ru': 'Туркменистан', 'name_en': 'Turkmenistan', 'code': 'TM'},
]

STATUS_TYPES = [
    {'code': 'yuklenme', 'name_tk': 'Ýüklenme', 'name_en': 'Loading', 'name_ru': 'Загрузка',
     'step_order': 1, 'required_role': 'warehouse_chief', 'phase': 'LOADING'},
    {'code': 'gumruk_girish', 'name_tk': 'Gümrük giriş', 'name_en': 'Customs Entry', 'name_ru': 'Таможня вход',
     'step_order': 2, 'required_role': 'document_team', 'phase': 'CUSTOMS'},
    {'code': 'gumruk_chykysh', 'name_tk': 'Gümrük çykyş', 'name_en': 'Customs Exit', 'name_ru': 'Таможня выход',
     'step_order': 3, 'required_role': 'document_team', 'phase': 'CUSTOMS'},
    {'code': 'yola_chykdy', 'name_tk': 'Ýola çykdy', 'name_en': 'Departed', 'name_ru': 'Выехал',
     'step_order': 4, 'required_role': 'transport', 'phase': 'TRANSIT'},
    {'code': 'serhet_tm', 'name_tk': 'Serhet TM', 'name_en': 'TM Border', 'name_ru': 'Граница ТМ',
     'step_order': 5, 'required_role': 'transport', 'phase': 'BORDER'},
    {'code': 'serhet_gechdi', 'name_tk': 'Serhet geçdi', 'name_en': 'Border Crossed', 'name_ru': 'Пересёк границу',
     'step_order': 6, 'required_role': 'transport', 'phase': 'BORDER'},
    {'code': 'barysh_gumrugi', 'name_tk': 'Baryş gümrügi', 'name_en': 'Dest Customs', 'name_ru': 'Таможня назначения',
     'step_order': 7, 'required_role': 'sales_rep', 'phase': 'BORDER'},
    {'code': 'yolda', 'name_tk': 'Ýolda', 'name_en': 'In Transit', 'name_ru': 'В пути',
     'step_order': 8, 'required_role': 'sales_rep', 'phase': 'TRANSIT'},
    {'code': 'bardy', 'name_tk': 'Bardy', 'name_en': 'Arrived', 'name_ru': 'Прибыл',
     'step_order': 9, 'required_role': 'sales_rep', 'phase': 'SALES'},
    {'code': 'satylyar', 'name_tk': 'Satylyar', 'name_en': 'Being Sold', 'name_ru': 'Продаётся',
     'step_order': 10, 'required_role': 'sales_rep', 'phase': 'SALES'},
    {'code': 'satyldy', 'name_tk': 'Satyldy', 'name_en': 'Sold', 'name_ru': 'Продан',
     'step_order': 11, 'required_role': 'sales_rep', 'phase': 'SALES'},
    {'code': 'hasabat', 'name_tk': 'Hasabat', 'name_en': 'Report', 'name_ru': 'Отчёт',
     'step_order': 12, 'required_role': 'sales_rep', 'phase': 'COMPLETE'},
    {'code': 'tamamlandy', 'name_tk': 'Tamamlandy', 'name_en': 'Completed', 'name_ru': 'Завершено',
     'step_order': 13, 'required_role': 'finansist', 'phase': 'COMPLETE'},
]

TOMATO_VARIETIES = [
    {'name': 'Defensiosa', 'type': 'Salkym'},
    {'name': 'Midelyce', 'type': 'Salkym'},
    {'name': 'Mahitos', 'type': 'Salkym'},
    {'name': 'Torero', 'type': 'Salkym'},
    {'name': 'Meralice', 'type': 'Salkym'},
    {'name': 'Cherry', 'type': 'Cherri'},
]

PRODUCT_TYPES = ['Pomidor', 'Bolgar burç', 'Badamjan', 'Hyyar']

BORDER_POINTS = [
    {'name': 'Farap', 'route_description': 'Land route: TM → UZ → KZ', 'typical_transit_days': 3},
    {'name': 'Sarahs', 'route_description': 'Land route: TM → Iran border', 'typical_transit_days': 2},
    {'name': 'Garabogaz', 'route_description': 'Caspian ferry: TM → KZ → RU', 'typical_transit_days': 5},
    {'name': 'Bekdas', 'route_description': 'Northern route', 'typical_transit_days': 4},
    {'name': 'Dasoguz', 'route_description': 'Northern land route', 'typical_transit_days': 3},
]

LOADING_LOCATIONS = ['Dusak', 'Kaka', 'Owadandepe']

TEST_USERS = [
    {'username': 'warehouse_chief', 'password': 'wc123', 'role': 'warehouse_chief', 'first_name': 'Anwar', 'last_name': 'Test'},
    {'username': 'document_team', 'password': 'dt123', 'role': 'document_team', 'first_name': 'Dinara', 'last_name': 'Test'},
    {'username': 'transport', 'password': 'tr123', 'role': 'transport', 'first_name': 'Tariel', 'last_name': 'Test'},
    {'username': 'sales_rep', 'password': 'sr123', 'role': 'sales_rep', 'first_name': 'Soltanmyrat', 'last_name': 'Test'},
    {'username': 'export_manager', 'password': 'em123', 'role': 'export_manager', 'first_name': 'Gadam', 'last_name': 'Test'},
]

# Cities needed for price import (Baha_Grafigi.xlsx destinations)
# KZ cities are already seeded by import_shipments. These add missing ones.
CITIES = [
    {'country_code': 'KZ', 'name': 'Şimkent'},
    {'country_code': 'KZ', 'name': 'Almaty'},
    {'country_code': 'KZ', 'name': 'Astana'},
    {'country_code': 'KZ', 'name': 'Karaganda'},
    {'country_code': 'RU', 'name': 'Moskwa'},
    {'country_code': 'RU', 'name': 'Orenburg'},
    {'country_code': 'BY', 'name': 'Minsk'},
    {'country_code': 'KG', 'name': 'Bishkek'},
]

GREENHOUSE_BLOCKS = [
    {'code': 'A', 'name': 'A-Ýyladyşhana', 'variety_main': 'Midelyce', 'area_m2': 93171, 'location': 'Dusak'},
    {'code': 'B', 'name': 'B-Ýyladyşhana', 'variety_main': 'Defensiosa', 'area_m2': 95897, 'location': 'Dusak'},
    {'code': 'C', 'name': 'C-Ýyladyşhana', 'variety_main': 'Mahitos', 'location': 'Dusak'},
    {'code': 'D', 'name': 'D-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Dusak'},
    {'code': 'E', 'name': 'E-Ýyladyşhana', 'variety_main': 'Torero', 'location': 'Dusak'},
    {'code': 'F', 'name': 'F-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Dusak'},
    {'code': 'G', 'name': 'G-Ýyladyşhana', 'variety_main': 'Meralice', 'location': 'Dusak'},
    {'code': 'H', 'name': 'H-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Dusak'},
    {'code': 'I', 'name': 'I-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Dusak'},
    {'code': 'J', 'name': 'J-Ýyladyşhana', 'variety_main': 'Midelyce', 'location': 'Dusak'},
    {'code': 'K', 'name': 'K-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Kaka'},
    {'code': 'L', 'name': 'L-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Kaka'},
    {'code': 'M15', 'name': 'M15-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Dusak'},
    {'code': 'M5', 'name': 'M5-Ýyladyşhana', 'variety_main': 'Mahitos', 'location': 'Dusak'},
    {'code': 'O', 'name': 'O-Ýyladyşhana', 'variety_main': 'Defensiosa', 'area_m2': 173184, 'location': 'Owadandepe'},
    # OD and OG are inner sub-blocks of O (each half of O's total area)
    {'code': 'OD', 'name': 'OD-Ýyladyşhana', 'variety_main': 'Defensiosa', 'area_m2': 86592, 'location': 'Owadandepe', 'parent': 'O'},
    {'code': 'OG', 'name': 'OG-Ýyladyşhana', 'variety_main': 'Defensiosa', 'area_m2': 86592, 'location': 'Owadandepe', 'parent': 'O'},
]


class Command(BaseCommand):
    help = 'Load seed reference data from DDL v5.1'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true', help='Delete existing data before loading')

    def handle(self, *args, **options):
        if options['reset']:
            self.stdout.write('Deleting existing reference data...')
            ShipmentStatusType.objects.all().delete()
            Country.objects.all().delete()
            Season.objects.all().delete()
            TomatoVariety.objects.all().delete()
            ProductType.objects.all().delete()
            BorderPoint.objects.all().delete()
            LoadingLocation.objects.all().delete()
            GreenhouseBlock.objects.all().delete()

        with transaction.atomic():
            self._load(Season, SEASONS, 'name')
            self._load(Country, COUNTRIES, 'code')
            self._load(ShipmentStatusType, STATUS_TYPES, 'code')
            self._load(TomatoVariety, TOMATO_VARIETIES, 'name')
            for name in PRODUCT_TYPES:
                ProductType.objects.get_or_create(name=name)
            self._load(BorderPoint, BORDER_POINTS, 'name')
            for name in LOADING_LOCATIONS:
                LoadingLocation.objects.get_or_create(name=name)
            self._seed_blocks()
            self._load(ExportFirm, EXPORT_FIRMS, 'code')
            self._load_cities()
            self._create_test_users()
            self._seed_sample_shipments()

        self.stdout.write(self.style.SUCCESS('Seed data loaded successfully.'))

    def _create_test_users(self) -> None:
        created = 0
        for data in TEST_USERS:
            if not User.objects.filter(username=data['username']).exists():
                User.objects.create(
                    username=data['username'],
                    password=make_password(data['password']),
                    role=data['role'],
                    first_name=data['first_name'],
                    last_name=data['last_name'],
                    is_staff=False,
                    is_superuser=False,
                )
                created += 1
        self.stdout.write(f'  Test users: {len(TEST_USERS)} accounts ({created} new)')

    def _seed_sample_shipments(self) -> None:
        """Create 3 realistic sample shipments at different lifecycle stages."""
        admin = User.objects.filter(is_superuser=True).first()
        if not admin:
            return

        kz = Country.objects.filter(code='KZ').first()
        ru = Country.objects.filter(code='RU').first()
        season = Season.objects.filter(is_active=True).first()
        ygt = ExportFirm.objects.filter(code='YGT').first()
        hms = ExportFirm.objects.filter(code='HMS').first()
        begjan = Customer.objects.filter(name='Begjan').first()
        berik = Customer.objects.filter(name='Berik').first()
        eldar = Customer.objects.filter(name='Eldar').first()

        statuses = {s.code: s for s in ShipmentStatusType.objects.all()}
        created = 0

        samples = [
            # Shipment 1 — completed, Kazakhstan, YGT
            dict(
                cargo_code='27SP001/25',
                date=datetime.date(2025, 9, 27),
                status=statuses.get('tamamlandy'),
                country=kz,
                customer=begjan,
                season=season,
                weight_net=18100,
                weight_gross=18950,
                box_count=906,
                pallet_count=18,
                price_per_kg='0.79',
                loading_started_at=timezone.make_aware(datetime.datetime(2025, 9, 27, 6, 0)),
                departed_at=timezone.make_aware(datetime.datetime(2025, 9, 27, 18, 30)),
                arrived_at=timezone.make_aware(datetime.datetime(2025, 10, 1, 9, 15)),
                sale_started_at=timezone.make_aware(datetime.datetime(2025, 10, 1, 14, 0)),
                sale_ended_at=timezone.make_aware(datetime.datetime(2025, 10, 3, 17, 0)),
                firm_codes=['YGT'],
            ),
            # Shipment 2 — in transit, Russia, HMS+YGT split
            dict(
                cargo_code='15OC042/25',
                date=datetime.date(2025, 10, 15),
                status=statuses.get('yolda'),
                country=ru,
                customer=berik,
                season=season,
                weight_net=9000,
                weight_gross=9480,
                box_count=450,
                pallet_count=9,
                price_per_kg='0.85',
                loading_started_at=timezone.make_aware(datetime.datetime(2025, 10, 15, 7, 0)),
                departed_at=timezone.make_aware(datetime.datetime(2025, 10, 15, 20, 0)),
                firm_codes=['YGT', 'HMS'],
            ),
            # Shipment 3 — just loaded (active), Kazakhstan, YGT
            dict(
                cargo_code='02JA001/26',
                date=datetime.date(2026, 1, 2),
                status=statuses.get('yuklenme'),
                country=kz,
                customer=eldar,
                season=season,
                weight_net=18100,
                weight_gross=None,
                box_count=None,
                pallet_count=None,
                loading_started_at=timezone.make_aware(datetime.datetime(2026, 1, 2, 8, 0)),
                firm_codes=['YGT'],
            ),
        ]

        for s in samples:
            if Shipment.objects.filter(cargo_code=s['cargo_code']).exists():
                continue
            firm_codes = s.pop('firm_codes')
            shipment = Shipment.objects.create(created_by=admin, **s)
            for code in firm_codes:
                firm = ExportFirm.objects.filter(code=code).first()
                if firm:
                    ShipmentFirmSplit.objects.get_or_create(
                        shipment=shipment, export_firm=firm,
                        defaults={'weight_kg': shipment.weight_net / len(firm_codes) if shipment.weight_net else 0},
                    )
            created += 1

        self.stdout.write(f'  Sample shipments: 3 total ({created} new)')

    def _load_cities(self) -> None:
        """Ensure all price-import destination cities exist in core.cities."""
        country_map = {c.code: c for c in Country.objects.all()}
        created = 0
        for row in CITIES:
            country = country_map.get(row['country_code'])
            if not country:
                self.stderr.write(f'  WARNING: country code {row["country_code"]} not found, skipping city {row["name"]}')
                continue
            _, was_created = City.objects.get_or_create(
                country=country,
                name=row['name'],
            )
            if was_created:
                created += 1
        self.stdout.write(f'  City: {len(CITIES)} rows ({created} new)')

    def _seed_blocks(self) -> None:
        """Seed greenhouse blocks resolving variety/location/parent text names to FK instances.

        Two-pass strategy: parent blocks first (parent=None rows), then sub-blocks,
        so the parent FK can be resolved by code.
        """
        variety_map = {v.name: v for v in TomatoVariety.objects.all()}
        location_map = {loc.name: loc for loc in LoadingLocation.objects.all()}
        created = 0

        # Pass 1: parent blocks (rows without a 'parent' key)
        for row in GREENHOUSE_BLOCKS:
            if 'parent' in row:
                continue
            defaults = {k: v for k, v in row.items() if k not in ('code', 'variety_main', 'location')}
            defaults['variety_main'] = variety_map.get(row.get('variety_main', ''))
            defaults['location'] = location_map.get(row.get('location', ''))
            defaults['parent'] = None
            _, was_created = GreenhouseBlock.objects.update_or_create(
                code=row['code'], defaults=defaults,
            )
            if was_created:
                created += 1

        # Pass 2: sub-blocks (rows with a 'parent' key) — parent must exist now
        block_map = {b.code: b for b in GreenhouseBlock.objects.all()}
        for row in GREENHOUSE_BLOCKS:
            if 'parent' not in row:
                continue
            defaults = {k: v for k, v in row.items() if k not in ('code', 'variety_main', 'location', 'parent')}
            defaults['variety_main'] = variety_map.get(row.get('variety_main', ''))
            defaults['location'] = location_map.get(row.get('location', ''))
            defaults['parent'] = block_map.get(row['parent'])
            _, was_created = GreenhouseBlock.objects.update_or_create(
                code=row['code'], defaults=defaults,
            )
            if was_created:
                created += 1

        self.stdout.write(f'  GreenhouseBlock: {len(GREENHOUSE_BLOCKS)} rows ({created} new)')

    def _load(self, model, data: list, lookup_field: str) -> None:
        created = 0
        for row in data:
            _, was_created = model.objects.update_or_create(
                **{lookup_field: row[lookup_field]},
                defaults={k: v for k, v in row.items() if k != lookup_field},
            )
            if was_created:
                created += 1
        self.stdout.write(f'  {model.__name__}: {len(data)} rows ({created} new)')
