/**
 * ClawChat - Mode Session Router
 * 
 * Manages isolated OpenClaw sessions for each ClawChat mode (Dev, Research, Plan).
 * Each mode gets its own session with a deterministic ID, preventing mode tasks
 * from polluting the main WhatsApp conversation.
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync, statSync, watch, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { log, debug, error as logError } from './logger.js';
import { CLI_TIMEOUT_MS } from './constants.js';
import { SESSIONS_DIR, extractTextFromContent } from './services/session.js';
import { getSessionIndex, getLatestSession, createSession, updateSessionTitle, incrementMessageCount } from './mode-session-index.js';

const OPENCLAW_PATH = '/home/heisenberg/.npm-global/bin/openclaw';

// Mode-specific system prompts — injected into each mode session's messages
const MODE_SYSTEM_PROMPTS = {
  dev: `You are Spark in Dev Mode — a senior full-stack engineer. Your workspace is /home/heisenberg/clawd.

Guidelines:
- Read the relevant codebase before making changes
- Write clean, tested code with proper error handling
- Run syntax checks (node --check) and build steps before committing
- Commit each logical change separately with descriptive messages
- If tests exist, run them. If they don't, consider adding them.
- Restart services after backend changes (sudo systemctl restart <service>)
- Report what you did concisely: files changed, what was fixed/added, test results`,

  research: `You are Spark in Research Mode — a thorough researcher and analyst.

Guidelines:
- Search broadly across multiple sources (web, Twitter, Reddit, academic papers)
- Synthesize findings into a clear, well-structured report
- Include sources and citations
- Distinguish facts from speculation/opinion
- If deploying an HTML report, use the Netlify site: spark-researchbot.netlify.app (ID: b420af70-fa1d-43d3-ac35-405437ba2539)
- Deploy command: cd /home/heisenberg/clawd/research-reports && NETLIFY_AUTH_TOKEN=$(cat ~/.config/clawdbot/secrets/netlify-token) netlify deploy --prod --site b420af70-fa1d-43d3-ac35-405437ba2539 --dir .
- Present findings clearly with key takeaways upfront`,

  plan: `You are Spark in Plan Mode — a technical architect and strategic planner.

Guidelines:
- Break down complex tasks into clear phases with dependencies
- Identify risks and mitigation strategies for each phase
- Estimate effort/complexity for each phase
- Define success criteria and deliverables
- Consider edge cases and failure modes
- Output structured plans with: Overview, Phases, Dependencies, Risks, Timeline
- Be opinionated — recommend the best approach, don't just list options`,

  videogen: `You are Spark in Video Generation Mode.

Guidelines:
- Use the Replicate API for video generation (token at ~/.config/clawdbot/secrets/replicate-token)
- Support text-to-video, image-to-video, and face swap workflows
- Confirm inputs with the user before running expensive API calls
- Send results via WhatsApp when complete`
};

// Deterministic session IDs for each mode (fixed so the same mode always routes to the same session)
const MODE_SESSION_MAP = {
  dev:       { label: 'spark-dev-mode',       sessionId: 'spark-dev-00000-0000-0000-000000000001' },
  research:  { label: 'spark-research-mode',   sessionId: 'spark-res-00000-0000-0000-000000000002' },
  plan:      { label: 'spark-plan-mode',        sessionId: 'spark-pln-00000-0000-0000-000000000003' },
  videogen:  { label: 'spark-videogen-mode',    sessionId: 'spark-vid-00000-0000-0000-000000000004' },
};

/**
 * Get session config for a mode
 */
export function getModeSessionConfig(mode) {
  return MODE_SESSION_MAP[mode] || null;
}

/**
 * Watch a session's JSONL transcript file for new tool call entries
 * and send progress updates via the provided callback.
 * 
 * @param {string} sessionId - The OpenClaw session ID
 * @param {Function} sendProgress - Callback to send progress updates
 * @param {AbortSignal} abortSignal - Signal to stop watching
 * @returns {Function} - Cleanup function
 */
