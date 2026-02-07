/**
 * SparkGPT - Session Service
 * 
 * Utilities for managing Clawdbot session files
 */

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

// Session directories
export const SESSIONS_DIR = '/home/heisenberg/.clawdbot/agents/main/sessions';

/**
 * Load gateway token from Clawdbot config
 */
export function loadGatewayToken() {
  const configPath = '/home/heisenberg/.clawdbot/clawdbot.json';
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      return cfg.gateway?.auth?.token;
    } catch {}
  }
  return null;
}

// Mode session IDs that should NOT be treated as the main session
// These are deterministic IDs used by SparkGPT mode routing
const MODE_SESSION_IDS = new Set([
  'spark-dev-00000-0000-0000-000000000001',
  'spark-res-00000-0000-0000-000000000002',
  'spark-pln-00000-0000-0000-000000000003',
  'spark-vid-00000-0000-0000-000000000004',
]);

// Default main session ID (WhatsApp main session)
const DEFAULT_MAIN_SESSION_ID = '1e4cdd11-d94a-4ed8-b686-029d5fb50ac1';

/**
 * Get main session ID dynamically from sessions.json
 * 
 * NOTE: OpenClaw CLI can overwrite the agent:main:main entry in sessions.json
 * when mode sessions use `openclaw agent --session-id`. We must detect this
 * and fall back to the known WhatsApp main session ID.
 */
export function getMainSessionId() {
  try {
    const sessionsPath = join(SESSIONS_DIR, 'sessions.json');
    if (existsSync(sessionsPath)) {
      const sessions = JSON.parse(readFileSync(sessionsPath, 'utf8'));
      const mainSession = sessions['agent:main:main'];
      if (mainSession?.sessionId) {
        // Guard: don't return a mode session ID as the main session
        if (MODE_SESSION_IDS.has(mainSession.sessionId)) {
          console.warn(`⚠️ sessions.json agent:main:main points to mode session ${mainSession.sessionId}, using default`);
          return DEFAULT_MAIN_SESSION_ID;
        }
        return mainSession.sessionId;
      }
    }
  } catch (e) {
    console.error('Failed to read main session ID:', e.message);
  }
  return DEFAULT_MAIN_SESSION_ID;
}

/**
 * Get the path to the main session file
 */
export function getMainSessionPath() {
  const sessionId = getMainSessionId();
  return join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

/**
 * Load recent history from main session
 */
export function loadSessionHistory(limit = 20) {
  try {
    const sessionPath = getMainSessionPath();
    if (!existsSync(sessionPath)) return [];
    
    const content = readFileSync(sessionPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);
    
    const messages = [];
    for (const line of lines.slice(-limit * 2)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message) {
          const msg = entry.message;
          if (msg.role === 'user' || msg.role === 'assistant') {
            let text = '';
            if (typeof msg.content === 'string') {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textPart = msg.content.find(c => c.type === 'text');
              text = textPart?.text || '';
            }
            
            // Skip heartbeats and system messages
            if (text.includes('HEARTBEAT') || text.includes('Read HEARTBEAT.md')) continue;
            
            // Clean WhatsApp markers
            text = text
              .replace(/^\[WhatsApp[^\]]*\]\s*/g, '')
              .replace(/\n?\[message_id:[^\]]+\]/g, '')
              .trim();
            
            if (text) {
              messages.push({ role: msg.role, content: text });
            }
          }
        }
      } catch {}
    }
    
    return messages.slice(-limit);
  } catch (e) {
    console.error('Failed to load session history:', e.message);
    return [];
  }
}

/**
 * Append message to main session
 */
export function appendToSessionSync(role, content) {
  try {
    const sessionPath = getMainSessionPath();
    const entry = {
      type: 'message',
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      message: {
        role,
        content: [{ type: 'text', text: `[Spark Portal] ${content}` }],
        timestamp: Date.now()
      }
    };
    appendFileSync(sessionPath, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to append to session:', e.message);
  }
}

/**
 * Extract text from message content (handles various formats)
 */
export function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textPart = content.find(c => c.type === 'text');
    return textPart?.text || '';
  }
  return '';
}

/**
 * Hash a message for deduplication
 */
export function hashMessage(text) {
  if (!text) return '';
  const str = text.trim().slice(0, 500);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}
