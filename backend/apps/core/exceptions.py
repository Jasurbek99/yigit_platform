from django.db.models.deletion import ProtectedError
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status


def custom_exception_handler(exc, context):
    """Return consistent JSON error format: {"error": "message"}.

    Handles cases not covered by DRF's default handler:
    - ``ProtectedError``: Django raises this when a DELETE would cascade into a
      PROTECT FK.  DRF doesn't know about it (returns None), so we intercept
      and return HTTP 409 Conflict instead of letting it propagate to a 500.
    """
    # Django's ProtectedError is not a DRF exception — handle it before the
    # DRF handler so we control the response shape.
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