function watchSessionProgress(sessionId, sendProgress, abortSignal) {
  const transcriptPath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  let lastSize = 0;
  let watcher = null;
  let checkInterval = null;
  let stopped = false;

  function cleanup() {
    stopped = true;
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  }

  function processNewData() {
    if (stopped) return;
    try {
      const stat = statSync(transcriptPath);
      if (stat.size <= lastSize) return;

      const fd = openSync(transcriptPath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size - lastSize);
        readSync(fd, buffer, 0, buffer.length, lastSize);
        lastSize = stat.size;

        const newText = buffer.toString('utf8');
        const lines = newText.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const progress = extractProgress(entry);
            if (progress) sendProgress(progress);
          } catch {
            // Skip malformed lines
          }
        }
      } finally {
        closeSync(fd);
      }
    } catch (e) {
      // File might be temporarily unavailable, that's ok
      debug(`Transcript watch read error: ${e.message}`);
    }
  }

  function startWatching() {
    if (stopped) return;
    // Capture initial size so we only process new data
    try {
      lastSize = statSync(transcriptPath).size;
    } catch {
      lastSize = 0;
    }

    watcher = watch(transcriptPath, (eventType) => {
      if (eventType === 'change') processNewData();
    });

    watcher.on('error', (e) => {
      debug(`Transcript watcher error: ${e.message}`);
      cleanup();
    });
  }

  // The transcript file might not exist yet when session starts — poll for it
  if (existsSync(transcriptPath)) {
    startWatching();
  } else {
    checkInterval = setInterval(() => {
      if (stopped) { cleanup(); return; }
      if (existsSync(transcriptPath)) {
        clearInterval(checkInterval);
        checkInterval = null;
        startWatching();
      }
    }, 500);
  }

  // Cleanup on abort signal
  if (abortSignal) {
    abortSignal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

/**
 * Extract a human-readable progress message from a JSONL transcript entry.
 * Only returns progress for tool call entries.
 */
function extractProgress(entry) {
  if (entry.type !== 'message' || !entry.message) return null;
  const msg = entry.message;

  // Only care about assistant messages with tool calls
  if (msg.role === 'assistant' && Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.function?.name || 'working';
        const args = part.arguments || part.input || {};

        const progressMap = {
          'exec':        'Running command...',
          'read':        `Reading ${args.path || args.file_path || 'file'}...`,
          'Read':        `Reading ${args.path || args.file_path || 'file'}...`,
          'Edit':        `Editing ${args.path || args.file_path || 'file'}...`,
          'edit':        `Editing ${args.path || args.file_path || 'file'}...`,
          'Write':       `Writing ${args.path || args.file_path || 'file'}...`,
          'write':       `Writing ${args.path || args.file_path || 'file'}...`,
          'web_search':  `Searching: ${args.query || ''}...`,
          'web_fetch':   `Fetching ${args.url || 'page'}...`,
          'browser':     'Using browser...',
          'image':       'Analyzing image...',
          'sessions_spawn': 'Spawning sub-agent...',
        };

        return {
          type: 'progress',
          status: progressMap[name] || `${name}...`,
          tool: name,
          detail: typeof args === 'object' ? JSON.stringify(args).slice(0, 100) : ''
        };
      }
    }
  }

  return null;
}

/**
 * Route a message to an isolated mode session via OpenClaw CLI
 * 
 * @param {WebSocket} ws - WebSocket client
 * @param {string} sessionId - ClawChat session ID (for logging)
 * @param {string} mode - Mode name (dev, research, plan)
 * @param {string} text - User's message text
 * @param {Function} sendToClient - Function to send data back to the client
 * @param {string} [modeSessionId] - Optional specific mode session ID from the index
 * @returns {Promise<boolean>} - Whether the message was successfully routed
 */
