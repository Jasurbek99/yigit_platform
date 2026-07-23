# Pre-Production Hardening Checklist

Things that are **intentionally deferred during active development** and MUST be
done before the platform is treated as production (not just internal beta).

Add items here instead of fixing them mid-development when a change is only safe
once the build has settled.

## Security / DoS

- [ ] **Turn off `DJANGO_DEBUG` in production.** Currently `DJANGO_DEBUG=True`
      in [`docker-compose.prod.yml`](../docker-compose.prod.yml) (kept True during
      development). Risks while on: Django keeps **every** SQL query in process
      memory → slow memory growth under load (a gradual DoS); leaks stack traces /
      settings on errors; forces `ALLOWED_HOSTS=['*']` + `CORS_ALLOW_ALL_ORIGINS`
      (see the `if DEBUG:` block in [`settings.py`](../backend/config/settings.py)).
      When flipping to `False`: wire `/static/` through the frontend nginx (Django
      admin renders unstyled without it — the original reason DEBUG was left on),
      set a real `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`.
      **Do this once the build has settled — deferred by owner decision (2026-07-22).**

- [ ] **PDF generation must not run in the request cycle.** LibreOffice renders
      block a worker for up to ~120s; with only 3 uvicorn workers a few concurrent
      PDF requests stall the whole API. Move to an async job / queue or a bounded
      concurrency limit. (Tracked separately — see the design note when written.)
