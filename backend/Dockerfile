FROM python:3.12-slim

# Install ODBC Driver 18 for SQL Server
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg2 apt-transport-https \
    && curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && curl https://packages.microsoft.com/config/debian/12/prod.list > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 unixodbc-dev \
    && rm -rf /var/lib/apt/lists/*

# Relax OpenSSL TLS policy so the driver can complete the (always-encrypted)
# SQL Server login handshake. The on-prem server only offers legacy TLS, which
# OpenSSL 3's default security level rejects ("unsupported protocol"). Lower the
# floor to TLSv1.0 / SECLEVEL=0 — acceptable on the trusted LAN to 10.10.11.233.
RUN sed -i '/^\[openssl_init\]/a ssl_conf = ssl_sect' /etc/ssl/openssl.cnf \
    && printf '\n[ssl_sect]\nsystem_default = system_default_sect\n\n[system_default_sect]\nMinProtocol = TLSv1\nCipherString = DEFAULT@SECLEVEL=0\n' >> /etc/ssl/openssl.cnf

# LibreOffice headless — converts generated documents → PDF (contracts document
# generation, apps/contracts/services/document_render.py). `libreoffice-writer`
# handles the .docx documents (invoice / letters / contract); `libreoffice-calc`
# is REQUIRED for the CMR, which is an .xlsx print-overlay — without it xlsx→PDF
# fails with "LibreOffice not found"/no filter and the CMR PDF button errors.
# The font packages give proper Cyrillic + Latin-extended coverage so the
# Russian/Turkmen documents render real glyphs instead of tofu boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-calc \
    fonts-dejavu fonts-liberation fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

# BUILD CONTEXT IS THE REPO ROOT, not backend/ (docker-compose.yml sets
# `context: .` + `dockerfile: backend/Dockerfile`). The context was widened so
# `docs/how_works` — which lives outside backend/ — can be baked in; every COPY
# below must therefore be written repo-relative.
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Process-explainer documents for the boss dashboard + BPMN click-through
# (apps/export/views_analytics.py). `docs/how_works/` is the single editable
# source of truth in the repo; this is a build-time SNAPSHOT of it, so there is
# no second tracked copy to drift.
# Deliberately outside /app: the dev compose bind-mounts `./backend:/app`, which
# would hide anything placed under /app that does not exist in backend/ on the
# host. PROCESS_DOCS_DIR tells Django where the snapshot landed (config/settings.py).
COPY docs/how_works /opt/ygt/docs/how_works
ENV PROCESS_DOCS_DIR=/opt/ygt/docs/how_works

RUN python manage.py collectstatic --noinput || true

EXPOSE 8000
# gunicorn supervises uvicorn workers — uvicorn speaks ASGI for both
# `/api/` HTTP and `/ws/` WebSocket on the same port. wsgi.py is now unused.
# --timeout 180: document PDF generation shells out to LibreOffice, which
# render_pdf lets run up to 120s. gunicorn's 30s default could reap the worker
# mid-conversion, dropping the connection with NO response — the client then
# spins forever. Keep this ABOVE render_pdf's 120s so LibreOffice's own timeout
# fires first and the user gets a real 503 instead of a hang.
CMD ["gunicorn", "config.asgi:application", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "180"]
