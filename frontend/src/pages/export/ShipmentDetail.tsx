import { useParams, Link } from 'react-router-dom';
import { Alert, Flex, Grid, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentDetailHero } from '@/components/shipment/ShipmentDetailHero';
import { ShipmentGuidanceLine } from '@/components/shipment/ShipmentGuidanceLine';
import { ShipmentCompletenessBar } from '@/components/shipment/ShipmentCompletenessBar';
import { ShipmentStageCard } from '@/components/shipment/ShipmentStageCard';
import { ShipmentFieldGroup, countMissing } from '@/components/shipment/ShipmentFieldGroup';
import { ShipmentGoodsBody } from '@/components/shipment/ShipmentGoodsBody';
import { ShipmentDocumentsBody } from '@/components/shipment/ShipmentDocumentsBody';
import { ShipmentSaleSection } from '@/components/shipment/ShipmentSaleSection';
import { ShipmentLinksCard } from '@/components/shipment/ShipmentLinksCard';
import { RouteTimelineRail } from '@/components/shipment/RouteTimelineRail';
import { ShipmentCustomsExpensesCard } from '@/components/customsExpense/ShipmentCustomsExpensesCard';
import { CUSTOMS_EXPENSE_WRITE_ROLES } from '@/components/customsExpense/CustomsExpensesTab';
import { MIN_SALES_REPORT_STEP } from '@/components/salesReport/salesReportUtils';
import { CommentsDrawer } from '@/components/comments/CommentsDrawer';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useShipmentComments } from '@/hooks/useShipmentComments';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { COLORS } from '@/constants/styles';
import { jumpToField } from './ShipmentDetailHelpers.helpers';

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const screens = Grid.useBreakpoint();
  const { data: shipment, isLoading, isError } = useShipmentDetail(id);
  const { user } = useAuth();
  const { t } = useTranslation();
  // Must run every render (Rules of Hooks) — harmless fallback pre-load.
  const comments = useShipmentComments(shipment?.id ?? 0, shipment?.comments ?? []);

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
  const readOnly = !canEditAnyField;
  const canWriteExpense =
    (user ? CUSTOMS_EXPENSE_WRITE_ROLES.has(user.role) : false) || user?.is_superuser === true;
  // Sales report: sales_rep / export_manager / director / admin (or superuser)
  // once the shipment has departed — system status lags the real sale, so
  // gating on "sold" would block reports for trucks that have already sold.
  const canEditSalesReport =
    (user?.role === 'sales_rep' ||
      user?.role === 'export_manager' ||
      user?.role === 'director' ||
      user?.role === 'admin' ||
      user?.is_superuser === true) && shipment.status_step >= MIN_SALES_REPORT_STEP;
  const canOverrideVariety =
    user?.role === 'warehouse_chief' ||
    user?.role === 'export_manager' ||
    user?.role === 'director' ||
    user?.is_superuser === true;

  const missingKeys = new Set(shipment.completeness.missing_fields.map((f) => f.key));
  const groupProps = {
    shipment, missingKeys, readOnly,
    onOpenComments: comments.open, commentCountsByField: comments.countsByField,
  };

  return (
    <div style={{ position: 'relative' }}>
      <ShipmentDetailHero shipment={shipment} onOpenComments={comments.open} />
      <ShipmentGuidanceLine shipment={shipment} />
      <ShipmentCompletenessBar completeness={shipment.completeness} onJumpToField={jumpToField} />

      {/* Always-open stage cards: five flow into columns 1-2 across three rows; the route rail spans column 3. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: screens.md ? '1fr 1fr 320px' : '1fr',
          gap: 16,
          alignItems: 'start',
          marginBottom: 16,
        }}
      >
        <ShipmentStageCard
          title={t('shipment.detail.stage.destination')}
          missingCount={countMissing('logistics', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentFieldGroup {...groupProps} groupKey="logistics" />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment.detail.stage.documents')}
          missingCount={countMissing('status', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentDocumentsBody {...groupProps} canEditQuality={canEditAnyField} />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment.detail.stage.loading')}
          missingCount={countMissing('goods', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentGoodsBody {...groupProps} canOverrideVariety={canOverrideVariety} />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment.detail.stage.transit')}
          missingCount={countMissing('transport', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentFieldGroup {...groupProps} groupKey="transport" />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment_edit_drawer.section_notes')}
          missingCount={countMissing('notes', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentFieldGroup {...groupProps} groupKey="notes" />
        </ShipmentStageCard>

        {screens.md && (
          <div style={{ gridColumn: 3, gridRow: '1 / span 3' }}>
            <RouteTimelineRail shipment={shipment} />
            <ShipmentLinksCard />
          </div>
        )}
      </div>

      <ShipmentSaleSection {...groupProps} canEditSalesReport={canEditSalesReport} />

      <ShipmentCustomsExpensesCard shipment={shipment} canWrite={canWriteExpense} />

      <Flex justify="flex-end" style={{ marginBottom: 8 }}>
        <Link
          to={`/shipments/${shipment.id}/activity`}
          style={{ fontSize: 13, color: COLORS.textSecondary }}
        >
          {t('shipment.detail.activity_link')} →
        </Link>
      </Flex>
      <CommentsDrawer open={comments.isOpen} onClose={comments.close} />
    </div>
  );
}
