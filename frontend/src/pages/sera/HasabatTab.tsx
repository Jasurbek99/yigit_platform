import type { ReactNode } from 'react';
import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { EChart } from '@/components/EChart';
import { useTirHasabat, type ITirHasabatGroup, type ITirHasabatResponse } from '@/hooks/useTirHasabat';
import { fmtWeight } from '@/utils/weight';
import {
  donutOption,
  fmtK,
  hbarHeight,
  hbarOption,
  monthOption,
  namedRows,
  paletteColor,
  sharePct,
} from './HasabatTab.charts';

/**
 * Tır Takip → 📊 Hasabat — the sera-butce-web report tab (App.jsx:15319),
 * fed by `GET /export/tir-hasabat/` instead of the browser's truck list.
 *
 * Layout, panel order, icons and the donut side legends are the source's;
 * the charts themselves use the platform's ECharts style.
 *
 * Shares are always taken against the panel's own `total_kg`: firm and block
 * panels sum their own tables' kg, which does not add up to the headline
 * "Jemi kg" (truck net weight).
 */
export default function HasabatTab() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useTirHasabat();

  if (isError) return <div className="sera-empty">{t('common.error')}</div>;
  if (isLoading || !data) {
    return (
      <div className="sera-hasabat-loading">
        <Spin />
      </div>
    );
  }
  if (!data.season) return <div className="sera-empty">{t('tir_takip.hasabat.no_season')}</div>;
  return <HasabatReport data={data} />;
}

function HasabatReport({ data }: { data: ITirHasabatResponse }) {
  const { t } = useTranslation();
  const k = data.kpis;
  const unknown = t('tir_takip.hasabat.unknown');
  const panel = (key: string) => t(`tir_takip.hasabat.panel.${key}`);

  const kpis = [
    { key: 'total_trucks', value: String(k.total_trucks), tone: 'emerald' },
    { key: 'total_kg', value: fmtK(k.total_kg), exact: k.total_kg, sub: 'total_kg_sub', tone: 'blue' },
    { key: 'avg_kg', value: fmtK(k.avg_kg), exact: k.avg_kg, tone: 'violet' },
    { key: 'open_trucks', value: String(k.open_trucks), sub: 'open_trucks_sub', tone: 'amber' },
    { key: 'arrived_trucks', value: String(k.arrived_trucks), tone: 'stone' },
  ];

  const customers = namedRows(data.by_customer, unknown, 10);
  const blocks = namedRows(data.by_block, unknown, 10);

  return (
    <div className="sera-hasabat">
      <div className="sera-kpis">
        {kpis.map((kpi) => (
          <div
            key={kpi.key}
            className={`sera-kpi sera-kpi--${kpi.tone}`}
            title={kpi.exact != null ? fmtWeight(kpi.exact, 'kg') : undefined}
          >
            <div className="sera-kpi__label">{t(`tir_takip.hasabat.kpi.${kpi.key}`)}</div>
            <div className="sera-kpi__value">{kpi.value}</div>
            {kpi.sub && <div className="sera-kpi__sub">{t(`tir_takip.hasabat.kpi.${kpi.sub}`)}</div>}
          </div>
        ))}
      </div>
      <p className="sera-hasabat__note">{t('tir_takip.hasabat.scope_note')}</p>

      <div className="sera-panels">
        {data.by_month.length > 0 && (
          <Panel title={panel('by_month')} icon="📅">
            <EChart
              option={monthOption(data.by_month, {
                kg: t('tir_takip.hasabat.series_kg'),
                bar: (m) => t('tir_takip.hasabat.month_bar', { kg: fmtK(m.kg), count: m.trucks }),
              })}
              height={240}
              ariaLabel={panel('by_month')}
            />
          </Panel>
        )}

        <DonutPanel title={panel('country_share')} icon="🌍" group={data.by_country} unknown={unknown} />
        <DonutPanel title={panel('firm_share')} icon="🏢" group={data.by_firm} unknown={unknown} />

        {customers.length > 0 && (
          <Panel title={panel('by_customer')} icon="👤">
            <EChart option={hbarOption(customers, true)} height={hbarHeight(customers.length)} ariaLabel={panel('by_customer')} />
          </Panel>
        )}
        {blocks.length > 0 && (
          <Panel title={panel('by_block')} icon="🌿">
            <EChart option={hbarOption(blocks, false)} height={hbarHeight(blocks.length)} ariaLabel={panel('by_block')} />
          </Panel>
        )}

        <RankPanel title={panel('country_detail')} icon="🌍" col="country" group={data.by_country} unknown={unknown} />
        <RankPanel title={panel('firm_detail')} icon="🏢" col="firm" group={data.by_firm} unknown={unknown} />
        <RankPanel title={panel('customer_detail')} icon="👤" col="customer" group={data.by_customer} unknown={unknown} />
        <RankPanel title={panel('by_variety')} icon="🍅" col="variety" group={data.by_variety} unknown={unknown} />
      </div>

      {k.total_trucks === 0 && <div className="sera-empty">{t('tir_takip.hasabat.empty')}</div>}
    </div>
  );
}

