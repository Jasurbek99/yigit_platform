import { useNavigate } from 'react-router-dom';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useTranslation } from 'react-i18next';

// Each step maps to a route and uses the stable [data-tour="page"] element
// that is always present in the layout Content wrapper.
const TOUR_STEPS: Array<{ route: string; role: string }> = [
  { route: '/export/plan',             role: 'loading_dept_head' },
  { route: '/export/harvest-board',    role: 'loading_dept_head' },
  { route: '/export/drafts',           role: 'loading_dept_head' },
  { route: '/export/shipments/sheet',  role: 'transport' },
  { route: '/export/assign',           role: 'export_manager' },
  { route: '/export/assign',           role: 'export_manager' },
  { route: '/export/shipments/sheet',  role: 'document_team' },
  { route: '/export/shipments',        role: 'warehouse_chief' },
  { route: '/export/shipments/board',  role: 'transport' },
  { route: '/export/shipments/board',  role: 'sales_rep' },
  { route: '/export/my-reports',       role: 'finansist' },
];

const TOTAL = TOUR_STEPS.length;
// Delay (ms) after navigation before driver advances — lets the page paint.
const NAV_DELAY = 500;

export function useProcessTour(): () => void {
  const navigate = useNavigate();
  const { t } = useTranslation();

  function buildSteps() {
    return TOUR_STEPS.map((step, i) => ({
      // Target the stable layout content wrapper added in AppLayout.
      element: '[data-tour="page"]',
      popover: {
        title: `${t(`tour.step${i + 1}.title`)}`,
        description: `${t(`tour.step${i + 1}.text`)}<br/><small style="opacity:0.65;font-style:italic">${t('roles.' + step.role)}</small>`,
        showButtons: ['next', 'previous', 'close'] as Array<'next' | 'previous' | 'close'>,
      },
    }));
  }

  function startTour(): void {
    const d = driver({
      showProgress: true,
      progressText: `{{current}} / ${TOTAL}`,
      allowClose: true,
      overlayClickBehavior: 'close',
      steps: buildSteps(),

      onNextClick(_el, _step, { driver: drv }) {
        const currentIndex = drv.getActiveIndex() ?? 0;
        const nextIndex = currentIndex + 1;

        if (nextIndex >= TOTAL) {
          // Last step — destroy on "Done".
          drv.destroy();
          return;
        }

        navigate(TOUR_STEPS[nextIndex].route);
        setTimeout(() => drv.moveNext(), NAV_DELAY);
      },

      onPrevClick(_el, _step, { driver: drv }) {
        const currentIndex = drv.getActiveIndex() ?? 0;
        const prevIndex = currentIndex - 1;

        if (prevIndex < 0) {
          // Already at first step — do nothing.
          return;
        }

        navigate(TOUR_STEPS[prevIndex].route);
        setTimeout(() => drv.movePrevious(), NAV_DELAY);
      },
    });

    // Navigate to the first step's route, then start.
    navigate(TOUR_STEPS[0].route);
    setTimeout(() => d.drive(), NAV_DELAY);
  }

  return startTour;
}
