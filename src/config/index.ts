// Central configuration exports for application screens, routing, and versioning.
export {
  APP_CONFIG,
  isScreenEnabled,
  getInitialDestination,
  getDefaultShellVisibility,
  resolveDestination,
} from './screens';
export type { ScreenId, AppConfiguration } from './screens';
export { APP_VERSION } from './version';
