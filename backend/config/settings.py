import os
from pathlib import Path
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'django-insecure-dev-key-change-in-production-ygt-platform-2025')

DEBUG = os.environ.get('DJANGO_DEBUG', 'True') == 'True'

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1,backend').split(',')

# ════════════════════════════════════════════════
# Applications
# ════════════════════════════════════════════════
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'django_filters',
    'corsheaders',
    # Project apps
    'apps.core',
    'apps.greenhouse',
    'apps.export',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# ════════════════════════════════════════════════
# Database — MSSQL in Docker / SQLite for local dev
# Set USE_SQLITE=true to use SQLite (no ODBC driver needed)
# ════════════════════════════════════════════════
if os.environ.get('USE_SQLITE', 'false').lower() == 'true':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

    # When running Django tests under USE_SQLITE=true, many existing migrations
    # contain MSSQL-specific RunSQL blocks that break on SQLite. Bypass them by
    # having Django create tables directly from models (syncdb-style).
    # The Cyrillic_General_CI_AS collation stub is registered by the test runner.
    MIGRATION_MODULES = {app: None for app in [
        'admin', 'auth', 'contenttypes', 'sessions', 'token_blacklist',
        'core', 'greenhouse', 'export',
    ]}
else:
    _db_name = os.environ.get('DB_NAME', 'YIGIT_PLATFROM')
    DATABASES = {
        'default': {
            'ENGINE': 'mssql',
            'NAME': _db_name,
            'USER': os.environ.get('DB_USER', 'YigitUser'),
            'PASSWORD': os.environ.get('DB_PASSWORD', '321drowssap!'),
            'HOST': os.environ.get('DB_HOST', r'10.10.11.233\YIGIT'),
            'PORT': os.environ.get('DB_PORT', ''),
            'OPTIONS': {
                'driver': 'ODBC Driver 18 for SQL Server',
                'extra_params': 'TrustServerCertificate=yes',
            },
            # YigitUser lacks CREATE DATABASE permission on the MSSQL server.
            # Point tests at the existing database. Django wraps each test in a
            # transaction that is rolled back — data is not persisted.
            'TEST': {
                'NAME': os.environ.get('TEST_DB_NAME', _db_name),
            },
        }
    }

# ════════════════════════════════════════════════
# Test runner — registers Cyrillic collation stub for SQLite test runs
# ════════════════════════════════════════════════
TEST_RUNNER = 'config.test_runner.CyrillicSQLiteTestRunner'

# ════════════════════════════════════════════════
# Auth
# ════════════════════════════════════════════════
AUTH_USER_MODEL = 'core.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ════════════════════════════════════════════════
# REST Framework
# ════════════════════════════════════════════════
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'apps.core.authentication.CookieJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'apps.core.pagination.StandardPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'EXCEPTION_HANDLER': 'apps.core.exceptions.custom_exception_handler',
}

# ════════════════════════════════════════════════
# JWT — httpOnly cookie (AD-auth)
# ════════════════════════════════════════════════
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_COOKIE': 'access_token',
    'AUTH_COOKIE_REFRESH': 'refresh_token',
    'AUTH_COOKIE_HTTP_ONLY': True,
    'AUTH_COOKIE_SAMESITE': 'Lax',
    'AUTH_COOKIE_SECURE': not DEBUG,
}

# ════════════════════════════════════════════════
# CORS
# ════════════════════════════════════════════════
CORS_ALLOWED_ORIGINS = os.environ.get(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:3000'
).split(',')
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = os.environ.get(
    'CSRF_TRUSTED_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:3000'
).split(',')

# ════════════════════════════════════════════════
# Internationalisation
# ════════════════════════════════════════════════
LANGUAGE_CODE = 'tk'
TIME_ZONE = 'Asia/Ashgabat'
USE_I18N = True
USE_TZ = True

# ════════════════════════════════════════════════
# Static / Media
# ════════════════════════════════════════════════
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'static'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ════════════════════════════════════════════════
# Logging
# ════════════════════════════════════════════════
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django.db.backends': {
            'handlers': ['console'],
            'level': 'DEBUG' if DEBUG else 'WARNING',
            'propagate': False,
        },
    },
}

# ════════════════════════════════════════════════
# Local network dev override
# Opens up ALLOWED_HOSTS, CORS, and CSRF so any device on the
# LAN (including when host PC runs a VPN) can reach the server.
# Safe: only active when DEBUG=True.
# ════════════════════════════════════════════════
if DEBUG:
    ALLOWED_HOSTS = ['*']
    CORS_ALLOW_ALL_ORIGINS = True
    CSRF_TRUSTED_ORIGINS += [
        'http://10.10.0.0',    # 10.10.x.x LAN
        'http://10.0.0.0',     # 10.0.x.x
        'http://192.168.0.0',  # 192.168.x.x
        'http://172.16.0.0',   # 172.16.x.x
    ]
