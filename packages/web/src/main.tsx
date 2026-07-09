import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Studio is a live view over a DB other processes write to; keep data fresh.
      refetchOnWindowFocus: true,
      // Keep polling even when the tab is backgrounded — a run (or a teammate's
      // heal) can land while the user is looking elsewhere, and the live-run
      // view must keep advancing.
      refetchIntervalInBackground: true,
      staleTime: 1000,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
