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

# Path to the LibreOffice binary used to convert generated .docx → PDF
# (apps/contracts/services/document_render.py). Empty by default: in the Docker
# image `soffice`/`libreoffice` is on PATH (installed via the Dockerfile), so the
# render service auto-discovers it. Set this on a dev box where LibreOffice is
# installed but not on PATH, e.g. on Windows:
#   LIBREOFFICE_BIN=C:\Program Files\LibreOffice\program\soffice.exe
LIBREOFFICE_BIN = os.environ.get('LIBREOFFICE_BIN', '')

# ════════════════════════════════════════════════
# Error tracking (Sentry)
#
# Initialised as early as possible so errors during the rest of settings
# load are still captured. DSN is read from the environment with a default
# baked in; set SENTRY_DSN='' to disable (e.g. in CI).
# Only active in production (DEBUG=False) — never reports from local dev.
# The DSN points at Sentry's EU (de) region — keeps event data in the EU,
# which matters for our KZ/RU users.
# ════════════════════════════════════════════════
SENTRY_DSN = os.environ.get(
    'SENTRY_DSN',
    'https://d2b0cd886918386f1fdbb1f4723e0e52@o4507190478438400.ingest.de.sentry.io/4511556283007056',
)

if SENTRY_DSN and not DEBUG:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.environ.get('SENTRY_ENVIRONMENT', 'production' if not DEBUG else 'development'),
        # Add data like request headers and IP for users,
        # see https://docs.sentry.io/platforms/python/data-management/data-collected/ for more info
        send_default_pii=True,
        # Performance tracing — off by default to protect quota; raise via env when needed.
        traces_sample_rate=float(os.environ.get('SENTRY_TRACES_SAMPLE_RATE', '0.0')),
    )

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
    'apps.transport',
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
# Cache — shared across gunicorn/uvicorn workers via Redis
# ════════════════════════════════════════════════
# The django-axes brute-force lockout counters and the 60s API caches
# (team-kpi, dashboard, me/kpi-today) live here. LocMemCache is per-process, so
# with 3 uvicorn workers a shared Redis backend is REQUIRED for the lockout
# counters to be consistent (and it upgrades those API caches from per-worker
# to shared). Same fallback rule as the channel layer above: LocMem for tests
# and for DEBUG dev that hasn't set REDIS_URL.
if RUNNING_TESTS or (DEBUG and not _REDIS_URL_ENV):
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': REDIS_URL,
            'KEY_PREFIX': 'ygt',
        }
    }

# ════════════════════════════════════════════════
# Auth
# ════════════════════════════════════════════════
AUTH_USER_MODEL = 'core.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 8}},
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
    # Flood / DoS backstop — caps total request RATE (django-axes only caps
    # failed logins). Proxy-aware so the anon bucket keys on the real client IP
    # behind nginx (see apps/core/throttling.py). Counters live in the shared
    # Redis cache, so the limit holds across all workers.
    'DEFAULT_THROTTLE_CLASSES': [
        'apps.core.throttling.ProxyAwareAnonThrottle',
        'apps.core.throttling.ProxyAwareUserThrottle',
    ],
    # None under tests so the existing suite is unaffected; generous in prod —
    # a backstop against abuse, not a limiter of normal use. Tune via env.
    'DEFAULT_THROTTLE_RATES': {
        'anon': None if RUNNING_TESTS else os.environ.get('THROTTLE_ANON', '120/min'),
        'user': None if RUNNING_TESTS else os.environ.get('THROTTLE_USER', '1200/min'),
    },
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
# Brute-force lockout (django-axes) — escalating ladder
# ════════════════════════════════════════════════
# Locks the (username, IP) pair on repeated failed logins. Disabled under tests
# by default so the existing auth suite is unaffected; the lockout tests opt in
# with @override_settings(AXES_ENABLED=True). See apps/core/security_axes.py.
AXES_ENABLED = not RUNNING_TESTS

INSTALLED_APPS += ['axes']
AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',   # MUST be first — blocks locked-out users
    'django.contrib.auth.backends.ModelBackend',
]
MIDDLEWARE += ['axes.middleware.AxesMiddleware']   # MUST be last

AXES_FAILURE_LIMIT = 3
# Lock on the (username, IP) combination: resists distributed guessing against
# one account AND a single IP spraying many accounts, without letting an
# attacker lock a victim out purely by knowing their username.
AXES_LOCKOUT_PARAMETERS = [['username', 'ip_address']]
# Escalating block length: 30 min -> 5 h -> 1 day per episode. The callable is
# side-effect free; the tier counter lives in the Redis cache.
AXES_COOLOFF_TIME = 'apps.core.security_axes.escalating_cooloff'
# Attempts made DURING an active block neither count nor extend the timer — this
# is what makes each escalation tier grant a fresh 3 attempts, and it lets us
# tell a threshold-crossing apart from a blocked-during-lockout request.
AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT = False
AXES_RESET_ON_SUCCESS = True                 # (also reset explicitly in LoginView; JWT login skips Django login())
AXES_ENABLE_ACCESS_FAILURE_LOG = True        # keep the per-attempt audit trail (admin-visible)
AXES_LOCKOUT_CALLABLE = 'apps.core.security_axes.lockout_response'
AXES_HTTP_RESPONSE_CODE = 429
# Real client IP from nginx's X-Real-IP (see frontend/nginx.conf); checked before
# django-ipware so it works regardless of whether ipware is installed.
AXES_CLIENT_IP_CALLABLE = 'apps.core.security_axes.client_ip'

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