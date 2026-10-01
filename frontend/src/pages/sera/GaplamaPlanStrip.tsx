import { useTranslation } from 'react-i18next';
import { useDailyProgress } from '@/hooks/useDailyProgress';

interface IStockInput {
  readonly packed: number;
  readonly loadingTarget: number;
  /** Σ available_kg of the day — already net of trucks loaded that day. */
  readonly availableKg: number;
  readonly capacityKg: number;
}

/** Trucks the day still needs vs whole trucks the stock can still fill. */
export function stockShortfall({ packed, loadingTarget, availableKg, capacityKg }: IStockInput) {
  const remaining = Math.max(0, loadingTarget - packed);
  const stockTrucks = capacityKg > 0 ? Math.floor(availableKg / capacityKg) : 0;
  return { remaining, stockTrucks, shortfall: Math.max(0, remaining - stockTrucks) };
}

interface IGaplamaPlanStripProps {
  /** The board's selected day (YYYY-MM-DD). */
  readonly day: string;
  readonly availableKg: number;
  readonly truckCapacityKg: number;
}

/** Gaplama day view (spec 2026-10-01): packed vs the loading target, and whether stock covers the rest. */
export function GaplamaPlanStrip({ day, availableKg, truckCapacityKg }: IGaplamaPlanStripProps) {
  const { t } = useTranslation();
  const { data } = useDailyProgress(day);
  const progress = data?.days?.find((d) => d.date === day);
  if (!progress) return null;

  const { stockTrucks, shortfall } = stockShortfall({
    packed: progress.packed,
    loadingTarget: progress.loading_target,
    availableKg,
    capacityKg: truckCapacityKg,
  });

  return (
    <div className="sera-gaplama-plan-strip" data-testid="gaplama-plan-strip">
      <span>{t('tir_takip.gaplama.plan_packed', { done: progress.packed, total: progress.loading_target })}</span>
      <span>{` · ${t('tir_takip.gaplama.plan_stock', { count: stockTrucks })}`}</span>
      {shortfall > 0 && (
        <span className="sera-gaplama-plan-short">
          {` · ${t('tir_takip.gaplama.plan_short', { count: shortfall })}`}
        </span>
      )}
    </div>
  );
}
