import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/tokens.css';
import './styles/web.css';
import App from './App';
import AppRouter from './platform/AppRouter';
import { getPlatformType } from './platform';

// Set initial platform attribute on html element
if (typeof document !== 'undefined') {
  document.documentElement.dataset.platform = getPlatformType();
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRouter>
      <App />
    </AppRouter>
  </StrictMode>,
);
