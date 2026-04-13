from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from apps.core.models import (
    User, Country, City, ExportFirm, ImportFirm,
    ShipmentStatusType, ShipmentOptionType, Season, GreenhouseBlock,
    TomatoVariety, ProductType, BorderPoint, LoadingLocation, Customer,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (
        ('YGT Fields', {'fields': ('role', 'phone', 'telegram_chat_id')}),
    )
    list_display = ['username', 'email', 'first_name', 'last_name', 'role', 'is_active']
    list_filter = ['role', 'is_active']


@admin.register(ShipmentStatusType)
class ShipmentStatusTypeAdmin(admin.ModelAdmin):
    list_display = ['step_order', 'code', 'name_en', 'required_role', 'phase']
    ordering = ['step_order']


@admin.register(Country)
class CountryAdmin(admin.ModelAdmin):
    list_display = ['code', 'name_en', 'name_tk', 'name_ru']


@admin.register(ExportFirm)
class ExportFirmAdmin(admin.ModelAdmin):
    list_display = ['code', 'name_en', 'name_tk', 'is_active']
    list_filter = ['is_active']


@admin.register(ImportFirm)
class ImportFirmAdmin(admin.ModelAdmin):
    list_display = ['code', 'name_company', 'name_short', 'country', 'is_active']


@admin.register(GreenhouseBlock)
class GreenhouseBlockAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'location', 'variety_main', 'is_active']


admin.site.register(City)
admin.site.register(Season)
admin.site.register(TomatoVariety)
admin.site.register(ProductType)
admin.site.register(BorderPoint)
admin.site.register(LoadingLocation)


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'default_country', 'is_active']
    list_filter = ['is_active']
    search_fields = ['name']


@admin.register(ShipmentOptionType)
class ShipmentOptionTypeAdmin(admin.ModelAdmin):
    list_display = ['category', 'code', 'label_tk', 'label_en', 'sort_order', 'is_active']
    list_filter = ['category', 'is_active']
    ordering = ['category', 'sort_order']
