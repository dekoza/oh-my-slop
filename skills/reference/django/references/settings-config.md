---
domain: settings-config
category: configuration
priority: high
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: production experience
---

# Django Settings & Configuration Reference

Reusable Django 6.0 settings patterns for environment selection, secrets, storage, logging, and production hardening.

### 1. Select the active settings module with `DJANGO_SETTINGS_MODULE`
**Why**: One Django project can expose multiple settings modules while keeping `manage.py`, ASGI, and WSGI entrypoints predictable.

```python
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

DJANGO_SETTINGS_MODULE = os.environ["DJANGO_SETTINGS_MODULE"]
SETTINGS_NAME = DJANGO_SETTINGS_MODULE.rsplit(".", maxsplit=1)[-1]
IS_PRODUCTION = SETTINGS_NAME == "production"
```

**Warning**: A `local` fallback is convenient for development, but deployment should set `DJANGO_SETTINGS_MODULE` explicitly so production never boots with the wrong configuration.

### 2. Keep shared defaults in `base.py` and override them in `local.py` and `production.py`
**Why**: A small inheritance-based package is still the simplest structure when a project only needs base, development, and production variants.

```python
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DEBUG = False
ALLOWED_HOSTS = ["app.example.com"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# config/settings/local.py
from .base import *

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"


# config/settings/production.py
from .base import *

SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
```

**Warning**: `from .base import *` is acceptable for settings modules, but keep overrides short or you will lose track of where values come from.

### 3. Compose settings from components with `django-split-settings`
**Why**: Component-based settings work better when database, cache, logging, and third-party integrations evolve independently.

```python
from pathlib import Path

from split_settings.tools import include, optional

BASE_DIR = Path(__file__).resolve().parent.parent.parent

include(
    "components/base.py",
    "components/database.py",
    "components/cache.py",
    "components/logging.py",
    optional("components/local.py"),
)
```

**Warning**: Include order is stateful. A later component can silently overwrite earlier values, so treat component order as part of the public contract.

### 4. Use `python-decouple` for small, direct environment variable parsing
**Why**: `python-decouple` is lightweight and clear when the project mostly needs scalar values and a few lists.

```python
from decouple import Csv, config

SECRET_KEY = config("DJANGO_SECRET_KEY")
DEBUG = config("DJANGO_DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("DJANGO_ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())
EMAIL_PORT = config("EMAIL_PORT", default=25, cast=int)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
```

**Warning**: Without `cast=bool`, `cast=int`, or `Csv()`, every value is just a string and booleans like `False` will be misread as truthy text.

### 5. Use `django-environ` when the project relies on URL-based service configuration
**Why**: `django-environ` is stronger when you want one library to parse database, cache, and email-style connection strings.

```python
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

DEBUG = env("DJANGO_DEBUG")
DATABASES = {
    "default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
}
CACHES = {
    "default": env.cache("CACHE_URL", default="redis://127.0.0.1:6379/1"),
}
```

**Warning**: URL-based parsers are convenient, but they hide details. When you need backend-specific `OPTIONS`, inspect the final dict instead of assuming the parser handled everything.

### 6. Split `.env` files by environment and service, and keep tracked examples fake
**Why**: Separate files like `.envs/.local/.django` and `.envs/.production/.postgres` reduce secret sprawl and make rotation safer.

```python
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
(BASE_DIR / ".env.example").write_text(
    "DJANGO_SECRET_KEY=change-me\n"
    "DATABASE_URL=postgres://user:password@localhost:5432/app\n"
    "EMAIL_URL=smtp://user:password@localhost:587\n",
    encoding="utf-8",
)
(BASE_DIR / ".gitignore").write_text(
    ".env\n"
    ".env.*\n"
    ".envs/.production/\n",
    encoding="utf-8",
)
```

**Warning**: Never commit a real `.env` file. Only commit placeholder examples and ignore the secret-bearing files and production-only directories.

### 7. Prefer an explicit `DATABASES` dict before adding URL helpers
**Why**: The plain Django structure stays readable, makes backend options obvious, and is still the best starting point for PostgreSQL.

```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "app",
        "USER": "app",
        "PASSWORD": "unsafe-for-example-only",
        "HOST": "127.0.0.1",
        "PORT": "5432",
        "CONN_MAX_AGE": 600,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {
            "connect_timeout": 5,
            "options": "-c statement_timeout=5000",
        },
    }
}
```

**Warning**: Persistent connections are useful, but `CONN_MAX_AGE` without health checks or sane timeouts creates stale-connection failures that only appear under load.

### 8. Use `dj-database-url` when deployment already exposes a single `DATABASE_URL`
**Why**: Platform-style deployment often provides one connection string, and `dj-database-url` turns it into a Django dict with pooling settings.

```python
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}
DATABASES["default"]["OPTIONS"] = {
    "connect_timeout": 5,
    "options": "-c statement_timeout=5000",
}
```

**Warning**: Database URLs must be valid URLs. Passwords with characters like `#` or `@` must be URL-encoded or the parser will fail or misread credentials.

### 9. Define caches explicitly and namespace keys with `KEY_PREFIX`
**Why**: Django can use Redis, Memcached, and database-backed caches at the same time, but only if aliases and prefixes are deliberate.

