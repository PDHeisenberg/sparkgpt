/**
 * SparkGPT - Configuration
 */

export const CONFIG = {
  // Build WebSocket URL - include pathname for subpath routing (e.g., /voice)
  wsUrl: (() => {
    // Use wss:// for HTTPS, ws:// for HTTP
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = `${protocol}//${location.host}`;
    // If we're on a subpath like /voice, include it
    const path = location.pathname.replace(/\/+$/, ''); // remove trailing slashes
    return path && path !== '/' ? `${base}${path}` : base;
  })(),
  silenceMs: 1500,
};

/**
 * Mode configuration defaults (fallback if server config unavailable)
 */
export const MODE_DEFAULTS = {
  dev: { name: 'Dev Mode', icon: '👨‍💻', notifyWhatsApp: true },
  research: { name: 'Research Mode', icon: '🔬', notifyWhatsApp: true },
  plan: { name: 'Plan Mode', icon: '📋', notifyWhatsApp: true },
  articulate: { name: 'Articulate Mode', icon: '✍️', notifyWhatsApp: false },
  dailyreports: { name: 'Daily Reports', icon: '📊', notifyWhatsApp: true },
  videogen: { name: 'Video Gen', icon: '🎬', notifyWhatsApp: true }
};

/**
 * Session page configurations for each mode
 */
export const SESSION_MODE_CONFIG = {
  dev: {
    name: 'Dev Mode',
    icon: '👨‍💻',
    sessionKey: 'spark-dev-mode',
    placeholder: 'Describe what you want to build or fix...',
    emptyTitle: 'Dev Mode',
    emptyDesc: 'Start a coding session. Describe what you want to build or fix.'
  },
  research: {
    name: 'Research Mode',
    icon: '🔬',
    sessionKey: 'spark-research-mode',
    placeholder: 'What would you like to research?',
    emptyTitle: 'Research Mode',
    emptyDesc: 'Start a deep research session. Ask about any topic.'
  },
  plan: {
    name: 'Plan Mode',
    icon: '📋',
    sessionKey: 'spark-plan-mode',
    placeholder: 'What do you want to plan?',
    emptyTitle: 'Plan Mode',
    emptyDesc: 'Start planning. Describe your project or feature.'
  },
  videogen: {
    name: 'Video Gen',
    icon: '🎬',
    sessionKey: 'spark-videogen-mode',
    placeholder: 'Describe the video you want to create...',
    emptyTitle: 'Video Gen',
    emptyDesc: 'Generate AI videos. Describe what you want to create.'
  }
};

/**
 * Map button IDs to session labels
 */
export const BUTTON_TO_SESSION = {
  'devteam-btn': 'spark-dev-mode',
  'researcher-btn': 'spark-research-mode',
  'plan-btn': 'spark-plan-mode',
  'videogen-btn': 'spark-videogen-mode'
};

/**
 * Map mode names to session labels
 */
export const MODE_TO_SESSION = {
  'dev': 'spark-dev-mode',
  'research': 'spark-research-mode',
  'plan': 'spark-plan-mode',
  'videogen': 'spark-videogen-mode'
};

/**
 * Application constants
 */
export const MAX_RECONNECT_ATTEMPTS = 5;
export const SCROLL_THRESHOLD = 50; // pixels to pull down to trigger
