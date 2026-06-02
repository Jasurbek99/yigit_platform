import logging

from django.contrib.auth import authenticate
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.models import (
    City, Country, BorderPoint, ExportFirm, ImportFirm, ShipmentStatusType,
    ShipmentOptionType, Customer, GreenhouseBlock, LoadingLocation, TomatoVariety,
    TruckDestination, CrateType, GreenhouseConfig, OperatingDayException,
)
from apps.core.permissions import write_permission
from apps.core.roles import REFERENCE_DATA_WRITE
from apps.core.serializers import (
    LoginSerializer,
    UserMeSerializer,
    CitySerializer,
    CountrySerializer,
    ExportFirmReferenceSerializer,
    ShipmentStatusTypeSerializer,
    CustomerSerializer,
    CustomerAdminSerializer,
    GreenhouseBlockSerializer,
    LoadingLocationSerializer,
    TomatoVarietySerializer,
    CrateTypeSerializer,
    TruckDestinationSerializer,
    BorderPointSerializer,
    ShipmentOptionTypeSerializer,
    GreenhouseConfigSerializer,
    OperatingDayExceptionSerializer,
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
    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]


class CityViewSet(ModelViewSet):
    """Cities list with optional ?country=<id> filter. Writes restricted to admin/director/EM."""

    serializer_class = CitySerializer
    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]

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


class ShipmentStatusTypeViewSet(ModelViewSet):
    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    queryset = ShipmentStatusType.objects.all().order_by('step_order')
    serializer_class = ShipmentStatusTypeSerializer


class CustomerViewSet(ModelViewSet):
    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    queryset = (
        Customer.objects
        .select_related('default_country', 'default_city')
        .prefetch_related('import_firms')
        .all()
    )
    filterset_fields = ['is_active']
    search_fields = ['name', 'phone']

    def get_serializer_class(self):
        if self.request.query_params.get('fields') == 'minimal':
            return CustomerSerializer
        return CustomerAdminSerializer


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


class TomatoVarietyViewSet(ModelViewSet):
    """CRUD /api/v1/core/tomato-varieties/ — reads open, writes admin-only.

    Switched from ReadOnlyModelViewSet so admins can PATCH `color` (per-value
    Sheet cell coloring). REFERENCE_DATA_WRITE matches the other reference
    resource viewsets (Country, City, BorderPoint).
    """

    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    serializer_class = TomatoVarietySerializer
    queryset = TomatoVariety.objects.all()


class CrateTypeViewSet(ReadOnlyModelViewSet):
    """GET /api/v1/core/crate-types/ — list all crate types for pallet manifests.

    Defaults to active-only; pass ?is_active=false to include inactive (placeholder
    crate types pending Soltanmyrat confirmation).
    """

    permission_classes = [IsAuthenticated]
    serializer_class = CrateTypeSerializer
    queryset = CrateType.objects.all()
    filterset_fields = ['is_active']


class TruckDestinationViewSet(ModelViewSet):
    """CRUD /api/v1/core/truck-destinations/

    Admin, director, and export_manager can create/update/delete. All authenticated users can read.
    List defaults to active-only; pass ?is_active=false to include inactive.
    """

    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    serializer_class = TruckDestinationSerializer
    queryset = TruckDestination.objects.select_related('country').all()
    filterset_fields = ['is_active']


class BorderPointViewSet(ModelViewSet):
    """CRUD /api/v1/core/border-points/"""

    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    queryset = BorderPoint.objects.all()
    serializer_class = BorderPointSerializer


class ShipmentOptionTypeViewSet(ModelViewSet):
    """CRUD /api/v1/core/shipment-options/"""

    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    serializer_class = ShipmentOptionTypeSerializer
    filterset_fields = ['category']

    def get_queryset(self):
        qs = ShipmentOptionType.objects.all()
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        return qs.order_by('category', 'sort_order')


class MentionableView(APIView):
    """GET /api/v1/core/users/mentionable/?q=&limit=10

    Autocomplete for @mentions in the comment system.
    Returns a mixed list of users and roles matching the query string.

    Empty q → first 10 active users + all roles in ROLE_CHOICES.
    Non-empty q → users matching first/last/username + roles matching code/label.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.core.models.user import ROLE_CHOICES, User

        q = request.query_params.get('q', '').strip()
        try:
            limit = min(int(request.query_params.get('limit', 10)), 50)
        except (ValueError, TypeError):
            limit = 10

        # --- Users ---
        user_qs = User.objects.filter(is_active=True)
        if q:
            user_qs = user_qs.filter(
                Q(first_name__icontains=q) |
                Q(last_name__icontains=q) |
                Q(username__icontains=q)
            )
        users = list(user_qs.order_by('first_name', 'last_name')[:limit])

        user_results = []
        for u in users:
            full_name = ' '.join(p for p in [u.first_name, u.last_name] if p).strip()
            user_results.append({
                'type': 'user',
                'id': u.id,
                'name': full_name or u.username,
                'role': u.role,
            })

        # --- Roles (capped at 12, filtered in Python) ---
        # Single grouped query for member counts — avoids N+1 (one query per role).
        from django.db.models import Count

        counts_by_role = dict(
            User.objects.filter(is_active=True)
            .values_list('role')
            .annotate(n=Count('id'))
            .values_list('role', 'n')
        )

        q_lower = q.lower()
        role_results = []
        for code, label in ROLE_CHOICES:
            if q and q_lower not in code.lower() and q_lower not in label.lower():
                continue
            role_results.append({
                'type': 'role',
                'code': code,
                'label': label,
                'member_count': counts_by_role.get(code, 0),
            })

        return Response(user_results + role_results)


class GreenhouseConfigView(APIView):
    """GET / PATCH /api/v1/core/greenhouse-config/

    Singleton configuration. GET is open to all authenticated users; PATCH is admin-only.
    """

    permission_classes = [IsAuthenticated, write_permission('admin')]
    http_method_names = ['get', 'patch', 'head', 'options']

    def get(self, request):
        config = GreenhouseConfig.get_solo()
        return Response(GreenhouseConfigSerializer(config).data)

    def patch(self, request):
        config = GreenhouseConfig.get_solo()
        serializer = GreenhouseConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class OperatingDayExceptionViewSet(ModelViewSet):
    """CRUD /api/v1/core/operating-day-exceptions/

    Reads open to all authenticated users; writes admin-only.
    Filters: ?date_from=&date_to=&is_holiday=
    """

    serializer_class = OperatingDayExceptionSerializer
    permission_classes = [IsAuthenticated, write_permission('admin')]
    queryset = OperatingDayException.objects.select_related('created_by').order_by('-date')

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if date_from := params.get('date_from'):
            qs = qs.filter(date__gte=date_from)
        if date_to := params.get('date_to'):
            qs = qs.filter(date__lte=date_to)
        if (is_holiday := params.get('is_holiday')) is not None:
            if is_holiday.lower() in ('true', '1'):
                qs = qs.filter(is_holiday=True)
            elif is_holiday.lower() in ('false', '0'):
                qs = qs.filter(is_holiday=False)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
