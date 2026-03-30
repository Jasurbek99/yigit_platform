from django.contrib import admin
from apps.export.models import (
    Shipment,
    ShipmentStatusLog,
    ShipmentFirmSplit,
    ShipmentBlockSource,
    ShipmentComment,
)


class ShipmentFirmSplitInline(admin.TabularInline):
    model = ShipmentFirmSplit
    extra = 0


class ShipmentBlockSourceInline(admin.TabularInline):
    model = ShipmentBlockSource
    extra = 0


@admin.register(Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ['cargo_code', 'date', 'country', 'customer', 'status', 'weight_net', 'departed_at']
    list_filter = ['status', 'country', 'season', 'is_gapy_satys']
    search_fields = ['cargo_code']
    inlines = [ShipmentFirmSplitInline, ShipmentBlockSourceInline]
    # AD-2: vehicle_status_note is DEPRECATED — excluded to prevent new data entry
    exclude = ['vehicle_status_note']
    # AD-1 timestamps are written only by transition_to() — never editable in admin.
    readonly_fields = [
        'loading_started_at',
        'customs_entry_at',
        'customs_exit_at',
        'departed_at',
        'border_crossed_at',
        'arrived_at',
        'sale_started_at',
        'sale_ended_at',
        'created_at',
        'updated_at',
    ]


admin.site.register(ShipmentStatusLog)
admin.site.register(ShipmentComment)
