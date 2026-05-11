from django.contrib import admin
from apps.export.models import (
    Shipment,
    ShipmentStatusLog,
    ShipmentFirmSplit,
    ShipmentBlockSource,
    ShipmentComment,
    Notification,
    AuditLog,
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
    # (loading_started_at and departed_at are operator-entered now, so they stay editable here.)
    readonly_fields = [
        'customs_entry_at',
        'customs_exit_at',
        'border_crossed_at',
        'arrived_at',
        'sale_started_at',
        'sale_ended_at',
        'created_at',
        'updated_at',
    ]


admin.site.register(ShipmentStatusLog)
admin.site.register(ShipmentComment)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ['user', 'kind', 'message', 'read_at', 'created_at']
    list_filter = ['kind', 'read_at']
    search_fields = ['message', 'user__username']
    readonly_fields = ['created_at']


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ['action', 'model_name', 'object_repr', 'user', 'created_at']
    list_filter = ['action', 'model_name']
    search_fields = ['object_repr', 'detail', 'user__username']
    readonly_fields = ['user', 'action', 'model_name', 'object_id', 'object_repr', 'detail', 'created_at']

    def has_add_permission(self, request):
        # Audit log entries are immutable — created only by services.
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
