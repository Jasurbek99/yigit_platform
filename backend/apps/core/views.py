import logging

from django.contrib.auth import authenticate
from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ReadOnlyModelViewSet
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.models import Country, ExportFirm, ShipmentStatusType, Customer
from apps.core.serializers import (
    LoginSerializer,
    UserMeSerializer,
    CountrySerializer,
    ExportFirmSerializer,
    ShipmentStatusTypeSerializer,
    CustomerSerializer,
)

logger = logging.getLogger(__name__)

JWT_SETTINGS = settings.SIMPLE_JWT


def _set_auth_cookies(response: Response, refresh: RefreshToken) -> None:
    """Write httpOnly JWT cookies onto the response."""
    access_token = str(refresh.access_token)
    refresh_token = str(refresh)
    secure = JWT_SETTINGS.get('AUTH_COOKIE_SECURE', False)
    samesite = JWT_SETTINGS.get('AUTH_COOKIE_SAMESITE', 'Lax')

    response.set_cookie(
        JWT_SETTINGS.get('AUTH_COOKIE', 'access_token'),
        access_token,
        max_age=int(JWT_SETTINGS['ACCESS_TOKEN_LIFETIME'].total_seconds()),
        httponly=True,
        secure=secure,
        samesite=samesite,
    )
    response.set_cookie(
        JWT_SETTINGS.get('AUTH_COOKIE_REFRESH', 'refresh_token'),
        refresh_token,
        max_age=int(JWT_SETTINGS['REFRESH_TOKEN_LIFETIME'].total_seconds()),
        httponly=True,
        secure=secure,
        samesite=samesite,
    )


class LoginView(APIView):
    """POST /api/v1/auth/login/ — authenticate and set httpOnly JWT cookies."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=serializer.validated_data['username'],
            password=serializer.validated_data['password'],
        )
        if user is None:
            return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)
        if not user.is_active:
            return Response({'error': 'Account disabled'}, status=status.HTTP_401_UNAUTHORIZED)

        refresh = RefreshToken.for_user(user)
        response = Response(UserMeSerializer(user).data, status=status.HTTP_200_OK)
        _set_auth_cookies(response, refresh)
        return response


class LogoutView(APIView):
    """POST /api/v1/auth/logout/ — blacklist refresh token and clear cookies."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_token = request.COOKIES.get(JWT_SETTINGS.get('AUTH_COOKIE_REFRESH', 'refresh_token'))
        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
                token.blacklist()
            except Exception:
                pass  # already invalid — safe to ignore
        response = Response({'detail': 'Logged out'}, status=status.HTTP_200_OK)
        response.delete_cookie(JWT_SETTINGS.get('AUTH_COOKIE', 'access_token'))
        response.delete_cookie(JWT_SETTINGS.get('AUTH_COOKIE_REFRESH', 'refresh_token'))
        return response


class MeView(APIView):
    """GET /api/v1/auth/me/ — return current user info."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserMeSerializer(request.user).data)


class CountryViewSet(ReadOnlyModelViewSet):
    queryset = Country.objects.all()
    serializer_class = CountrySerializer


class ExportFirmViewSet(ReadOnlyModelViewSet):
    queryset = ExportFirm.objects.filter(is_active=True)
    serializer_class = ExportFirmSerializer


class ShipmentStatusTypeViewSet(ReadOnlyModelViewSet):
    queryset = ShipmentStatusType.objects.all()
    serializer_class = ShipmentStatusTypeSerializer


class CustomerViewSet(ReadOnlyModelViewSet):
    queryset = Customer.objects.filter(is_active=True)
    serializer_class = CustomerSerializer
