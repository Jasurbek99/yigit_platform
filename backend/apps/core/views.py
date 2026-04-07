import logging

from django.contrib.auth import authenticate
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.models import City, Country, ExportFirm, ShipmentStatusType, Customer, GreenhouseBlock, LoadingLocation, TomatoVariety, TruckDestination
from apps.core.permissions import write_permission
from apps.core.serializers import (
    LoginSerializer,
    UserMeSerializer,
    CitySerializer,
    CountrySerializer,
    ExportFirmReferenceSerializer,
    ShipmentStatusTypeSerializer,
    CustomerSerializer,
    GreenhouseBlockSerializer,
    LoadingLocationSerializer,
    TomatoVarietySerializer,
    TruckDestinationSerializer,
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


@method_decorator([csrf_exempt, ensure_csrf_cookie], name='dispatch')
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


class CountryViewSet(ModelViewSet):
    serializer_class = CountrySerializer
    queryset = Country.objects.all().order_by('name_en')
    permission_classes = [IsAuthenticated, write_permission('director')]


class CityViewSet(ModelViewSet):
    """Cities list with optional ?country=<id> filter. Writes restricted to director."""

    serializer_class = CitySerializer
    permission_classes = [IsAuthenticated, write_permission('director')]

    def get_queryset(self):
        qs = City.objects.select_related('country').order_by('name')
        country_id = self.request.query_params.get('country')
        if country_id:
            qs = qs.filter(country_id=country_id)
        return qs


class ExportFirmViewSet(ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = ExportFirm.objects.filter(is_active=True)
    serializer_class = ExportFirmReferenceSerializer


class ShipmentStatusTypeViewSet(ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = ShipmentStatusType.objects.all()
    serializer_class = ShipmentStatusTypeSerializer


class CustomerViewSet(ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = Customer.objects.filter(is_active=True)
    serializer_class = CustomerSerializer


class GreenhouseBlockViewSet(ReadOnlyModelViewSet):
    """GET /api/v1/core/blocks/ — list active greenhouse blocks."""

    permission_classes = [IsAuthenticated]
    serializer_class = GreenhouseBlockSerializer
    queryset = GreenhouseBlock.objects.filter(is_active=True).order_by('code')


class LoadingLocationViewSet(ReadOnlyModelViewSet):
    """GET /api/v1/core/loading-locations/ — list all loading locations."""

    permission_classes = [IsAuthenticated]
    serializer_class = LoadingLocationSerializer
    queryset = LoadingLocation.objects.all()


class TomatoVarietyViewSet(ReadOnlyModelViewSet):
    """GET /api/v1/core/tomato-varieties/ — list all tomato varieties."""

    permission_classes = [IsAuthenticated]
    serializer_class = TomatoVarietySerializer
    queryset = TomatoVariety.objects.all()


class TruckDestinationViewSet(ModelViewSet):
    """GET /api/v1/core/truck-destinations/ — list active truck destinations.

    Director can create/update/delete. All authenticated users can read.
    """

    permission_classes = [IsAuthenticated, write_permission('director')]
    serializer_class = TruckDestinationSerializer
    queryset = TruckDestination.objects.select_related('country').filter(is_active=True)
