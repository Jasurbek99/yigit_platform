import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import './styles/tokens.css';
import './styles/base.css';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/m">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
