from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    # Export auth overrides must come before core auth so /me/ and /login/
    # resolve to the extended views that include managed_block_ids.
    path('api/v1/auth/', include('apps.export.urls_auth')),
    path('api/v1/auth/', include('apps.core.urls.auth')),
    path('api/v1/core/', include('apps.core.urls.core')),
    path('api/v1/greenhouse/', include('apps.greenhouse.urls')),
    path('api/v1/export/', include('apps.export.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
