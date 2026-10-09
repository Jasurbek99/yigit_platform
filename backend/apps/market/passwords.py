from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

# Login (apps.core LoginSerializer) trims the password, so a stored password with
# edge whitespace — a phone keyboard's trailing space — could never be typed back.
EDGE_WHITESPACE = 'Пароль не может начинаться или заканчиваться пробелом.'


def check_login_password(password: str, user) -> None:
    """Raise a DRF `{'password': [...]}` error for edge whitespace or a weak password."""
    if password != password.strip():
        raise serializers.ValidationError({'password': [EDGE_WHITESPACE]})
    try:
        validate_password(password, user=user)
    except DjangoValidationError as e:
        raise serializers.ValidationError({'password': list(e.messages)})
