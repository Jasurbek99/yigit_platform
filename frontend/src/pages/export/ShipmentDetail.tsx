import { useParams, Link } from 'react-router-dom';
import { Alert, Flex, Grid, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentDetailHero } from '@/components/shipment/ShipmentDetailHero';
import { ShipmentGuidanceLine } from '@/components/shipment/ShipmentGuidanceLine';
import { ShipmentCompletenessBar } from '@/components/shipment/ShipmentCompletenessBar';
import { ShipmentDetailStageCards } from '@/components/shipment/ShipmentDetailStageCards';
import { ShipmentSaleSection } from '@/components/shipment/ShipmentSaleSection';
import { RouteTimelineRail } from '@/components/shipment/RouteTimelineRail';
import { ShipmentCustomsExpensesCard } from '@/components/customsExpense/ShipmentCustomsExpensesCard';
import { ShipmentTruckLocationCard } from '@/components/shipment/ShipmentTruckLocationCard';
import { ShipmentQuotaCard } from '@/components/shipment/ShipmentQuotaCard';
import { CUSTOMS_EXPENSE_WRITE_ROLES } from '@/components/customsExpense/CustomsExpensesTab';
import { MIN_SALES_REPORT_STEP } from '@/components/salesReport/salesReportUtils';
import { CommentsDrawerOverlay } from '@/components/comments/CommentsDrawerOverlay';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useShipmentComments } from '@/hooks/useShipmentComments';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { canDo } from '@/utils/permissions';
import { COLORS } from '@/constants/styles';
import { jumpToField } from './ShipmentDetailHelpers.helpers';

// Roles the backend `CanEditShipment` permission allows to write shipment
// fields (see backend/apps/transport/permissions.py) — mirrored here so the
// truck-link override control is only shown to users who can actually use it.
const TRANSPORT_EDIT_ROLES = [
  'admin',
  'export_manager',
  'director',
  'warehouse_chief',
  'loading_dept_head',
  'loading_dept_head_deputy',
];

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const screens = Grid.useBreakpoint();
  const { data: shipment, isLoading, isError } = useShipmentDetail(id);
  const { user } = useAuth();
  const { t } = useTranslation();
  // Must run every render (Rules of Hooks) — harmless fallback pre-load.
  const comments = useShipmentComments(shipment?.id ?? 0, shipment?.comments ?? []);
  // Detail routes deliberately bypass season SCOPING (a direct link to any
  // shipment, in any season, always resolves — §4.5/Rule A), but they do NOT
  // bypass the read-only DECISION: `useSeasonReadOnly()` reflects which
  // season is currently being BROWSED app-wide (URL ?? store ?? active), not
  // which season this particular shipment belongs to — the same global
  // browsing-mode concept the Sheet/List/WeeklyPlanGrid gates already use.
  // Without this, autosave (`useDetailFieldAutosave`) would PATCH, 409, and
  // roll back — silently discarding whatever the user just typed, since the
  // rollback's `setDraft(persisted)` effect overwrites the local draft with
  // no way to recover it. Gating prevents the PATCH from firing at all.
  const isReadOnly = useSeasonReadOnly();

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (isError || !shipment) {
    return <Alert type="error" message={t('shipment_detail.error_load')} style={{ margin: 24 }} />;
  }

  const canEditAnyField = canDo(user, 'shipment', 'edit');
  const readOnly = !canEditAnyField || isReadOnly;
  const canWriteExpense =
    ((user ? CUSTOMS_EXPENSE_WRITE_ROLES.has(user.role) : false) || user?.is_superuser === true) &&
    !isReadOnly;
  // Sales report: sales_rep / export_manager / director / admin (or superuser)
  // once the shipment has departed — system status lags the real sale, so
  // gating on "sold" would block reports for trucks that have already sold.
  const canEditSalesReport =
    (user?.role === 'sales_rep' ||
      user?.role === 'export_manager' ||
      user?.role === 'director' ||
      user?.role === 'admin' ||
      user?.is_superuser === true) && shipment.status_step >= MIN_SALES_REPORT_STEP &&
    !isReadOnly;
  const canOverrideVariety =
    (user?.role === 'warehouse_chief' ||
    user?.role === 'export_manager' ||
    user?.role === 'director' ||
    user?.is_superuser === true) &&
    !isReadOnly;
  const canEditTruckLink =
    (user?.is_superuser === true || (user?.role != null && TRANSPORT_EDIT_ROLES.includes(user.role))) &&
    !isReadOnly;

  const missingKeys = new Set(shipment.completeness.missing_fields.map((f) => f.key));
  const groupProps = {
    shipment, missingKeys, readOnly,
    onOpenComments: comments.open, commentCountsByField: comments.countsByField,
  };

  return (
    <div>
      <ShipmentDetailHero shipment={shipment} onOpenComments={comments.open} />
      <ShipmentGuidanceLine shipment={shipment} />
      <ShipmentCompletenessBar completeness={shipment.completeness} onJumpToField={jumpToField} />
      {!screens.md && <RouteTimelineRail shipment={shipment} />}
      <ShipmentDetailStageCards
        shipment={shipment}
        isDesktop={!!screens.md}
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={comments.open}
        commentCountsByField={comments.countsByField}
        canOverrideVariety={canOverrideVariety}
      />

      <ShipmentSaleSection {...groupProps} canEditSalesReport={canEditSalesReport} />

      <ShipmentQuotaCard shipment={shipment} />

      <ShipmentCustomsExpensesCard shipment={shipment} canWrite={canWriteExpense} />

      <ShipmentTruckLocationCard shipmentId={shipment.id} canEdit={canEditTruckLink} />

      <Flex justify="flex-end" style={{ marginBottom: 8 }}>
        <Link
          to={`/shipments/${shipment.id}/activity`}
          style={{ fontSize: 13, color: COLORS.textSecondary }}
        >
          {t('shipment.detail.activity_link')} →
        </Link>
      </Flex>
      <CommentsDrawerOverlay open={comments.isOpen} onClose={comments.close} />
    </div>
  );
}