export function routeModeMessage(ws, sessionId, mode, text, sendToClient, modeSessionId) {
  const modeConfig = getModeSessionConfig(mode);
  if (!modeConfig) {
    log(`❌ [${sessionId}] Unknown mode: ${mode}`);
    sendToClient(sessionId, { type: 'error', message: `Unknown mode: ${mode}` });
    sendToClient(sessionId, { type: 'done' });
    return Promise.resolve(false);
  }

  // Resolve the target session ID from the multi-session index
  let targetSessionId = modeSessionId;
  if (!targetSessionId) {
    // Use latest session, or create one if none exists
    let latestSession = getLatestSession(mode);
    if (!latestSession) {
      latestSession = createSession(mode);
    }
    targetSessionId = latestSession.id;
  }

  log(`🔀 [${sessionId}] Routing to ${modeConfig.label} (session: ${targetSessionId}): ${text.slice(0, 80)}...`);
  sendToClient(sessionId, { type: 'thinking' });

  // Auto-set session title from first message if not set
  const latestSession = getLatestSession(mode);
  if (latestSession && latestSession.id === targetSessionId && !latestSession.title) {
    const autoTitle = text.slice(0, 50).replace(/\n/g, ' ').trim();
    if (autoTitle) {
      updateSessionTitle(mode, targetSessionId, autoTitle);
    }
  }

  // Increment message count
  incrementMessageCount(mode, targetSessionId);

  // Prepend mode-specific system prompt as context
  const systemPrompt = MODE_SYSTEM_PROMPTS[mode];
  const fullMessage = systemPrompt
    ? `[System Context: ${systemPrompt}]\n\n${text}`
    : text;
  debug(`📋 [${sessionId}] Mode ${mode} system prompt: ${systemPrompt ? 'injected' : 'none'}`);

  return new Promise((resolve) => {
    const timeout = CLI_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let completed = false;

    // Start watching the transcript file for real-time progress updates
    const abortController = new AbortController();
    const stopWatching = watchSessionProgress(
      targetSessionId,
      (progress) => {
        debug(`📊 [${sessionId}] Progress: ${progress.status}`);
        sendToClient(sessionId, progress);
      },
      abortController.signal
    );

    // Use openclaw agent CLI with --session-id to target the mode session
    const proc = spawn(OPENCLAW_PATH, [
      'agent',
      '--session-id', targetSessionId,
      '--message', fullMessage,
      '--json'
    ], {
      timeout,
      env: { ...process.env }
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        abortController.abort();
        proc.kill('SIGTERM');
        logError(`[${sessionId}] Mode ${mode} timeout after ${timeout / 1000}s`);
        sendToClient(sessionId, { type: 'error', message: `${mode} mode request timed out` });
        sendToClient(sessionId, { type: 'done' });
        resolve(false);
      }
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      abortController.abort();
      if (completed) return;
      completed = true;

      try {
        if (code !== 0) {
          const errorText = stderr || stdout || '';
          throw new Error(`CLI exited with code ${code}: ${errorText.slice(0, 300)}`);
        }

        // Parse JSON output from CLI
        const result = JSON.parse(stdout);
        const payloads = result.result?.payloads || [];
        const reply = payloads.map(p => p.text).filter(Boolean).join('\n') ||
          `${mode} mode request processed.`;

        log(`✅ [${sessionId}] ${modeConfig.label} response: ${reply.slice(0, 100)}...`);
        sendToClient(sessionId, { type: 'text', content: reply });
        sendToClient(sessionId, { type: 'done' });
        resolve(true);
      } catch (e) {
        logError(`[${sessionId}] Mode ${mode} error:`, e.message);
        const errorMsg = e.message.includes('JSON')
          ? (stderr || stdout || 'Unknown error from mode session').slice(0, 500)
          : e.message;
        sendToClient(sessionId, { type: 'error', message: errorMsg });
        sendToClient(sessionId, { type: 'done' });
        resolve(false);
      }
    });

    proc.on('error', (e) => {
      clearTimeout(timeoutId);
      abortController.abort();
      if (completed) return;
      completed = true;

      logError(`[${sessionId}] Mode ${mode} spawn error:`, e.message);
      sendToClient(sessionId, { type: 'error', message: `Failed to run mode session: ${e.message}` });
      sendToClient(sessionId, { type: 'done' });
      resolve(false);
    });
  });
}

/**
 * Get message history for a mode session
 * Reads from the session's JSONL transcript file
 * 
 * @param {string} mode - Mode name (dev, research, plan)
 * @param {number} limit - Max messages to return
 * @param {string} [modeSessionId] - Optional specific session ID; defaults to latest
 * @returns {Array} - Array of {role, content} message objects
 */
