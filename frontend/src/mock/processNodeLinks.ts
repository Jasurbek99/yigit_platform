import type { IProcessNodeLink } from '@/types';

/**
 * Mock rows for the BPMN node -> screen mapping admin page (USE_MOCK=true).
 *
 * A small representative slice of the 20 rows seeded by export migration 0060,
 * not the full set: enough to exercise every render branch — a linked row, an
 * unlinked one (blank `route` renders the "empty" placeholder) and an inactive
 * one (grey tag). node_id / label are transcribed from the real seed so a
 * developer working in mock mode sees the same shapes the API returns.
 */
export const MOCK_PROCESS_NODE_LINKS: IProcessNodeLink[] = [
  {
    id: 1,
    node_id: 'em_weekly',
    label: 'Hepdelik maşyn planlamak',
    route: '/export/plan',
    is_active: true,
  },
  {
    id: 2,
    node_id: 'load_fc',
    label: 'Günlük hasyly çaklamak (forecast)',
    route: '/export/harvest-board',
    is_active: true,
  },
  {
    id: 3,
    node_id: 'join',
    label: 'Draftlary birleşdirmek (JOIN)',
    route: '/export/assign',
    is_active: true,
  },
  {
    id: 4,
    node_id: 'onetime',
    label: 'Bir saparlyk kontrakt açmak',
    route: '',
    is_active: true,
  },
  {
    id: 5,
    node_id: 'fin_close',
    label: 'Maliýe taýdan ýapmak',
    route: '/export/advances',
    is_active: false,
  },
];
