import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/tokens.css';
import './styles/web.css';
import App from './App';
import AppRouter from './platform/AppRouter';
import { getPlatformType } from './platform';

// Set initial platform attribute on html element and title for desktop
if (typeof document !== 'undefined') {
  const platformType = getPlatformType();
  document.documentElement.dataset.platform = platformType;
  if (platformType === 'electron') {
    document.title = 'InTabPDF';
  }
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