export function getModeHistory(mode, limit = 50, modeSessionId) {
  const modeConfig = getModeSessionConfig(mode);
  if (!modeConfig) return [];

  // Resolve which session to read
  let targetSessionId = modeSessionId;
  let isLegacySession = false;
  if (!targetSessionId) {
    const latest = getLatestSession(mode);
    if (latest) {
      targetSessionId = latest.id;
      isLegacySession = !!latest.legacy;
    } else {
      // Fall back to legacy deterministic ID
      targetSessionId = modeConfig.sessionId;
      isLegacySession = true;
    }
  } else {
    // Check if specified session is legacy
    const index = getSessionIndex(mode);
    const sessionEntry = index.sessions.find(s => s.id === targetSessionId);
    isLegacySession = !!(sessionEntry && sessionEntry.legacy);
  }

  try {
    const sessionPath = join(SESSIONS_DIR, `${targetSessionId}.jsonl`);
    if (!existsSync(sessionPath)) {
      debug(`📦 No history file for ${modeConfig.label} (session: ${targetSessionId})`);
      return [];
    }

    const content = readFileSync(sessionPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);

    // For legacy sessions, we use a two-pass approach:
    // Pass 1: identify user messages that were sent via mode_message (they contain [System Context:])
    // Pass 2: pair those user messages with the assistant responses that follow them
    if (isLegacySession) {
      return parseLegacyModeHistory(lines, mode, limit);
    }

    // For new (clean) sessions, use simple filtering
    return parseCleanModeHistory(lines, limit);
  } catch (e) {
    logError(`Failed to read mode history for ${mode}:`, e.message);
    return [];
  }
}

/**
 * Parse legacy (polluted) session JSONL.
 * Legacy sessions contain ALL main session messages mixed in.
 * Only extract messages that were sent via mode_message (identified by [System Context:] wrapper).
 */
function parseLegacyModeHistory(lines, mode, limit) {
  const modePromptPrefix = MODE_SYSTEM_PROMPTS[mode]?.substring(0, 30) || 'You are Spark in';

  // First, extract all message entries in order
  const allEntries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      // For assistant messages, skip tool calls and thinking-only turns
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const hasToolCall = msg.content.some(c => c.type === 'toolCall' || c.type === 'tool_use');
        const hasThinking = msg.content.some(c => c.type === 'thinking');
        if (hasToolCall) continue;
        if (hasThinking && !msg.content.some(c => c.type === 'text')) continue;
      }

      const text = extractTextFromContent(msg.content);
      if (!text) continue;

      allEntries.push({
        role: msg.role,
        text,
        timestamp: msg.timestamp || Date.parse(entry.timestamp) || 0
      });
    } catch {
      // Skip malformed lines
    }
  }

  // Now walk through: only keep user messages that have [System Context:] (mode messages)
  // and the assistant response(s) that immediately follow each such user message.
  const messages = [];
  let expectAssistantResponse = false;

  for (const entry of allEntries) {
    if (entry.role === 'user') {
      // Check if this is a mode_message (has System Context wrapper)
      if (entry.text.includes('[System Context:')) {
        // Extract the actual user message after the system context
        let userText = extractUserTextFromSystemContext(entry.text);
        if (userText) {
          // Strip timestamp prefix if present
          userText = userText.replace(/^\[\w{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\w+\]\s*/, '').trim();
          if (userText) {
            messages.push({
              role: 'user',
              content: userText,
              timestamp: entry.timestamp
            });
            expectAssistantResponse = true;
          }
        }
      } else {
        // Not a mode message — skip it and stop expecting assistant response
        expectAssistantResponse = false;
      }
    } else if (entry.role === 'assistant') {
      if (expectAssistantResponse) {
        let text = entry.text;
        // Skip empty or very short assistant responses
        if (text && text.length > 0) {
          // Additional sanity filters for assistant responses
          if (text.length > 10000) { continue; } // Truncated or huge — skip
          if (text.includes('HEARTBEAT_OK')) { expectAssistantResponse = false; continue; }

          messages.push({
            role: 'assistant',
            content: text,
            timestamp: entry.timestamp
          });
          expectAssistantResponse = false; // Got the response, stop looking
        }
      }
      // If not expecting a response, skip this assistant message (it's from the main session)
    }
  }

  return messages.slice(-limit);
}

