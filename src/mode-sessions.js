/**
 * SparkGPT - Mode Session Router
 * 
 * Manages isolated OpenClaw sessions for each Spark mode (Dev, Research, Plan).
 * Each mode gets its own session with a deterministic ID, preventing mode tasks
 * from polluting the main WhatsApp conversation.
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { log, debug, error as logError } from './logger.js';
import { CLI_TIMEOUT_MS } from './constants.js';
import { SESSIONS_DIR, extractTextFromContent } from './services/session.js';

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
 * Route a message to an isolated mode session via OpenClaw CLI
 * 
 * @param {WebSocket} ws - WebSocket client
 * @param {string} sessionId - SparkGPT session ID (for logging)
 * @param {string} mode - Mode name (dev, research, plan)
 * @param {string} text - User's message text
 * @param {Function} sendToClient - Function to send data back to the client
 * @returns {Promise<boolean>} - Whether the message was successfully routed
 */
export function routeModeMessage(ws, sessionId, mode, text, sendToClient) {
  const modeConfig = getModeSessionConfig(mode);
  if (!modeConfig) {
    log(`❌ [${sessionId}] Unknown mode: ${mode}`);
    sendToClient(sessionId, { type: 'error', message: `Unknown mode: ${mode}` });
    sendToClient(sessionId, { type: 'done' });
    return Promise.resolve(false);
  }

  log(`🔀 [${sessionId}] Routing to ${modeConfig.label}: ${text.slice(0, 80)}...`);
  sendToClient(sessionId, { type: 'thinking' });

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

    // Use openclaw agent CLI with --session-id to target the isolated mode session
    const proc = spawn(OPENCLAW_PATH, [
      'agent',
      '--session-id', modeConfig.sessionId,
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
        proc.kill('SIGTERM');
        logError(`[${sessionId}] Mode ${mode} timeout after ${timeout / 1000}s`);
        sendToClient(sessionId, { type: 'error', message: `${mode} mode request timed out` });
        sendToClient(sessionId, { type: 'done' });
        resolve(false);
      }
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
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
 * @returns {Array} - Array of {role, content} message objects
 */
export function getModeHistory(mode, limit = 50) {
  const modeConfig = getModeSessionConfig(mode);
  if (!modeConfig) return [];

  try {
    const sessionPath = join(SESSIONS_DIR, `${modeConfig.sessionId}.jsonl`);
    if (!existsSync(sessionPath)) {
      debug(`📦 No history file for ${modeConfig.label}`);
      return [];
    }

    const content = readFileSync(sessionPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);

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

        const text = extractTextFromContent(msg.content);
        if (!text) continue;

        // Skip system/heartbeat messages
        if (text.includes('HEARTBEAT') || text.includes('Read HEARTBEAT.md')) continue;

        messages.push({
          role: msg.role,
          content: text,
          timestamp: msg.timestamp || Date.parse(entry.timestamp) || 0
        });
      } catch {
        // Skip malformed lines
      }
    }

    // Return last N messages
    return messages.slice(-limit);
  } catch (e) {
    logError(`Failed to read mode history for ${mode}:`, e.message);
    return [];
  }
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
    const sessionPath = join(SESSIONS_DIR, `${config.sessionId}.jsonl`);

    if (existsSync(sessionPath)) {
      try {
        const stat = statSync(sessionPath);
        const isRecent = (Date.now() - stat.mtimeMs) < 5 * 60 * 1000; // Active if modified in last 5 min

        result[mode] = {
          label: config.label,
          sessionId: config.sessionId,
          exists: true,
          active: isRecent,
          lastUpdated: stat.mtimeMs
        };
      } catch {
        result[mode] = {
          label: config.label,
          sessionId: config.sessionId,
          exists: true,
          active: false,
          lastUpdated: 0
        };
      }
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
