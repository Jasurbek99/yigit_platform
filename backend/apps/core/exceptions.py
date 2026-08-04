from django.db.models.deletion import ProtectedError
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status

from apps.core.seasons import SeasonClosedError


def custom_exception_handler(exc, context):
    """Return consistent JSON error format: {"error": "message"}.

    Handles cases not covered by DRF's default handler:
    - ``SeasonClosedError``: a write was attempted against a closed season
      (D1). 409 rather than 403 — the request is well-formed and the user is
      authorised in principle, it conflicts with the resource's *state*. The
      frontend renders it as a banner, not a permission error.
    - ``ProtectedError``: Django raises this when a DELETE would cascade into a
      PROTECT FK.  DRF doesn't know about it (returns None), so we intercept
      and return HTTP 409 Conflict instead of letting it propagate to a 500.
    """
    # Neither of these is a DRF exception — handle them before the DRF handler
    # so we control the response shape and skip the `detail` flattener below.
    if isinstance(exc, SeasonClosedError):
        return Response(
            {
                'error': 'season_closed',
                'season': exc.season.name,
                'closed_at': (
                    exc.season.closed_at.isoformat() if exc.season.closed_at else None
                ),
            },
            status=status.HTTP_409_CONFLICT,
        )

    if isinstance(exc, ProtectedError):
        return Response(
            {'error': 'Cannot delete: this record is referenced by existing data.'},
            status=status.HTTP_409_CONFLICT,
        )

    response = exception_handler(exc, context)

    if response is not None:
        # Flatten DRF's default dict into our { "error": "..." } format for non-field errors
        if isinstance(response.data, dict) and 'detail' in response.data:
            response.data = {'error': str(response.data['detail'])}
        elif isinstance(response.data, dict) and 'non_field_errors' in response.data:
            response.data = {'error': response.data['non_field_errors'][0]}

    return response
