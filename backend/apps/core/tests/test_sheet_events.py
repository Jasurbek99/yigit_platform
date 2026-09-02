"""Unit tests for the sheet-change broadcast service.

`broadcast_sheet_change` is the only thing in the codebase that talks to the
channel layer from synchronous code, so these tests pin two contracts:
    1. The exact `group_send` envelope AppConsumer.sheet_changed expects.
    2. That a channel-layer failure NEVER propagates — the user's write has
       already committed by the time we broadcast, so raising here would turn
       a successful save into a 500.

No DB needed: the channel layer is mocked out entirely.

Run:
    python manage.py test apps.core.tests.test_sheet_events --keepdb --verbosity=2
"""
from unittest import mock
from unittest.mock import AsyncMock

from django.test import SimpleTestCase

from apps.core.services import sheet_events


def _async_layer() -> mock.MagicMock:
    """A layer whose group_send is genuinely awaitable.

    A plain MagicMock is NOT awaitable: async_to_sync would call it (so
    assert_called_once_with still passes), then raise TypeError on the await,
    which broadcast_sheet_change swallows by design. The test would go green
    while exercising the failure path. AsyncMock is what makes these tests
    assert the success path they claim to.
    """
    layer = mock.MagicMock()
    layer.group_send = AsyncMock()
    return layer


class BroadcastSheetChangeTests(SimpleTestCase):
    def test_sends_group_message_with_ids_and_actor(self) -> None:
        layer = _async_layer()
        with mock.patch.object(sheet_events, 'get_channel_layer', return_value=layer):
            sheet_events.broadcast_sheet_change([7, 9], by_user_id=3)

        layer.group_send.assert_called_once_with('presence.sheet', {
            'type': 'sheet.changed',
            'shipment_ids': [7, 9],
            'by_user_id': 3,
        })

    def test_dedupes_sorts_and_coerces_ids(self) -> None:
        """URL pks arrive as strings; dupes arrive from bulk actions."""
        layer = _async_layer()
        with mock.patch.object(sheet_events, 'get_channel_layer', return_value=layer):
            sheet_events.broadcast_sheet_change(['9', 7, 9, None], by_user_id=1)

        self.assertEqual(layer.group_send.call_args[0][1]['shipment_ids'], [7, 9])

    def test_noop_for_empty_ids(self) -> None:
        layer = _async_layer()
        with mock.patch.object(sheet_events, 'get_channel_layer', return_value=layer):
            sheet_events.broadcast_sheet_change([], by_user_id=1)
            sheet_events.broadcast_sheet_change([None], by_user_id=1)

        layer.group_send.assert_not_called()

    def test_swallows_channel_layer_exception(self) -> None:
        layer = mock.MagicMock()
        layer.group_send.side_effect = RuntimeError('redis is down')
        with mock.patch.object(sheet_events, 'get_channel_layer', return_value=layer):
            sheet_events.broadcast_sheet_change([7], by_user_id=1)  # must not raise

        self.assertEqual(layer.group_send.call_count, 1)

    def test_noop_when_channel_layer_is_none(self) -> None:
        with mock.patch.object(sheet_events, 'get_channel_layer', return_value=None):
            sheet_events.broadcast_sheet_change([7], by_user_id=1)  # must not raise


class PokeSheetTests(SimpleTestCase):
    """`poke_sheet` is the single gate: only successful writes broadcast."""

    @staticmethod
    def _request(method: str, user_id: int | None = 5):
        return mock.Mock(method=method, user=mock.Mock(id=user_id))

    @staticmethod
    def _response(status_code: int):
        return mock.Mock(status_code=status_code)

    def test_ignores_get(self) -> None:
        with mock.patch.object(sheet_events, 'broadcast_sheet_change') as bc:
            sheet_events.poke_sheet(self._request('GET'), self._response(200), [7])
        bc.assert_not_called()

    def test_ignores_non_2xx(self) -> None:
        with mock.patch.object(sheet_events, 'broadcast_sheet_change') as bc:
            sheet_events.poke_sheet(self._request('PATCH'), self._response(400), [7])
            sheet_events.poke_sheet(self._request('POST'), self._response(403), [7])
            sheet_events.poke_sheet(self._request('DELETE'), self._response(500), [7])
        bc.assert_not_called()

    def test_forwards_actor_id_on_successful_write(self) -> None:
        for method, code in (('POST', 201), ('PATCH', 200), ('PUT', 200), ('DELETE', 204)):
            with self.subTest(method=method):
                with mock.patch.object(sheet_events, 'broadcast_sheet_change') as bc:
                    sheet_events.poke_sheet(self._request(method), self._response(code), [7])
                bc.assert_called_once_with([7], 5)

    def test_anonymous_actor_is_none(self) -> None:
        request = mock.Mock(method='POST', user=None)
        with mock.patch.object(sheet_events, 'broadcast_sheet_change') as bc:
            sheet_events.poke_sheet(request, self._response(201), [7])
        bc.assert_called_once_with([7], None)

    def test_success_path_logs_no_exception(self) -> None:
        """Regression guard for the AsyncMock trap above: if async_to_sync ever
        stops working, broadcast swallows the error and every other test here
        still passes. This is the one that would go red."""
        layer = _async_layer()
        with mock.patch.object(sheet_events, 'get_channel_layer', return_value=layer):
            with mock.patch.object(sheet_events.logger, 'exception') as logged:
                sheet_events.broadcast_sheet_change([7], by_user_id=1)
        logged.assert_not_called()
        layer.group_send.assert_awaited_once()
