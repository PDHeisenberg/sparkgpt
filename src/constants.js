/**
 * ClawChat - Shared Constants
 * 
 * Central location for magic numbers and configuration values
 * used across multiple modules.
 */

// ============================================================================
// Timeouts
// ============================================================================

/** CLI command timeout (5 minutes) - for openclaw agent calls */
export const CLI_TIMEOUT_MS = 5 * 60 * 1000;

/** Chat API request timeout (5 minutes) - for gateway LLM calls */
export const CHAT_TIMEOUT_MS = 5 * 60 * 1000;

/** Speaking timeout - max time to suppress mic input during TTS playback */
export const SPEAKING_TIMEOUT_MS = 30000;

// ============================================================================
// WebSocket
// ============================================================================

/** Max WebSocket payload size (50 MB) */
export const WS_MAX_PAYLOAD = 50 * 1024 * 1024;

/** WebSocket heartbeat ping interval */
export const WS_HEARTBEAT_INTERVAL_MS = 15000;

/** WebSocket heartbeat pong timeout */
export const WS_HEARTBEAT_TIMEOUT_MS = 10000;

// ============================================================================
// Session & Sync
// ============================================================================

/** Stale session max age (24 hours) */
export const STALE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Active session threshold (5 minutes) */
export const ACTIVE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;

/** Sync poll interval (backup for file watcher) */
export const SYNC_POLL_INTERVAL_MS = 1000;

/** Sync debounce time for file watcher events */
export const SYNC_DEBOUNCE_MS = 100;

/** Max cached message hashes for dedup */
export const MAX_HASH_CACHE = 100;

// ============================================================================
// Content Limits
// ============================================================================

/** Max extracted text length for CLI routing */
export const MAX_FILE_TEXT_CLI = 30000;

/** Max extracted text length for direct API */
export const MAX_FILE_TEXT_API = 50000;

/** TTS audio chunk size (~0.5 seconds of PCM16 audio) */
export const AUDIO_CHUNK_SIZE = 24000;
