"""Test data for market tests: one season, two agents with a seller each, one shipment per state."""
from io import StringIO
from types import SimpleNamespace

from django.core.management import call_command

from apps.core.models import City, Country, Customer, ShipmentStatusType, User
from apps.export.models import ExpenseCategory, Shipment
from apps.export.tests_auto_advance import _ensure_statuses, _make_season
from apps.market.expense_codes import MARKET_EXPENSES
from apps.market.models import AgentMember, Bazaar


def ensure_market_expense_categories() -> None:
    """Data migrations skip on test DBs — make the categories the market uses."""
    for i, (code, label) in enumerate(MARKET_EXPENSES):
        ExpenseCategory.objects.get_or_create(code=code, defaults={'name_tk': label, 'name_ru': label, 'name_en': code,
                                                                   'sort_order': 900 + i})


def make_shipment(world, code: str, status_code: str, customer=None, **extra) -> Shipment:
    """A shipment of `customer` (default: the world's agent customer) at `status_code`."""
    return Shipment.objects.create(
        shipment_code=code, date='2026-01-01', season=world.season,
        status=ShipmentStatusType.objects.get(code=status_code),
        customer=customer or world.customer, country=world.country,
        box_count=100, pallet_count=2, created_by=world.rep, updated_by=world.rep, **extra,
    )


def make_world() -> SimpleNamespace:
    """Seed permissions + statuses and build two agents (A with seller S1/S2, B with seller T)."""
    _ensure_statuses()
    call_command('seed_permissions', verbosity=0, stdout=StringIO())
    ensure_market_expense_categories()
    w = SimpleNamespace()
    w.season = _make_season()
    w.country, _ = Country.objects.get_or_create(code='KZ', defaults={'name_tk': 'Kz', 'name_en': 'Kz', 'name_ru': 'Казахстан'})
    w.country.currency = 'KZT'
    w.country.save()
    w.city = City.objects.create(country=w.country, name='Алматы-тест')
    w.rep = User.objects.create_user(username='mk_rep', password='pw', role='sales_rep')
    w.boss = User.objects.create_user(username='mk_boss', password='pw', role='boss')
    w.customer = Customer.objects.create(name='Агент А', sales_rep=w.rep)
    w.other_customer = Customer.objects.create(name='Агент Б')
    w.bazaar = Bazaar.objects.create(customer=w.customer, name='Алтын Орда', city=w.city)
    w.bazaar_no_city = Bazaar.objects.create(customer=w.customer, name='Без города')
    w.agent = _member('mk_agent', 'agent', w.customer)
    w.seller = _member('mk_s1', 'agent_seller', w.customer, w.bazaar)
    w.seller2 = _member('mk_s2', 'agent_seller', w.customer, w.bazaar_no_city)
    w.other_agent = _member('mk_agent_b', 'agent', w.other_customer)
    w.other_seller = _member('mk_t1', 'agent_seller', w.other_customer)
    w.shipment = make_shipment(w, 'MK-1', 'bardy')
    return w


def _member(username, role, customer, bazaar=None) -> User:
    user = User.objects.create_user(username=username, password='pw', role=role, first_name=username)
    AgentMember.objects.create(user=user, customer=customer, bazaar=bazaar)
    return user
