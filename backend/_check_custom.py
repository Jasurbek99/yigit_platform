from apps.export.models import SheetRowSetting
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

default_keys = {r['field_key'] for r in DEFAULT_SHEET_ROWS}
qs = SheetRowSetting.objects.filter(deleted_at__isnull=True, is_visible=True).order_by('display_order')
print(f"total visible settings: {qs.count()}")
for i, s in enumerate(qs):
    marker = "CUSTOM" if s.is_custom else ("default" if s.field_key in default_keys else "??ORPHAN??")
    print(f"{i:3d}  order={s.display_order:<8} fk={s.field_key:<35} custom={s.is_custom!s:<5} role_group={s.role_group or '(blank)':<20} who_tk={s.who_tk!r}")
