/**
 * SparkGPT - Lightweight Logger
 * 
 * Respects DEBUG environment variable for verbose logging.
 * Essential logs (startup, errors, warnings) always show.
 * Debug/verbose logs only show when DEBUG=1 or DEBUG=spark*.
 */

const DEBUG = process.env.DEBUG === '1' || 
              process.env.DEBUG === 'true' || 
              (process.env.DEBUG || '').includes('spark');

/**
 * Always-on logging for important events (startup, connections, errors)
 */
export function log(...args) {
  console.log(...args);
}

/**
 * Debug-only logging for verbose/routine events (sync polls, message details)
 */
export function debug(...args) {
  if (DEBUG) console.log(...args);
}

/**
 * Warning logging (always on)
 */
export function warn(...args) {
  console.warn(...args);
}

/**
 * Error logging (always on)
 */
export function error(...args) {
  console.error(...args);
}

/**
 * Check if debug mode is enabled
 */
export function isDebug() {
  return DEBUG;
}

export default { log, debug, warn, error, isDebug };
