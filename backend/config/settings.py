import os
import sys
from pathlib import Path
from datetime import timedelta

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment from backend/.env. Real env vars (set by shell or
# docker-compose) take precedence over the file.
load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.environ.get('SECRET_KEY', 'django-insecure-dev-key-change-in-production-ygt-platform-2025')

DEBUG = os.environ.get('DJANGO_DEBUG', 'True') == 'True'

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1,backend').split(',')

# ════════════════════════════════════════════════
# Applications
# ════════════════════════════════════════════════
INSTALLED_APPS = [
    # daphne MUST come before staticfiles so Channels' runserver hook
    # replaces Django's WSGI runserver with the ASGI one. Production runs
    # uvicorn workers under gunicorn (see Dockerfile); daphne is only used
    # by `manage.py runserver` in dev and by channels.testing.
    'daphne',
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
    'channels',
    # Project apps
    'apps.core',
    'apps.greenhouse',
    'apps.export',
    'apps.contracts',
    'apps.feedback',
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
ASGI_APPLICATION = 'config.asgi.application'

# ════════════════════════════════════════════════
# Database
#
# Two modes:
#   1. Production / dev (default):
#        MSSQL on 10.10.11.233\YIGIT, database YIGIT_PLATFROM
#        User: YigitUser (limited rights, no CREATE DATABASE)
#        Used by: runserver, migrate, all normal app operations
#        Tests NEVER run here — TEST block intentionally omitted.
#
#   2. Tests (auto-detected when running `manage.py test` or pytest):
#        MSSQL on local server, database test_YIGIT_PLATFROM
#        User: YigitTestUser (full rights including CREATE DATABASE)
#        Django creates / drops / re-uses this database automatically.
# ════════════════════════════════════════════════

# Detect test mode — covers both `manage.py test` and pytest
RUNNING_TESTS = (
    'test' in sys.argv
    or any('pytest' in arg for arg in sys.argv)
    or os.environ.get('DJANGO_TESTING') == 'true'
)

if RUNNING_TESTS:
    # Tests run on a separate local MSSQL server.
    # YigitTestUser has full permissions — Django manages test_YIGIT_PLATFROM lifecycle.
    _test_db_name = os.environ.get('TEST_DB_NAME', 'test_YIGIT_PLATFROM')
    DATABASES = {
        'default': {
            'ENGINE': 'mssql',
            'NAME': _test_db_name,
            'USER': os.environ.get('TEST_DB_USER', 'YigitTestUser'),
            'PASSWORD': os.environ.get('TEST_DB_PASSWORD', 'TestPassword123!'),
            'HOST': os.environ.get('TEST_DB_HOST', r'localhost'),
            'PORT': os.environ.get('TEST_DB_PORT', ''),
            'OPTIONS': {
                'driver': 'ODBC Driver 18 for SQL Server',
                'extra_params': 'TrustServerCertificate=yes',
            },
            'TEST': {
                'NAME': _test_db_name,
                'COLLATION': 'Cyrillic_General_CI_AS',
            },
        }
    }

else:
    # Production / dev — real MSSQL server.
    # No TEST block: tests must NEVER run against this database.
    # DB_PASSWORD must come from .env or the environment — no default.
    _db_password = os.environ.get('DB_PASSWORD')
    if not _db_password:
        raise RuntimeError(
            "DB_PASSWORD is not set. Copy .env.example to .env and fill in DB_PASSWORD, "
            "or export it in your shell."
        )
    _db_name = os.environ.get('DB_NAME', 'YIGIT_PLATFROM_NEW')
    # ODBC connection extras. Default keeps current dev behavior. In Docker on
    # Linux (OpenSSL 3) the SQL Server's old TLS is rejected ("unsupported
    # protocol"), so the deploy sets DB_EXTRA_PARAMS with Encrypt=no over the
    # trusted LAN. Windows dev keeps the default and connects unchanged.
    _db_extra_params = os.environ.get('DB_EXTRA_PARAMS', 'TrustServerCertificate=yes')
    DATABASES = {
        'default': {
            'ENGINE': 'mssql',
            'NAME': _db_name,
            'USER': os.environ.get('DB_USER', 'YigitUser'),
            'PASSWORD': _db_password,
            'HOST': os.environ.get('DB_HOST', r'10.10.11.233\YIGIT'),
            'PORT': os.environ.get('DB_PORT', ''),
            'OPTIONS': {
                'driver': 'ODBC Driver 18 for SQL Server',
                'extra_params': _db_extra_params,
            },
        }
    }

# ════════════════════════════════════════════════
# Channels (WebSocket)
# ════════════════════════════════════════════════
# Redis-backed channel layer is required for cross-worker group broadcast
# (presence roster needs every uvicorn worker to see the same room). But it
# would force every developer to also run Redis locally just to log in — so
# we fall back to the in-memory layer when:
#   * tests are running, OR
#   * DEBUG is True AND REDIS_URL was NOT set explicitly in the environment
# In docker-compose REDIS_URL is set in the backend service's env, so prod /
# beta / docker dev all use Redis as intended.
_REDIS_URL_ENV = os.environ.get('REDIS_URL')
REDIS_URL = _REDIS_URL_ENV or 'redis://127.0.0.1:6379/0'

_USE_INMEMORY_CHANNELS = RUNNING_TESTS or (DEBUG and not _REDIS_URL_ENV)
if _USE_INMEMORY_CHANNELS:
    CHANNEL_LAYERS = {
        'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [REDIS_URL]},
        },
    }

# ════════════════════════════════════════════════
# Auth
# ════════════════════════════════════════════════
AUTH_USER_MODEL = 'core.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 5}},
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
# Email (Feedback Module)
#
# In development, EMAIL_BACKEND defaults to the console backend so all
# outbound email is printed to stdout — no SMTP server required.
# In production, set EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
# plus the SMTP credentials via env vars.
# ════════════════════════════════════════════════
EMAIL_BACKEND = os.environ.get(
    'EMAIL_BACKEND',
    'django.core.mail.backends.console.EmailBackend',
)
EMAIL_HOST = os.environ.get('EMAIL_HOST', '')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587') or '587')
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True') == 'True'
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'noreply@ygt.local')

# Feedback Module settings
# FEEDBACK_ADMIN_EMAIL: optional shared mailbox appended to the admin recipient list.
# PLATFORM_URL: base URL used in email deep-links (e.g. http://10.10.11.x:8080).
#   Leave blank in dev — the email body will omit the URL line rather than
#   render a broken link.
FEEDBACK_ADMIN_EMAIL = os.environ.get('FEEDBACK_ADMIN_EMAIL', '')
PLATFORM_URL = os.environ.get('PLATFORM_URL', '')

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