/**
 * Extract the actual user text from a [System Context: ...]\n\nUser message format
 */
function extractUserTextFromSystemContext(text) {
  const contextStart = text.indexOf('[System Context:');
  if (contextStart === -1) return text;

  // Find the closing ']' followed by '\n\n'
  const contextEnd = text.indexOf(']\n\n', contextStart);
  if (contextEnd !== -1) {
    const afterContext = text.slice(contextEnd + 3).trim();
    return afterContext || null;
  }

  // Try just ']' at end of line
  const bracketEnd = text.indexOf(']\n', contextStart);
  if (bracketEnd !== -1) {
    const afterBracket = text.slice(bracketEnd + 2).trim();
    return afterBracket || null;
  }

  return null; // System context only, no actual message
}

/**
 * Parse clean (non-legacy) session JSONL — simple filtering only.
 */
function parseCleanModeHistory(lines, limit) {
  const messages = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message' || !entry.message) continue;

      const msg = entry.message;
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      // For assistant messages, skip tool calls and thinking-only turns
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const hasToolCall = msg.content.some(c => c.type === 'toolCall' || c.type === 'tool_use');
        const hasThinking = msg.content.some(c => c.type === 'thinking');
        if (hasToolCall) continue;
        if (hasThinking && !msg.content.some(c => c.type === 'text')) continue;
      }

      let text = extractTextFromContent(msg.content);
      if (!text) continue;

      // Skip heartbeat messages
      if (text.includes('HEARTBEAT') || text.includes('Read HEARTBEAT.md')) continue;

      // Skip WhatsApp metadata leakage
      if (text.includes('[WhatsApp ') || text.includes('[message_id:') || text.includes('[media attached:')) continue;

      // Skip gateway status messages
      if (text.includes('WhatsApp gateway disconnected') || text.includes('WhatsApp gateway connected')) continue;

      // Skip messages with huge content
      if (text.length > 10000) continue;

      // Strip [System Context: ...] wrapper from user messages
      if (text.includes('[System Context:')) {
        const extracted = extractUserTextFromSystemContext(text);
        if (extracted) {
          text = extracted;
        } else {
          continue;
        }
      }

      // Strip timestamp prefix if present: [Sat 2026-02-07 07:43 UTC] ...
      text = text.replace(/^\[\w{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\w+\]\s*/, '').trim();

      if (!text) continue;

      messages.push({
        role: msg.role,
        content: text,
        timestamp: msg.timestamp || Date.parse(entry.timestamp) || 0
      });
    } catch {
      // Skip malformed lines
    }
  }

  return messages.slice(-limit);
}

/**
 * Get all active mode sessions
 * Checks which mode session files exist and have been recently updated
 * 
 * @returns {Object} - Map of mode name to session status
 */
export function getActiveModeSessions() {
  const result = {};

  for (const [mode, config] of Object.entries(MODE_SESSION_MAP)) {
    // Use the session index to determine the latest session for this mode
    const latest = getLatestSession(mode);
    
    if (latest) {
      const sessionPath = join(SESSIONS_DIR, `${latest.id}.jsonl`);
      let isRecent = false;
      let lastUpdated = 0;
      
      if (existsSync(sessionPath)) {
        try {
          const stat = statSync(sessionPath);
          lastUpdated = stat.mtimeMs;
          // Only mark as "active" if the JSONL was modified in last 5 minutes
          // AND this is NOT a legacy session (legacy files get touched by the main session)
          if (latest.legacy) {
            // Legacy sessions are never "active" — they're historical
            isRecent = false;
          } else {
            isRecent = (Date.now() - stat.mtimeMs) < 5 * 60 * 1000;
          }
        } catch {
          // stat failed
        }
      }
      
      result[mode] = {
        label: config.label,
        sessionId: latest.id,
        exists: true,
        active: isRecent,
        lastUpdated
      };
    } else {
      result[mode] = {
        label: config.label,
        sessionId: config.sessionId,
        exists: false,
        active: false,
        lastUpdated: 0
      };
    }
  }

  return result;
}
