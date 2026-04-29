"""Export writers for the Boss Dashboard reports tile grid.

Each section maps to one of the six tiles:
    monthly         — KPIs + period summary
    firms           — all firms with quota + risk
    routes          — route P&L breakdown
    blocks          — greenhouse plan vs actual
    seasons_compare — current vs previous season revenue
    audit           — recent shipment status transitions

Public API:
    build_excel(section, from_date, to_date) -> bytes
    build_pdf(section, from_date, to_date)   -> bytes
"""
from .boss_excel import build_excel
from .boss_pdf import build_pdf

__all__ = ['build_excel', 'build_pdf']
