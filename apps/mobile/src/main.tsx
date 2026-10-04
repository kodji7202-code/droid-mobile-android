import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { i18nReady } from './i18n/init';
import App from './app/App';
import { Capacitor } from '@capacitor/core';
import { createNativeSecureStore } from './platform/nativeSecureStore';
import { setSecureStore } from './platform/secureStore';
import { useConnectionStore } from './stores/connection';

// Must run before the store restores: the web build keeps keys in memory only.
if (Capacitor.isNativePlatform()) {
  setSecureStore(createNativeSecureStore());
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Mount once i18next finished initializing so the first paint is localized.
void i18nReady.then(async () => {
  // Restore the saved active connection before the first paint. On native the
  // key comes from secure storage, so a launch with an unreachable daemon
  // shows the offline shell with a retry control instead of flashing the
  // Connect screen. On the web the key lives in memory only, so this is a
  // no-op after a reload (WEB-KEY-RULE).
  try {
    await useConnectionStore.getState().restore();
  } catch {
    // A failed restore must never block the first paint.
  }
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
