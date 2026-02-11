/**
 * ClawChat - Configuration
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
  // Max file upload size (10 MB)
  maxFileSize: 10 * 1024 * 1024,
};
