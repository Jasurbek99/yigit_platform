"""PDF writers for Boss Dashboard report sections.

v1 PDFs are text + tables only — no chart images. Charts live on screen; PDFs
are the audit trail. Same six sections as the Excel exporter, identical data.
"""
from datetime import date
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)

from apps.export.services.boss_analytics import (
    _aggregate_summary,
    _aggregate_revenue,
    _aggregate_route_pnl,
    _aggregate_quota_grid,
    _aggregate_blocks_heatmap,
    _aggregate_top_customers,
    _aggregate_compliance,
    _aggregate_risk_matrix,
    _aggregate_production,
    _aggregate_export_market,
)


# ---------------------------------------------------------------------------
# Styling helpers
# ---------------------------------------------------------------------------

def _styles():
    base = getSampleStyleSheet()
    return {
        'title':    ParagraphStyle('title',    parent=base['Title'],   fontSize=16, spaceAfter=6),
        'subtitle': ParagraphStyle('subtitle', parent=base['Normal'],  fontSize=10, textColor=colors.grey, spaceAfter=10),
        'h2':       ParagraphStyle('h2',       parent=base['Heading2'], fontSize=12, spaceBefore=10, spaceAfter=6),
        'body':     base['Normal'],
    }


def _table_style() -> TableStyle:
    return TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1677FF')),
        ('TEXTCOLOR',  (0, 0), (-1, 0), colors.white),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE',   (0, 0), (-1, 0), 9),
        ('ALIGN',      (0, 0), (-1, 0), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
        ('FONTSIZE',   (0, 1), (-1, -1), 8),
        ('GRID',       (0, 0), (-1, -1), 0.25, colors.HexColor('#D9D9D9')),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
    ])


def _money(v) -> str:
    try:
        return f'${float(v or 0):,.0f}'
    except (TypeError, ValueError):
        return '$0'


def _pct(v) -> str:
    try:
        return f'{float(v or 0):.1f}%'
    except (TypeError, ValueError):
        return '0.0%'


def _kg(v) -> str:
    try:
        return f'{float(v or 0):,.0f}'
    except (TypeError, ValueError):
        return '0'


def _period_label(from_date: date, to_date: date) -> str:
    return f'{from_date.isoformat()} → {to_date.isoformat()}'


# ---------------------------------------------------------------------------
# Section builders — each returns a list of flowables
# ---------------------------------------------------------------------------

def _build_monthly(from_date: date, to_date: date) -> list:
    s = _styles()
    summary = _aggregate_summary(from_date, to_date)
    flow = [
        Paragraph('Aýlyk hasabat — Boss Dashboard', s['title']),
        Paragraph(_period_label(from_date, to_date), s['subtitle']),
        Paragraph('KPI jemleri', s['h2']),
    ]

    label_map = [
        ('revenue',      'Möwsüm girdejisi',     _money),
        ('margin',       'Margin',               _money),
        ('debt',         'Bergi (DEMO)',         _money),
        ('today_loaded', 'Bu gün ýüklendi',      lambda v: f'{int(v or 0)}'),
        ('in_transit',   'Ýolda maşyn',          lambda v: f'{int(v or 0)}'),
        ('quota_used',   'Kwota ulanyldy',       _pct),
    ]
    data = [['KPI', 'Bahasy']]
    for key, label, fmt in label_map:
        kpi = summary.get(key, {})
        data.append([label, fmt(kpi.get('value'))])
    t = Table(data, colWidths=[80 * mm, 60 * mm])
    t.setStyle(_table_style())
    flow.append(t)
    return flow


def _build_firms(from_date: date, to_date: date) -> list:
    s = _styles()
    quota_rows = _aggregate_quota_grid()
    risk_rows = {r['firm_id']: r for r in _aggregate_risk_matrix()}

    flow = [
        Paragraph('Firma boýunça hasabat', s['title']),
        Paragraph(_period_label(from_date, to_date), s['subtitle']),
    ]
    data = [['Firma', 'Kwota %', 'Derejesi', 'Bergi (DEMO)', 'Risk']]
    for q in quota_rows:
        risk = risk_rows.get(q.get('firm_id'), {})
        debt = (risk.get('debt_usd') or {}).get('value')
        data.append([
            q.get('firm_name', ''),
            _pct(q.get('used_pct')),
            q.get('level', ''),
            _money(debt),
            risk.get('risk_level', ''),
        ])
    t = Table(data, colWidths=[55 * mm, 25 * mm, 25 * mm, 35 * mm, 25 * mm], repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)
    return flow


