/**
 * SparkGPT - Shared Utilities
 * 
 * Common functions used across realtime.js, hybrid-realtime.js, and tools.js.
 * Eliminates duplication of key loading, session access, and context loading.
 */

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getMainSessionId, SESSIONS_DIR } from './session.js';

/**
 * Get OpenAI API key from clawdbot/openclaw config
 */
export function getOpenAIKey() {
  const configPath = '/home/heisenberg/.clawdbot/clawdbot.json';
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    return cfg.skills?.entries?.['openai-whisper-api']?.apiKey;
  }
  return null;
}

/**
 * Get gateway auth token from clawdbot/openclaw config
 */
export function getGatewayToken() {
  const configPath = '/home/heisenberg/.clawdbot/clawdbot.json';
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      return cfg.gateway?.auth?.token;
    } catch {}
  }
  return null;
}

/**
 * Get the current main session file path (dynamic, not hardcoded)
 */
function getSessionPath() {
  const sessionId = getMainSessionId();
  return join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

/**
 * Load recent conversation context from main session.
 * 
 * @param {Object} options
 * @param {number} options.limit - Max messages to return (default 10)
 * @param {string} options.format - 'messages' returns [{role, content}], 'text' returns formatted string
 * @param {number} options.maxLength - Max text length per message (default 1000)
 * @returns {Array|string} Messages array or formatted text string
 */
export function loadConversationContext({ limit = 10, format = 'messages', maxLength = 1000 } = {}) {
  try {
    const sessionPath = getSessionPath();
    if (!existsSync(sessionPath)) return format === 'text' ? '' : [];

    const content = readFileSync(sessionPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);

    const messages = [];
    for (const line of lines.slice(-limit * 3)) {
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

            // Skip system messages
            if (text.includes('HEARTBEAT') || text.includes('Read HEARTBEAT.md')) continue;
            if (text.includes('[Cron') || text.includes('systemEvent')) continue;

            // Clean markers
            text = text
              .replace(/^\[WhatsApp[^\]]*\]\s*/g, '')
              .replace(/^\[Spark[^\]]*\]\s*/g, '')
              .replace(/\n?\[message_id:[^\]]+\]/g, '')
              .trim();

            if (text && text.length < maxLength) {
              messages.push({ role: msg.role, content: text });
            }
          }
        }
      } catch {}
    }

    const result = messages.slice(-limit);

    if (format === 'text') {
      return result
        .map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`)
        .join('\n');
    }
    return result;
  } catch (e) {
    console.error('Failed to load context:', e.message);
    return format === 'text' ? '' : [];
  }
}

/**
 * Append a message to the main session file for continuity with text chat.
 * 
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - The message text
 * @param {string} source - Source tag, e.g. 'Spark Voice', 'Spark Voice Realtime' (default: 'Spark Voice')
 */
export function appendToSession(role, content, source = 'Spark Voice') {
  try {
    const sessionPath = getSessionPath();
    const entry = {
      type: 'message',
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      message: {
        role,
        content: [{ type: 'text', text: `[${source}] ${content}` }],
        timestamp: Date.now()
      }
    };
    appendFileSync(sessionPath, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to append to session:', e.message);
  }
}
