import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15


class TraccarUnavailable(Exception):
    """Raised when Traccar cannot be reached or returns an error."""


class TraccarClient:
    """Read-only wrapper over the Traccar REST API.

    Never issues writes to Traccar. Auth via Bearer token from settings.
    """

    def __init__(self) -> None:
        self.base_url = settings.TRACCAR_BASE_URL.rstrip('/')
        self.token = settings.TRACCAR_TOKEN

    def _get(self, path: str) -> list[dict]:
        url = f'{self.base_url}{path}'
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        try:
            response = requests.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            logger.error('Traccar request failed: %s', url, exc_info=True)
            raise TraccarUnavailable(str(exc)) from exc

    def get_devices(self) -> list[dict]:
        return self._get('/api/devices')

    def get_positions(self) -> list[dict]:
        return self._get('/api/positions')