def _build_routes(from_date: date, to_date: date) -> list:
    s = _styles()
    rows = _aggregate_route_pnl(from_date, to_date)

    flow = [
        Paragraph('Marşrut girdejililigi (P&L)', s['title']),
        Paragraph(_period_label(from_date, to_date), s['subtitle']),
    ]
    data = [['Ýurt', 'Şäher', 'Maşyn', 'Girdeji', 'Çykdajy', 'Marja', 'Marja %']]
    for r in rows:
        data.append([
            r.get('country_name', ''),
            r.get('city', ''),
            str(r.get('trucks', 0)),
            _money(r.get('revenue_usd')),
            _money(r.get('cost_usd')),
            _money(r.get('margin_usd')),
            _pct(r.get('margin_pct')),
        ])
    t = Table(data, repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)
    return flow


def _build_blocks(from_date: date, to_date: date) -> list:
    """Heatmap + production tables + export-market by block.

    Içerki Bazar and Sowgatlyk are intentionally absent (v1 scope).
    """
    s = _styles()
    heatmap = _aggregate_blocks_heatmap(from_date, to_date)
    prod_daily = _aggregate_production('daily', from_date, to_date)
    prod_seasonal = _aggregate_production('seasonal', from_date, to_date)
    export_market = _aggregate_export_market(from_date, to_date)

    flow = [
        Paragraph('Ýyladyşhanalar', s['title']),
        Paragraph(_period_label(from_date, to_date), s['subtitle']),
        Paragraph('Hasyl ýagdaýy (soňky 7 gün)', s['h2']),
    ]

    data = [['Blok', 'Plan KG', 'Fakt KG', '% planyň', 'Ýagdaý']]
    for r in heatmap:
        data.append([
            r.get('block_code', ''),
            _kg(r.get('plan_kg')),
            _kg(r.get('actual_kg')),
            _pct(r.get('pct')),
            r.get('color_band', ''),
        ])
    t = Table(data, repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)

    flow.extend([
        PageBreak(),
        Paragraph('Günlük önümçilik netijeleri', s['h2']),
    ])
    data = [['Ýyladyşhana', 'Meýill.-KG', 'Y.Y.-KG', '% (gün)', 'Aýlyk plan', 'Aýlyk fakt', '% (aý)']]
    for r in prod_daily:
        data.append([
            r.get('block_code', ''),
            _kg(r.get('plan_kg')),
            _kg(r.get('actual_kg')),
            _pct(r.get('pct')),
            _kg(r.get('monthly_plan_kg')),
            _kg(r.get('monthly_actual_kg')),
            _pct(r.get('monthly_pct')),
        ])
    t = Table(data, repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)

    flow.extend([
        Spacer(1, 6 * mm),
        Paragraph('Möwsümleýin önümçilik netijeleri', s['h2']),
    ])
    data = [['Ýyladyşhana', 'Meýill.-KG', 'Y.Y.-KG', '% (möw.)', 'Aýlyk plan', 'Aýlyk fakt', '% (aý)']]
    for r in prod_seasonal:
        data.append([
            r.get('block_code', ''),
            _kg(r.get('plan_kg')),
            _kg(r.get('actual_kg')),
            _pct(r.get('pct')),
            _kg(r.get('monthly_plan_kg')),
            _kg(r.get('monthly_actual_kg')),
            _pct(r.get('monthly_pct')),
        ])
    t = Table(data, repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)

    flow.extend([
        PageBreak(),
        Paragraph('Daşarky Bazar — blok boýunça', s['h2']),
        Paragraph('Içerki Bazar we Sowgatlyk soň goşulýar.', s['subtitle']),
    ])
    data = [['Ýyladyşhana', 'Daşarky Bazar (KG)', 'Daşarky Bazar (%)']]
    for r in export_market:
        data.append([
            r.get('block_code', ''),
            _kg(r.get('export_kg')),
            _pct(r.get('export_pct')),
        ])
    t = Table(data, colWidths=[55 * mm, 60 * mm, 45 * mm], repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)
    return flow


