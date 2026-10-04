import { version } from '../../package.json';

/**
 * App version shown in Settings > About (VAL-ONBOARD-035, VAL-SET-021). The
 * value comes from apps/mobile/package.json so what the About screen displays
 * always equals the package version the validator reads.
 */
export const APP_VERSION: string = version;
