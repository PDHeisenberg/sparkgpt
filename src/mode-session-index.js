/**
 * SparkGPT - Mode Session Index
 * 
 * Manages multiple sessions per mode with a JSON index file.
 * Each mode gets its own index at mode-sessions/<mode>.json
 * Sessions reference JSONL transcript files in the OpenClaw sessions directory.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { log, debug, error as logError } from './logger.js';
import { SESSIONS_DIR } from './services/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODE_SESSIONS_DIR = join(__dirname, '..', 'mode-sessions');

// Old deterministic session IDs for migration
const LEGACY_SESSION_IDS = {
  dev:       'spark-dev-00000-0000-0000-000000000001',
  research:  'spark-res-00000-0000-0000-000000000002',
  plan:      'spark-pln-00000-0000-0000-000000000003',
  videogen:  'spark-vid-00000-0000-0000-000000000004',
};

/**
 * Ensure the mode-sessions directory exists
 */
function ensureDir() {
  if (!existsSync(MODE_SESSIONS_DIR)) {
    mkdirSync(MODE_SESSIONS_DIR, { recursive: true });
    debug(`📁 Created mode-sessions directory: ${MODE_SESSIONS_DIR}`);
  }
}

/**
 * Get the index file path for a mode
 */
function indexPath(mode) {
  return join(MODE_SESSIONS_DIR, `${mode}.json`);
}

/**
 * Save the session index for a mode (atomic write via rename)
 */
function saveSessionIndex(mode, data) {
  ensureDir();
  const path = indexPath(mode);
  const tmpPath = path + '.tmp';
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmpPath, path);
  } catch {
    // Fallback: direct write
    try {
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      logError(`Failed to save session index for ${mode}:`, e.message);
    }
  }
}

/**
 * Read/create the session index for a mode.
 * If no index exists but a legacy JSONL file does, migrate it.
 */
export function getSessionIndex(mode) {
  ensureDir();
  const path = indexPath(mode);
  
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      return data;
    } catch (e) {
      logError(`Failed to read session index for ${mode}:`, e.message);
      return { sessions: [] };
    }
  }
  
  // Check for legacy session file and migrate
  const legacyId = LEGACY_SESSION_IDS[mode];
  if (legacyId) {
    const legacyPath = join(SESSIONS_DIR, `${legacyId}.jsonl`);
    if (existsSync(legacyPath)) {
      log(`🔄 Migrating legacy session for ${mode}: ${legacyId}`);
      let createdAt;
      try {
        const stat = statSync(legacyPath);
        createdAt = new Date(stat.birthtimeMs || stat.ctimeMs).toISOString();
      } catch {
        createdAt = new Date().toISOString();
      }
      
      // Count messages in legacy file
      let messageCount = 0;
      try {
        const content = readFileSync(legacyPath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'message' && entry.message &&
                (entry.message.role === 'user' || entry.message.role === 'assistant')) {
              messageCount++;
            }
          } catch {}
        }
      } catch {}
      
      const index = {
        sessions: [{
          id: legacyId,
          createdAt,
          title: 'Migrated Session',
          messageCount,
          legacy: true
        }]
      };
      
      saveSessionIndex(mode, index);
      return index;
    }
  }
  
  // No index, no legacy file — return empty
  return { sessions: [] };
}

/**
 * Create a new session for a mode
 */
export function createSession(mode, title) {
  const index = getSessionIndex(mode);
  const id = `spark-${mode}-${randomUUID()}`;
  const session = {
    id,
    createdAt: new Date().toISOString(),
    title: title || null,
    messageCount: 0
  };
  
  index.sessions.push(session);
  saveSessionIndex(mode, index);
  
  log(`✨ Created new session for ${mode}: ${id}`);
  return session;
}

/**
 * Get the latest (most recent) session for a mode, or null if none
 */
export function getLatestSession(mode) {
  const index = getSessionIndex(mode);
  if (index.sessions.length === 0) return null;
  
  // Sort by createdAt descending and return first
  const sorted = [...index.sessions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return sorted[0];
}

/**
 * List all sessions for a mode, sorted by createdAt descending
 */
export function listSessions(mode) {
  const index = getSessionIndex(mode);
  return [...index.sessions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Update a session's title
 */
export function updateSessionTitle(mode, sessionId, title) {
  const index = getSessionIndex(mode);
  const session = index.sessions.find(s => s.id === sessionId);
  if (session) {
    session.title = title;
    saveSessionIndex(mode, index);
    debug(`📝 Updated session title for ${sessionId}: ${title}`);
  }
}

/**
 * Increment message count for a session
 */
export function incrementMessageCount(mode, sessionId) {
  const index = getSessionIndex(mode);
  const session = index.sessions.find(s => s.id === sessionId);
  if (session) {
    session.messageCount = (session.messageCount || 0) + 1;
    saveSessionIndex(mode, index);
  }
}
