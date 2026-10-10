import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Whether the user chose a language was recorded by m.html's inline script.
import { applyMarketLanguage, userChoseLanguage } from './lang';
import i18n from '@/i18n';
import './styles/tokens.css';
import './styles/base.css';
import './styles/lot.css';
import './styles/debts.css';
import App from './App';
import { registerMarketSw } from './registerSw';

applyMarketLanguage(i18n, userChoseLanguage);
registerMarketSw();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('m.html has no #root element');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/m">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
