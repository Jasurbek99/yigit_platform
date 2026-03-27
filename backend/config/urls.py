from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/auth/', include('apps.core.urls.auth')),
    path('api/v1/core/', include('apps.core.urls.core')),
    path('api/v1/export/', include('apps.export.urls')),
]
