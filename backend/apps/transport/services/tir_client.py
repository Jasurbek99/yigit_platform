import logging

import pyodbc
from django.conf import settings

logger = logging.getLogger(__name__)


class TirUnavailable(Exception):
    """Raised when the Z_TIRWEB source DB cannot be reached."""


class TirClient:
    """Read-only reader of the Z_TIRWEB TIR fleet DB. Never writes."""

    def __init__(self) -> None:
        self.conn_str = settings.TIR_DB_CONN_STR
        if not self.conn_str:
            raise TirUnavailable('TIR_DB_CONN_STR is not set (see backend/.env.example)')

    def _rows(self, sql: str) -> list[dict]:
        try:
            with pyodbc.connect(self.conn_str, timeout=20) as cn:
                cur = cn.cursor()
                cur.execute(sql)
                cols = [c[0] for c in cur.description]
                return [dict(zip(cols, r)) for r in cur.fetchall()]
        except pyodbc.Error as exc:
            logger.error('Z_TIRWEB read failed', exc_info=True)
            raise TirUnavailable(str(exc)) from exc

    def get_truck_heads(self) -> list[dict]:
        return self._rows(
            'SELECT id, plate_number, owner_type, owner_name, status, capacity FROM truck_heads'
        )

    def get_trailers(self) -> list[dict]:
        return self._rows(
            'SELECT id, plate_number, owner_type, status FROM trailers'
        )
