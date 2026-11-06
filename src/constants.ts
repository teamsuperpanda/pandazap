// Constants used throughout the application
export const ANKI_CONNECT_VERSION = 6;
export const REQUEST_TIMEOUT_MS = 5000;
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;
export const RETRY_BACKOFF_BASE_MS = 1000;
// Minimum time between progress re-renders during a sync run.
export const SYNC_PROGRESS_RENDER_INTERVAL_MS = 100;
// A saved note is synced after this quiet period, so rapid writes coalesce.
export const SYNC_ON_SAVE_DEBOUNCE_MS = 2500;
// Minimum time before an identical silent sync failure replaces the status text.
export const SYNC_STATUS_ERROR_REPEAT_MS = 30000;
export const ANKI_CONNECT_DEFAULT_PORT = 8765;
export const ANKI_CONNECT_DEFAULT_URL = 'http://127.0.0.1';
export const PLUGIN_TAG = 'panda-zap';
// Every file the plugin uploads to Anki's media folder starts with this prefix.
export const MEDIA_FILENAME_PREFIX = 'pandazap_';