interface IPanelProps {
  title: string;
  icon: string;
  /** One grid column instead of the full width (the source's `span1`). */
  half?: boolean;
  children: ReactNode;
}

function Panel({ title, icon, half, children }: IPanelProps) {
  return (
    <section className={half ? 'sera-panel' : 'sera-panel sera-panel--wide'}>
      <h3 className="sera-panel__title">
        <span aria-hidden="true">{icon}</span> {title}
      </h3>
      <div className="sera-panel__body">{children}</div>
    </section>
  );
}

interface IGroupPanelProps {
  title: string;
  icon: string;
  group: ITirHasabatGroup;
  unknown: string;
}

/** Top-8 doughnut with the source's side legend. Zero-kg rows have no slice, so no legend line either. */
function DonutPanel({ title, icon, group, unknown }: IGroupPanelProps) {
  const rows = namedRows(group, unknown, 8).filter((r) => r.kg > 0);
  if (rows.length === 0) return null;
  return (
    <Panel title={title} icon={icon} half>
      <div className="sera-donut">
        <div className="sera-donut__chart">
          <EChart option={donutOption(rows)} height={200} ariaLabel={title} />
        </div>
        <ul className="sera-donut__legend">
          {rows.map((r, i) => (
            <li key={`${i}-${r.name}`}>
              <span className="sera-donut__swatch" style={{ background: paletteColor(i) }} />
              <span className="sera-donut__name">{r.name}</span>
              <span className="sera-donut__pct">{sharePct(r.kg, group.total_kg)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** The source's `RankTable`: bar width against the top row, % against the panel total. */
function RankPanel({ title, icon, group, unknown, col }: IGroupPanelProps & { col: string }) {
  const { t } = useTranslation();
  const rows = namedRows(group, unknown);
  if (rows.length === 0) return null;
  const max = rows[0].kg;
  return (
    <Panel title={title} icon={icon} half>
      <div className="sera-rank-wrap">
        <table className="sera-rank">
          <thead>
            <tr>
              <th>{t(`tir_takip.hasabat.col.${col}`)}</th>
              <th className="sera-rank__num">{t('tir_takip.hasabat.col.trucks')}</th>
              <th className="sera-rank__num">{t('tir_takip.hasabat.col.kg')}</th>
              <th className="sera-rank__share-col">{t('tir_takip.hasabat.col.share')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${i}-${r.name}`}>
                <td>
                  <span className="sera-rank__pos">{i + 1}</span>
                  {r.name}
                </td>
                <td className="sera-rank__num sera-rank__muted">{r.trucks}</td>
                <td className="sera-rank__num sera-rank__strong">{fmtWeight(r.kg, 'kg')}</td>
                <td>
                  <div className="sera-rank__share">
                    <div className="sera-rank__track">
                      <div className="sera-rank__fill" style={{ width: `${sharePct(r.kg, max)}%` }} />
                    </div>
                    <span>{sharePct(r.kg, group.total_kg)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
