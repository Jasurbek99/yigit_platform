from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status


def custom_exception_handler(exc, context):
    """Return consistent JSON error format: {"error": "message"}."""
    response = exception_handler(exc, context)

    if response is not None:
        # Flatten DRF's default dict into our { "error": "..." } format for non-field errors
        if isinstance(response.data, dict) and 'detail' in response.data:
            response.data = {'error': str(response.data['detail'])}
        elif isinstance(response.data, dict) and 'non_field_errors' in response.data:
            response.data = {'error': response.data['non_field_errors'][0]}

    return response
