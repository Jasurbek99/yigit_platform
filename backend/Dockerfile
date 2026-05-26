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
    && printf '\n[ssl_sect]\nsystem_default = system_default_sect\n\n[system_default_sect]\nMinProtocol = TLSv1.0\nCipherString = DEFAULT@SECLEVEL=0\n' >> /etc/ssl/openssl.cnf

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python manage.py collectstatic --noinput || true

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
