from django.db import migrations
from django.db.models import Q


def set_defaults(apps, schema_editor):
    """Flag Russia, Kazakhstan and Gapy Satys as the default grid destinations.

    Matches real export countries by code (RU/KZ) and the domestic Gapy-Satys
    category by its null country + name. Kyrgyzstan (KG) and any other
    destination stay non-default (pickable, but not pre-selected).
    """
    TruckDestination = apps.get_model('core', 'TruckDestination')
    TruckDestination.objects.filter(
        Q(country__code__in=['RU', 'KZ'])
        | Q(country__isnull=True, name__icontains='gapy')
    ).update(is_default=True)


def clear_defaults(apps, schema_editor):
    TruckDestination = apps.get_model('core', 'TruckDestination')
    TruckDestination.objects.update(is_default=False)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0027_truckdestination_is_default'),
    ]

    operations = [
        migrations.RunPython(set_defaults, clear_defaults),
    ]
