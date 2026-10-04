import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { i18nReady } from './i18n/init';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Mount once i18next finished initializing so the first paint is localized.
void i18nReady.then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
