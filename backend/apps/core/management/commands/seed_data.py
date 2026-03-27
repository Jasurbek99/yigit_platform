"""Management command: load seed data from DDL v5.1 INSERT statements.

Usage:
    python manage.py seed_data          # load all reference data
    python manage.py seed_data --reset  # wipe and reload
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import (
    Country, Season, ShipmentStatusType,
    TomatoVariety, ProductType, BorderPoint, LoadingLocation,
    GreenhouseBlock,
)


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
    {'code': 'O', 'name': 'O-Ýyladyşhana', 'variety_main': 'Defensiosa', 'location': 'Owadandepe'},
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
            self._load(GreenhouseBlock, GREENHOUSE_BLOCKS, 'code')

        self.stdout.write(self.style.SUCCESS('Seed data loaded successfully.'))

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