def _build_seasons(from_date: date, to_date: date) -> list:
    s = _styles()
    revenue = _aggregate_revenue(from_date, to_date)
    summary = _aggregate_summary(from_date, to_date)
    rev_kpi = summary.get('revenue', {})

    flow = [
        Paragraph('Möwsüm deňeşdirme', s['title']),
        Paragraph(_period_label(from_date, to_date), s['subtitle']),
        Paragraph(
            f'Häzirki möwsüm girdejisi: <b>{_money(rev_kpi.get("value"))}</b> '
            f'(üýtgeme {_pct(rev_kpi.get("delta_pct"))})',
            s['body'],
        ),
        Spacer(1, 6 * mm),
    ]
    cur = {r['week_start']: float(r['total_usd']) for r in revenue.get('current_season', [])}
    prev = {r['week_start']: float(r['total_usd']) for r in revenue.get('previous_season', [])}
    data = [['Hepde başlangyjy', 'Häzirki', 'Geçen', 'Tapawut']]
    for week in sorted(set(cur) | set(prev)):
        c = cur.get(week, 0)
        p = prev.get(week, 0)
        data.append([str(week), _money(c), _money(p), _money(c - p)])
    t = Table(data, colWidths=[40 * mm, 40 * mm, 40 * mm, 40 * mm], repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)
    return flow


def _build_audit(from_date: date, to_date: date) -> list:
    from apps.export.models import ShipmentStatusLog

    s = _styles()
    flow = [
        Paragraph('Audit log — soňky özgerişler', s['title']),
        Paragraph(_period_label(from_date, to_date), s['subtitle']),
    ]
    data = [['Wagty', 'Ulanyjy', 'Maşyn kody', 'Ýagdaý', 'Bellik']]
    qs = (
        ShipmentStatusLog.objects
        .filter(changed_at__date__gte=from_date, changed_at__date__lte=to_date)
        .select_related('shipment', 'changed_by', 'status')
        .order_by('-changed_at')[:200]
    )
    for log in qs:
        user = log.changed_by
        data.append([
            log.changed_at.strftime('%Y-%m-%d %H:%M'),
            (user.get_full_name() or user.username) if user else '',
            log.shipment.cargo_code if log.shipment_id else '',
            log.status.name_tk if log.status_id else '',
            (log.comment or '')[:60],
        ])
    t = Table(data, colWidths=[28 * mm, 35 * mm, 30 * mm, 35 * mm, 60 * mm], repeatRows=1)
    t.setStyle(_table_style())
    flow.append(t)
    return flow


# ---------------------------------------------------------------------------
# Public dispatch
# ---------------------------------------------------------------------------

_SECTIONS = {
    'monthly':         _build_monthly,
    'firms':           _build_firms,
    'routes':          _build_routes,
    'blocks':          _build_blocks,
    'seasons_compare': _build_seasons,
    'audit':           _build_audit,
}


def build_pdf(section: str, from_date: date, to_date: date) -> bytes:
    """Return a PDF document for the requested section as raw bytes.

    Args:
        section:   One of 'monthly' | 'firms' | 'routes' | 'blocks' |
                   'seasons_compare' | 'audit'.
        from_date: Inclusive start of the period.
        to_date:   Inclusive end of the period.

    Raises:
        ValueError: If the section name is not recognised.
    """
    builder = _SECTIONS.get(section)
    if builder is None:
        raise ValueError(f'Unknown export section: {section!r}')

    buf = BytesIO()
    page = landscape(A4) if section in ('routes', 'blocks', 'audit') else A4
    doc = SimpleDocTemplate(
        buf,
        pagesize=page,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=f'YGT Boss Dashboard — {section}',
    )
    flow = builder(from_date, to_date)
    doc.build(flow)
    return buf.getvalue()