```python
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": "redis://127.0.0.1:6379/1",
        "KEY_PREFIX": "store",
        "TIMEOUT": 300,
    },
    "sessions": {
        "BACKEND": "django.core.cache.backends.memcached.PyMemcacheCache",
        "LOCATION": "127.0.0.1:11211",
        "KEY_PREFIX": "sessions",
    },
    "reports": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "reports_cache",
        "KEY_PREFIX": "reports",
    },
}
CACHE_MIDDLEWARE_ALIAS = "default"
CACHE_MIDDLEWARE_KEY_PREFIX = "pages"
```

**Warning**: If multiple environments share the same Redis or Memcached server and you omit `KEY_PREFIX`, cache collisions become a deployment bug instead of a code bug.

### 10. Switch email backends by environment and isolate production providers
**Why**: Local development wants console output, simpler deployments may use SMTP, and production often benefits from a provider backend like Anymail.

```python
DEBUG = False
USE_SMTP = False
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
]

if DEBUG:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
elif USE_SMTP:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = "smtp.example.com"
    EMAIL_PORT = 587
    EMAIL_HOST_USER = "mailer"
    EMAIL_HOST_PASSWORD = "unsafe-for-example-only"
    EMAIL_USE_TLS = True
else:
    INSTALLED_APPS.append("anymail")
    EMAIL_BACKEND = "anymail.backends.mailgun.EmailBackend"
    ANYMAIL = {"MAILGUN_API_KEY": "unsafe-for-example-only"}

DEFAULT_FROM_EMAIL = "noreply@example.com"
SERVER_EMAIL = "errors@example.com"
```

**Warning**: Do not keep SMTP passwords or ESP API keys in committed settings modules. Email credentials belong in environment variables or a secret manager.

### 11. Use `STORAGES` to separate static files from media files
**Why**: Django 6.0 projects should prefer the `STORAGES` dict so static assets and user uploads can evolve independently.

```python
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DEBUG = False
STATIC_URL = "/static/"
MEDIA_URL = "/media/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
MEDIA_ROOT = BASE_DIR / "media"
CLOUD_MEDIA_BACKEND = "storages.backends.s3.S3Storage"
# CLOUD_MEDIA_BACKEND = "storages.backends.gcloud.GoogleCloudStorage"
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
]

STORAGES = {
    "default": {
        "BACKEND": CLOUD_MEDIA_BACKEND if not DEBUG else "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
```

**Warning**: WhiteNoise belongs directly after `SecurityMiddleware` and only serves static files. User-uploaded media still needs a separate storage backend.

### 12. Build a `LOGGING` dict first, then layer `structlog` on top
**Why**: Django still uses standard logging internally, so structured logging works best when the stdlib configuration remains explicit.

```python
import structlog

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": structlog.stdlib.ProcessorFormatter,
            "processor": structlog.processors.JSONRenderer(),
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        }
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
)
```

**Warning**: Avoid double-rendering the same event through both `ProcessorFormatter` and a second JSON renderer in the wrong place, or you will log JSON strings inside JSON strings.

### 13. Turn on HTTPS and secure cookie settings together in production
**Why**: Security settings are interdependent; enabling one secure flag while forgetting the surrounding HTTPS assumptions creates broken or misleading protection.

```python
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_TRUSTED_ORIGINS = ["https://app.example.com"]
```

**Warning**: Only set `SECURE_PROXY_SSL_HEADER` when a trusted proxy really sets that header. If you guess here, you can weaken request security instead of hardening it.

### 14. Pin `DEFAULT_AUTO_FIELD` to `BigAutoField` in Django 6.0 projects
**Why**: Django 6.0 defaults new implicit primary keys to `BigAutoField`, so setting it explicitly keeps intent obvious across apps and migrations.

```python
from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


class Category(models.Model):
    name = models.CharField(max_length=100)


class Product(models.Model):
    name = models.CharField(max_length=200)
    category = models.ForeignKey(Category, on_delete=models.CASCADE)


class Order(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
```

**Warning**: Changing `DEFAULT_AUTO_FIELD` after a project already shipped can trigger noisy migrations, and existing auto-created many-to-many through tables do not upgrade cleanly by magic.

### 15. Read settings through the lazy proxy and override them in tests
**Why**: Importing `django.conf.settings` keeps consumers decoupled from a concrete module path and makes test overrides straightforward.

```python
from django.conf import settings
from django.test import SimpleTestCase, override_settings


def featured_product_limit() -> int:
    return getattr(settings, "FEATURED_PRODUCT_LIMIT", 12)


class FeaturedProductLimitTests(SimpleTestCase):
    @override_settings(FEATURED_PRODUCT_LIMIT=4)
    def test_override_featured_limit(self):
        self.assertEqual(featured_product_limit(), 4)
```

**Warning**: Do not import `config.settings.production` directly from application code. That breaks lazy loading, test isolation, and alternate settings modules.

### 16. Guard dev-only integrations with `try/except ImportError`
**Why**: Optional development tools should never crash production because a package is intentionally missing there.

```python
DEBUG = True
INSTALLED_APPS = ["django.contrib.staticfiles"]
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware"]

if DEBUG:
    try:
        import debug_toolbar
    except ImportError:
        debug_toolbar = None
    else:
        INSTALLED_APPS.append("debug_toolbar")
        MIDDLEWARE.insert(0, "debug_toolbar.middleware.DebugToolbarMiddleware")
```

**Warning**: Optional means optional. If production imports a dev-only package at module import time, startup fails before Django can even report a configuration problem cleanly.
