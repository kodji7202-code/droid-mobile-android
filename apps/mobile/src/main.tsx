import { restoreDurablePrefs } from './platform/durablePrefs';

// The stores read localStorage when they are imported, so the native mirror must
// be restored into it first; hence the dynamic import of everything else.
void restoreDurablePrefs().then(() => import('./bootstrap'));
