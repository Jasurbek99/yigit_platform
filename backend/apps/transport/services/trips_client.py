"""Client for the Planning trips API (contract: planning-integration-api.v1.yaml).

Mirrors traccar_client.py. MockTripsClient has the same surface and is used
when TRANSPORT_API_MODE=mock so a demo never depends on 10.10.11.79.
"""
import json
import logging
from datetime import datetime
from pathlib import Path

import requests
from django.conf import settings
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15
FIXTURE_PATH = Path(__file__).resolve().parent.parent / 'fixtures' / 'external_trips.json'
# Smallest valid one-page PDF — the mock "trip documents" sheet.
MOCK_PDF = (
    b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    b'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    b'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n'
    b'trailer<</Root 1 0 R>>\n%%EOF\n'
)


class TripsApiUnavailable(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class TripsClient:
    is_mock = False

    def __init__(self) -> None:
        self.base_url = settings.TRANSPORT_API_URL.rstrip('/')
        key = (settings.TRANSPORT_API_KEY or '').strip()
        self.key = key[len('Bearer '):] if key.startswith('Bearer ') else key

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        headers = {'Accept': 'application/json', 'Authorization': f'Bearer {self.key}'}
        headers.update(kwargs.pop('headers', {}))
        try:
            return requests.request(
                method, f'{self.base_url}{path}', headers=headers,
                timeout=TIMEOUT_SECONDS, verify=settings.TRANSPORT_API_VERIFY_TLS, **kwargs,
            )
        except requests.RequestException as exc:
            logger.warning('Planning API %s %s failed: %s', method, path, exc)
            raise TripsApiUnavailable(str(exc)) from exc

    def _get_ok(self, path: str, **kwargs) -> requests.Response:
        response = self._request('GET', path, **kwargs)
        if response.status_code != 200:
            raise TripsApiUnavailable(f'GET {path} → {response.status_code}', response.status_code)
        return response

    def list_trips(self, changed_since: datetime | None, page: int, page_size: int = 200) -> dict:
        params = {'page': page, 'pageSize': page_size}
        if changed_since:
            params['changedSince'] = changed_since.isoformat()
        return self._get_ok('/trips', params=params).json()

    def get_trip(self, trip_uuid: str) -> dict:
        return self._get_ok(f'/trips/{trip_uuid}').json()

    def get_document(self, trip_uuid: str) -> bytes:
        return self._get_ok(f'/trips/{trip_uuid}/document', headers={'Accept': 'application/pdf'}).content

    def post_op(self, trip_uuid: str, op: str, body: dict, idempotency_key: str) -> tuple[int, dict]:
        response = self._request(
            'POST', f'/trips/{trip_uuid}/{op}', json=body,
            headers={'Idempotency-Key': idempotency_key, 'Content-Type': 'application/json'},
        )
        if response.status_code >= 500:
            raise TripsApiUnavailable(f'POST {op} → {response.status_code}', response.status_code)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        return response.status_code, payload


class MockTripsClient:
    is_mock = True

    def _items(self) -> list[dict]:
        return json.loads(FIXTURE_PATH.read_text(encoding='utf-8'))['items']

    def list_trips(self, changed_since: datetime | None, page: int, page_size: int = 200) -> dict:
        items = [
            i for i in self._items()
            if changed_since is None or parse_datetime(i['changedAt']) > changed_since
        ]
        items.sort(key=lambda i: (i['changedAt'], i['integrationTripId']))
        start = (page - 1) * page_size
        return {'items': items[start:start + page_size], 'total': len(items), 'page': page, 'pageSize': page_size}

    def get_trip(self, trip_uuid: str) -> dict:
        return next(i for i in self._items() if i['integrationTripId'] == trip_uuid)

    def get_document(self, trip_uuid: str) -> bytes:
        return MOCK_PDF

    def post_op(self, trip_uuid: str, op: str, body: dict, idempotency_key: str) -> tuple[int, dict]:
        logger.info('MOCK push %s %s key=%s body=%s', trip_uuid, op, idempotency_key, body)
        return 200, {'accepted': True, 'duplicate': False}


def get_trips_client() -> TripsClient | MockTripsClient:
    return MockTripsClient() if settings.TRANSPORT_API_MODE == 'mock' else TripsClient()
