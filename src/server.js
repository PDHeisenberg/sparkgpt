/**
 * Spark Voice Server - Three Modes
 * 
 * Voice Mode: Fast conversational (Haiku)
 * Chat Mode: Deep thinking (Opus), files, links
 * Notes Mode: Record, transcribe, summarize
 * 
 * v83 - Session Unification: Spark Portal ↔ WhatsApp share same context
 * v84 - Fix scroll lock: only auto-scroll to bottom if user is near bottom
 * v85 - TRUE UNIFICATION: ALL messages route through Clawdbot main session (same as WhatsApp)
 * v86 - Fix duplicate responses: CLI responses added to hash set, sync skips them
 * v87 - Better dedup: track processing clients, sync skips assistant msgs for them
 * v88 - PROPER FIX: Only sync user + pure-text assistant messages, skip toolCall/toolResult/thinking
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import express from 'express';
import compression from 'compression';
import { readFileSync, existsSync, writeFileSync, mkdirSync, watch } from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TTSProvider } from './providers/tts.js';
import { loadConfig } from './config.js';
import { handleRealtimeSession } from './realtime.js';
import { handleHybridRealtimeSession } from './hybrid-realtime.js';
import {
  UNIFIED_SESSION,
  UNIFIED_GATEWAY_URL,
  UNIFIED_HOOK_TOKEN,
  UNIFIED_SESSION_KEY,
  checkGatewayStatus,
  queueMessage,
  drainMessageQueue,
  startQueueDrainTimer,
  isConnectingError,
  sendToMainSession,
  setQueueCallbacks,
  setGatewayConnecting
} from './services/gateway.js';
import {
  SESSIONS_DIR,
  loadGatewayToken,
  getMainSessionId,
  getMainSessionPath,
  loadSessionHistory,
  appendToSessionSync,
  extractTextFromContent,
  hashMessage
} from './services/session.js';
import {
  CLI_TIMEOUT_MS,
  CHAT_TIMEOUT_MS,
  WS_MAX_PAYLOAD,
  WS_HEARTBEAT_INTERVAL_MS,
  STALE_SESSION_MAX_AGE_MS,
  ACTIVE_SESSION_THRESHOLD_MS,
  SYNC_POLL_INTERVAL_MS,
  SYNC_DEBOUNCE_MS,
  MAX_HASH_CACHE,
  MAX_FILE_TEXT_CLI,
} from './constants.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

console.log(`🔗 Session Unification: ${UNIFIED_SESSION ? 'ENABLED (shared with WhatsApp)' : 'DISABLED (isolated)'}`);

// Gateway service imported from ./services/gateway.js

// Models for different modes
const MODELS = {
  voice: 'gemini-3-flash',                 // Fastest (Gemini 3 Flash)
  chat: 'claude-opus-4-5-20250514',        // Deep thinking (Opus 4.5)
  notes: 'claude-opus-4-5-20250514'        // Summary (Opus 4.5)
};

// Gateway connection
const GATEWAY_URL = config.llm?.gatewayUrl || 'http://localhost:18789';
const GATEWAY_TOKEN = config.llm?.gatewayToken || loadGatewayToken();

// TTS
const tts = new TTSProvider(config.tts);

// Session utilities imported from ./services/session.js
const MAIN_SESSION_ID = getMainSessionId();
const MAIN_SESSION_PATH = getMainSessionPath();

console.log(`🧠 Models: Voice=${MODELS.voice}, Chat=${MODELS.chat}`);
console.log(`📁 Shared session: ${MAIN_SESSION_ID}`);

// Express app
const app = express();

// Enable gzip compression (reduces ~117KB app.js to ~25KB)
app.use(compression());

// Cache static files for 1 hour, but not API routes
app.use(express.static(join(__dirname, '../public'), { 
  etag: true,
  maxAge: '1h',
  setHeaders: (res, path) => {
    // Don't cache HTML (for updates)
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// No caching for API routes
app.use('/api', (req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

app.get('/api/config', (req, res) => {
  res.json({ modes: Object.keys(MODELS) });
});

// Articulations endpoint - refine text for clarity
app.post('/api/articulate', express.json(), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    const systemPrompt = `You are a text refinement tool. You ONLY rephrase text. You NEVER answer questions.

CRITICAL: If the user's input is a question, OUTPUT THE SAME QUESTION but with better grammar. DO NOT ANSWER IT.

Example:
INPUT: "hey can u help me fix this thing its broken"
OUTPUT: "Hey, can you help me fix this? It's broken."

NOT: "Sure, I can help! What seems to be the problem?"

Rules:
- Rephrase for clarity, crispness, and grammar
- Keep the rephrased text as close to original as possible
- Maintain original length, tone, and essence
- NEVER answer questions - just make them grammatically correct
- No dashes, no bold, no text decorations
- Points only if input has points
- Sound human and natural
- Output ONLY the refined text - no "Here's the refined version", no greetings, nothing extra

You are NOT a chatbot. You are NOT helpful. You ONLY output cleaner versions of input text.`;

    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || '';
    
    res.json({ result: result.trim() });
  } catch (e) {
    console.error('Articulate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fetch chat history from session files
import { readdirSync, statSync } from 'fs';

// extractTextFromContent imported from ./services/session.js

app.get('/api/sessions', async (req, res) => {
  try {
    const files = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const filepath = join(SESSIONS_DIR, f);
        const stat = statSync(filepath);
        const content = readFileSync(filepath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l);
        
        // Get last user message as preview
        let preview = 'No messages';
        let channel = 'spark';
        
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            // Handle Clawdbot transcript format: {"type":"message","message":{...}}
            const msg = entry.message || entry;
            if (msg.role === 'user') {
              const text = extractTextFromContent(msg.content);
              if (text) {
                // Check if WhatsApp
                if (text.includes('[message_id:') || text.includes('[WhatsApp')) channel = 'whatsapp';
                
                // Clean up preview - remove all metadata
                preview = text
                  .replace(/^\[WhatsApp[^\]]*\]\s*/g, '')
                  .replace(/\n?\[message_id:[^\]]+\]/g, '')
                  .replace(/^\[Chat messages since[^\]]*\]\n?/gm, '')
                  .replace(/^\[Current message[^\]]*\]\n?/gm, '')
                  .replace(/^User:\s*/gm, '')
                  .replace(/^Assistant:[^\n]*\n?/gm, '')
                  .trim()
                  .slice(0, 100);
                
                // Skip if preview is empty after cleaning
                if (!preview) continue;
                break;
              }
            }
          } catch {}
        }
        
        return {
          key: f.replace('.jsonl', ''),
          channel,
          updatedAt: stat.mtimeMs,
          preview,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
    
    res.json({ sessions: files });
  } catch (e) {
    console.error('Sessions fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fetch specific session history
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const filepath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
    
    if (!existsSync(filepath)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const content = readFileSync(filepath, 'utf8');
    const messages = content.trim().split('\n')
      .filter(l => l)
      .map(l => {
        try {
          const entry = JSON.parse(l);
          // Handle Clawdbot transcript format
          if (entry.type === 'message' && entry.message) {
            return entry.message;
          }
          return null;
        } catch { return null; }
      })
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'));
    
    res.json({ messages });
  } catch (e) {
    console.error('Session history error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fetch ALL messages from ALL sessions - unified chat feed (Web + WhatsApp only)
app.get('/api/messages/all', async (req, res) => {
  try {
    const allMessages = [];
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    
    // Patterns to exclude (heartbeats, cron, system)
    const excludePatterns = [
      'Read HEARTBEAT.md',
      'HEARTBEAT_OK',
      'Cron:',
      '[Cron job',
      'systemEvent',
    ];
    
    for (const f of files) {
      const filepath = join(SESSIONS_DIR, f);
      const content = readFileSync(filepath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      
      // Determine session type from filename
      const isSparkSession = f.startsWith('spark_');
      
      // First pass: check if this session has any WhatsApp messages
      const hasWhatsApp = content.includes('[WhatsApp');
      
      // Skip sessions that are neither Spark nor WhatsApp
      if (!isSparkSession && !hasWhatsApp) continue;
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Handle Clawdbot transcript format
          if (entry.type === 'message' && entry.message) {
            const msg = entry.message;
            if (msg.role === 'user' || msg.role === 'assistant') {
              // Extract text content
              let text = extractTextFromContent(msg.content);
              if (!text) continue;
              
              // Determine channel for this message
              const isWhatsAppMsg = text.includes('[WhatsApp');
              
              // Skip heartbeats, cron, system messages
              if (excludePatterns.some(p => text.includes(p))) continue;
              
              // Clean up the text
              text = text
                .replace(/^\[WhatsApp[^\]]*\]\s*/g, '')
                .replace(/\n?\[message_id:[^\]]+\]/g, '')
                .replace(/^\[Chat messages since[^\]]*\]\n?/gm, '')
                .replace(/^\[Current message[^\]]*\]\n?/gm, '')
                .replace(/^User:\s*/gm, '')
                .replace(/^Assistant:\s*/gm, '')
                .trim();
              
              if (!text) continue;
              
              // Get timestamp
              const timestamp = msg.timestamp || entry.timestamp || Date.parse(entry.timestamp) || 0;
              
              allMessages.push({
                role: msg.role,
                text,
                channel: hasWhatsApp ? 'whatsapp' : 'web',
                timestamp: typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp
              });
            }
          }
        } catch {}
      }
    }
    
    // Sort by timestamp (oldest first for chat display)
    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    
    // Return last 100 messages to keep it manageable
    const recent = allMessages.slice(-100);
    
    res.json({ messages: recent });
  } catch (e) {
    console.error('All messages fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fetch recent messages since a timestamp (for catch-up after reconnection)
app.get('/api/messages/recent', async (req, res) => {
  try {
    const since = parseInt(req.query.since) || 0;
    const recentMessages = [];
    
    // Read main session file
    const currentSessionId = getMainSessionId();
    const sessionPath = join(SESSIONS_DIR, `${currentSessionId}.jsonl`);
    
    if (!existsSync(sessionPath)) {
      return res.json({ messages: [] });
    }
    
    const content = readFileSync(sessionPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);
    
    // Read last 50 lines for efficiency
    const recentLines = lines.slice(-50);
    
    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message' || !entry.message) continue;
        
        const msg = entry.message;
        const msgTimestamp = msg.timestamp || Date.parse(entry.timestamp) || 0;
        
        // Skip messages before the requested timestamp
        if (msgTimestamp <= since) continue;
        
        const text = typeof msg.content === 'string' ? msg.content :
                    (Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text')?.text : null);
        
        if (!text) continue;
        
        // Skip heartbeats and system messages
        if (text.includes('HEARTBEAT') || text.includes('Read HEARTBEAT.md')) continue;
        
        // Clean up text
        const cleanText = text
          .replace(/^\[WhatsApp[^\]]*\]\s*/g, '')
          .replace(/\n?\[message_id:[^\]]+\]/g, '')
          .replace(/^\[Spark Web\]\s*/g, '')
          .trim();
        
        if (!cleanText) continue;
        
        recentMessages.push({
          role: msg.role === 'assistant' ? 'bot' : 'user',
          text: cleanText,
          timestamp: msgTimestamp
        });
      } catch {}
    }
    
    // Sort by timestamp
    recentMessages.sort((a, b) => a.timestamp - b.timestamp);
    
    res.json({ messages: recentMessages });
  } catch (e) {
    console.error('Recent messages fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Node status endpoint - check if PC is connected
const OPENCLAW_PATH = '/home/heisenberg/.npm-global/bin/openclaw';

// Wake-on-LAN config
const PC_MAC_ADDRESS = '8C:86:DD:61:3D:16';

// Wake-on-LAN endpoint
import dgram from 'dgram';

app.post('/api/nodes/wake', async (req, res) => {
  try {
    // Create magic packet
    const mac = PC_MAC_ADDRESS.replace(/[:-]/g, '');
    const macBuffer = Buffer.from(mac, 'hex');
    
    // Magic packet: 6 bytes of 0xFF + MAC repeated 16 times
    const magicPacket = Buffer.alloc(102);
    
    // First 6 bytes = 0xFF
    for (let i = 0; i < 6; i++) {
      magicPacket[i] = 0xFF;
    }
    
    // Repeat MAC 16 times
    for (let i = 0; i < 16; i++) {
      macBuffer.copy(magicPacket, 6 + i * 6);
    }
    
    // Send UDP broadcast
    const socket = dgram.createSocket('udp4');
    
    socket.on('error', (err) => {
      console.error('WoL socket error:', err);
      socket.close();
    });
    
    socket.bind(() => {
      socket.setBroadcast(true);
      
      // Send to broadcast address on port 9
      socket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', (err) => {
        if (err) {
          console.error('WoL send error:', err);
          res.json({ success: false, error: err.message });
        } else {
          console.log(`🔌 WoL packet sent to ${PC_MAC_ADDRESS}`);
          res.json({ success: true, mac: PC_MAC_ADDRESS });
        }
        socket.close();
      });
    });
  } catch (e) {
    console.error('WoL error:', e.message);
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/nodes/status', async (req, res) => {
  try {
    // Use openclaw CLI to get node status
    const output = execSync(`${OPENCLAW_PATH} nodes status --json`, { 
      encoding: 'utf8',
      timeout: 5000 
    });
    
    const data = JSON.parse(output);
    const nodes = data.nodes || [];
    
    // Find Parth's PC node
    const pcNode = nodes.find(n => n.displayName?.includes('PC') || n.platform === 'win32');
    
    res.json({
      connected: pcNode?.connected || false,
      nodeName: pcNode?.displayName || null,
      platform: pcNode?.platform || null,
    });
  } catch (e) {
    console.error('Node status error:', e.message);
    res.json({ connected: false, error: e.message });
  }
});

// Active sessions from OpenClaw gateway (running agents)
app.get('/api/active-sessions', async (req, res) => {
  try {
    // Use CLI to get sessions (more reliable than HTTP API)
    const output = execSync(`${OPENCLAW_PATH} sessions list --json --limit 20`, {
      encoding: 'utf8',
      timeout: 5000
    });
    
    const data = JSON.parse(output);
    const sessions = data.sessions || [];
    
    // Filter to recent active sessions (updated in last 5 minutes)
    const fiveMinutesAgo = Date.now() - ACTIVE_SESSION_THRESHOLD_MS;
    const activeSessions = sessions
      .filter(s => s.updatedAt > fiveMinutesAgo)
      .map(s => ({
        key: s.key,
        label: s.label || (s.key?.includes('subagent') ? s.key.split(':').pop().slice(0, 8) : 'main'),
        kind: s.kind,
        updatedAt: s.updatedAt,
        isMain: s.key === 'agent:main:main',
        isSubagent: s.key?.includes('subagent'),
        model: s.model
      }));
    
    res.json({
      count: activeSessions.length,
      thinking: false, // Will be set by frontend based on isProcessing
      sessions: activeSessions
    });
  } catch (e) {
    console.error('Active sessions error:', e.message);
    res.json({ count: 0, thinking: false, sessions: [], error: e.message });
  }
});

// Fetch today's reports from session messages (briefings sent to user)
app.get('/api/reports/today', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    
    const reports = [];
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    
    // Report patterns to look for
    const reportPatterns = [
      '☀️ MORNING',
      '📊 MARKET RECAP',
      '🔬 SCIENCE UPDATE',
      '🌍 GEOPOLITICS',
      '📈 PRE-MARKET',
      '🤖 AI/TECH',
      'MORNING BRIEFING',
      'MARKET RECAP',
      'SCIENCE UPDATE',
      'GEOPOLITICS UPDATE',
      'PRE-MARKET BRIEFING',
      'AI/TECH EVENING'
    ];
    
    for (const f of files) {
      const filepath = join(SESSIONS_DIR, f);
      const stat = statSync(filepath);
      
      // Skip files not modified today
      if (stat.mtimeMs < todayMs) continue;
      
      const content = readFileSync(filepath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'message' && entry.message) {
            const msg = entry.message;
            
            // Only assistant messages
            if (msg.role !== 'assistant') continue;
            
            // Get timestamp
            const timestamp = msg.timestamp || Date.parse(entry.timestamp) || 0;
            if (timestamp < todayMs) continue;
            
            // Get text content
            let text = extractTextFromContent(msg.content);
            if (!text || text.length < 200) continue;
            
            // Check if it matches report patterns
            const isReport = reportPatterns.some(p => text.toUpperCase().includes(p.toUpperCase()));
            if (!isReport) continue;
            
            // Skip duplicates (same first 100 chars)
            const preview = text.slice(0, 100);
            if (reports.some(r => r.summary.slice(0, 100) === preview)) continue;
            
            reports.push({
              timestamp,
              summary: text
            });
          }
        } catch {}
      }
    }
    
    // Sort by timestamp (oldest first)
    reports.sort((a, b) => a.timestamp - b.timestamp);
    
    res.json({ reports });
  } catch (e) {
    console.error('Reports fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// NOTES API
// ============================================================================

// Save note to memory (appends to MEMORY.md)
app.post('/api/notes/save-memory', express.json(), async (req, res) => {
  try {
    const { transcription, summary, timestamp } = req.body;
    const date = new Date(timestamp || Date.now());
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toLocaleTimeString('en-SG', { 
      timeZone: 'Asia/Singapore',
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    const memoryPath = '/home/heisenberg/clawd/MEMORY.md';
    let content = existsSync(memoryPath) ? readFileSync(memoryPath, 'utf8') : '# MEMORY\n\n';
    
    // Add note entry
    const noteEntry = `\n## Voice Note (${dateStr} ${timeStr})\n\n**Transcription:** ${transcription}\n\n**Summary:** ${summary}\n`;
    content += noteEntry;
    
    writeFileSync(memoryPath, content);
    res.json({ success: true });
  } catch (e) {
    console.error('Save to memory failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Save note to file (creates dated note file)
app.post('/api/notes/save-file', express.json(), async (req, res) => {
  try {
    const { transcription, summary, timestamp } = req.body;
    const date = new Date(timestamp || Date.now());
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    const notesDir = '/home/heisenberg/clawd/notes';
    if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
    
    const filename = `note-${dateStr}-${timeStr}.md`;
    const filepath = join(notesDir, filename);
    
    const content = `# Voice Note\n\n**Date:** ${date.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n\n## Transcription\n\n${transcription}\n\n## Summary\n\n${summary}\n`;
    
    writeFileSync(filepath, content);
    res.json({ success: true, filename });
  } catch (e) {
    console.error('Save to file failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// HTTP server
const server = createServer(app);

// WebSocket server for chat/notes (existing)
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

// WebSocket server for realtime voice (new)
const wssRealtime = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade - route to correct server
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  // Default to pure realtime (fast GPT-4o), hybrid only if explicitly requested
  const useHybrid = url.searchParams.get('mode') === 'hybrid';
  
  console.log(`🔌 WebSocket upgrade request: ${pathname}`);
  
  // Route /realtime to realtime voice handler
  if (pathname === '/realtime' || pathname.endsWith('/realtime')) {
    wssRealtime.handleUpgrade(request, socket, head, (ws) => {
      if (useHybrid) {
        console.log('🎙️ Hybrid mode (STT → Claude → TTS)');
        handleHybridRealtimeSession(ws);
      } else {
        console.log('🎙️ Pure Realtime mode (GPT-4o end-to-end)');
        handleRealtimeSession(ws);
      }
    });
  } else {
    // Route everything else to existing handler (chat/notes)
    console.log('💬 Chat WebSocket connection');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// Session store
const sessions = new Map();

// ============================================================================
// UNIFIED SESSION - Real-time sync polling
// ============================================================================
const portalClients = new Set(); // Track all connected portal WebSocket clients
const processingClients = new Set(); // Clients waiting for CLI response - don't sync assistant msgs to them
// Initialize from last message in session file, not Date.now() (avoids missing recent messages)
let lastSyncTimestamp = 0; // Will be set from session file on first poll
let lastSyncedMessageId = null;
let syncInitialized = false;

// Track recently sent message IDs to avoid duplicate sync (by content hash)
const recentlySentHashes = new Set();
// MAX_HASH_CACHE imported from constants.js
// hashMessage imported from ./services/session.js

// Poll the main session transcript for new messages and broadcast to portal clients
async function pollForSync() {
  if (!UNIFIED_SESSION || portalClients.size === 0) return;
  
  try {
    // Re-read main session ID in case it changed
    const currentSessionId = getMainSessionId();
    const sessionPath = join(SESSIONS_DIR, `${currentSessionId}.jsonl`);
    
    if (!existsSync(sessionPath)) return;
    
    const content = readFileSync(sessionPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);
    
    // Initialize lastSyncTimestamp from the last message on first poll
    // This ensures we don't re-sync old messages but also don't miss recent ones
    if (!syncInitialized) {
      syncInitialized = true;
      const lastLines = lines.slice(-5);
      for (let i = lastLines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lastLines[i]);
          if (entry.message?.timestamp) {
            lastSyncTimestamp = entry.message.timestamp;
            console.log(`📡 Sync initialized from timestamp: ${new Date(lastSyncTimestamp).toISOString()}`);
            break;
          }
        } catch {}
      }
      return; // Skip first poll to avoid re-syncing recent messages
    }
    
    // Check last 10 entries for new messages
    const recentLines = lines.slice(-10);
    
    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message' || !entry.message) continue;
        
        const msg = entry.message;
        const msgTimestamp = msg.timestamp || Date.parse(entry.timestamp) || 0;
        const msgId = entry.id;
        
        // Skip if we've already synced this message (by timestamp)
        if (msgTimestamp <= lastSyncTimestamp) continue;
        if (msgId && msgId === lastSyncedMessageId) continue;
        
        // ONLY sync user and assistant messages - skip toolResult, toolCall, thinking, etc.
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;
        
        // For assistant messages, check if it's a pure text response (not tool calls/thinking)
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          // Check if content contains toolCall or thinking blocks
          const hasToolCall = msg.content.some(c => c.type === 'toolCall' || c.type === 'tool_use');
          const hasThinking = msg.content.some(c => c.type === 'thinking');
          // Skip if this is a tool-use turn (not a final response)
          if (hasToolCall) continue;
          // If it's ONLY thinking with no text, skip
          if (hasThinking && !msg.content.some(c => c.type === 'text')) continue;
        }
        
        const text = typeof msg.content === 'string' ? msg.content :
                    (Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text')?.text : null);
        
        if (!text) continue;
        
        // Skip USER messages from Spark Portal (to avoid echo of what you just typed)
        // BUT allow assistant responses to be synced (they don't have [Spark Web] tag when from gateway)
        if (msg.role === 'user' && (text.includes('[Spark Web]') || text.includes('[Spark Portal]'))) continue;
        
        // Skip heartbeats and system messages
        if (text.includes('HEARTBEAT') || text.includes('Read HEARTBEAT.md')) continue;
        
        // Clean up text for display
        let cleanText = text
          .replace(/^\[WhatsApp[^\]]*\]\s*/g, '')
          .replace(/\n?\[message_id:[^\]]+\]/g, '')
          .replace(/^\[Spark Web\]\s*/g, '')
          .trim();
        
        if (!cleanText) continue;
        
        // Check content hash to avoid duplicates (more reliable than timestamp)
        const contentHash = hashMessage(cleanText);
        if (recentlySentHashes.has(contentHash)) continue;
        
        // Determine source (WhatsApp or other)
        const isWhatsApp = text.includes('[WhatsApp') || text.includes('[message_id:');
        const isSparkWeb = text.includes('[Spark Web]');
        const source = isWhatsApp ? 'whatsapp' : (isSparkWeb ? 'web' : 'other');
        
        // Skip portal-originated messages (user already sees them locally)
        // Assistant responses to portal are handled by hash check above (recentlySentHashes)
        if (isSparkWeb) {
          lastSyncTimestamp = msgTimestamp;
          if (msgId) lastSyncedMessageId = msgId;
          continue;
        }
        
        // Broadcast to portal clients (WhatsApp messages + responses to them)
        const syncPayload = JSON.stringify({
          type: 'sync',
          message: {
            role: msg.role === 'assistant' ? 'bot' : 'user',
            text: cleanText,
            source,
            timestamp: msgTimestamp
          }
        });
        
        for (const client of portalClients) {
          if (client.readyState === 1) { // WebSocket.OPEN
            // Skip assistant messages for clients waiting for CLI response
            // They'll get the response directly from CLI
            if (msg.role === 'assistant' && processingClients.has(client)) {
              console.log(`📡 Skipping sync to processing client`);
              continue;
            }
            try {
              client.send(syncPayload);
            } catch (e) {
              console.error('Failed to send sync to client:', e.message);
            }
          }
        }
        
        // Update tracking
        lastSyncTimestamp = msgTimestamp;
        if (msgId) lastSyncedMessageId = msgId;
        
        // Track hash to prevent re-syncing
        recentlySentHashes.add(contentHash);
        if (recentlySentHashes.size > MAX_HASH_CACHE) {
          // Clear oldest entries (Set maintains insertion order)
          const iter = recentlySentHashes.values();
          for (let i = 0; i < 20; i++) recentlySentHashes.delete(iter.next().value);
        }
        
        console.log(`📡 Synced ${msg.role} message from ${source}: ${cleanText.slice(0, 50)}...`);
      } catch (parseErr) {
        // Skip malformed lines
      }
    }
  } catch (e) {
    console.error('Sync poll error:', e.message);
  }
}

// Start sync with file watching (instant) + backup polling (fallback)
let syncDebounceTimer = null;
let fileWatcher = null;

function debouncedSync() {
  // Debounce rapid file changes (multiple writes in quick succession)
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    pollForSync();
  }, SYNC_DEBOUNCE_MS);
}

function startFileWatcher() {
  const currentSessionId = getMainSessionId();
  const sessionPath = join(SESSIONS_DIR, `${currentSessionId}.jsonl`);
  
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  
  if (!existsSync(sessionPath)) {
    console.log('📡 Session file not found, will retry in 5s');
    setTimeout(startFileWatcher, 5000);
    return;
  }
  
  try {
    fileWatcher = watch(sessionPath, (eventType) => {
      if (eventType === 'change') {
        debouncedSync();
      }
    });
    
    fileWatcher.on('error', (err) => {
      console.error('File watcher error:', err.message);
      fileWatcher = null;
      // Restart watcher after error
      setTimeout(startFileWatcher, 2000);
    });
    
    console.log(`📡 File watcher active on: ${sessionPath}`);
  } catch (e) {
    console.error('Failed to start file watcher:', e.message);
    // Fall back to polling only
  }
}

if (UNIFIED_SESSION) {
  // Primary: file watching (instant sync)
  startFileWatcher();
  
  // Backup: poll every 1s - file watching is unreliable on Linux
  setInterval(pollForSync, SYNC_POLL_INTERVAL_MS);
  console.log('📡 Real-time sync: file watching + 1s backup poll');
}

// WebSocket heartbeat to detect dead connections
// Heartbeat intervals imported from constants.js

setInterval(() => {
  for (const client of portalClients) {
    if (client.readyState !== 1) continue; // Skip non-open connections
    
    // Check if client responded to last ping
    if (client.isAlive === false) {
      console.log(`💀 Client ${client.sessionId || 'unknown'} failed heartbeat, terminating`);
      portalClients.delete(client);
      client.terminate();
      continue;
    }
    
    // Mark as waiting for pong
    client.isAlive = false;
    client.ping();
  }
}, WS_HEARTBEAT_INTERVAL_MS);

// Periodic cleanup of stale sessions (every hour)
setInterval(() => {
  const now = Date.now();
  const MAX_AGE = STALE_SESSION_MAX_AGE_MS;
  let cleaned = 0;
  
  for (const [sessionId, session] of sessions.entries()) {
    const lastActivity = session.lastActivity || session.createdAt || 0;
    if (now - lastActivity > MAX_AGE) {
      sessions.delete(sessionId);
      // Also clean up pending requests for this session
      if (pendingRequests.has(sessionId)) {
        pendingRequests.delete(sessionId);
      }
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} stale session(s)`);
  }
}, 60 * 60 * 1000); // Every hour

// Pending requests store - persists across reconnections
// Map<sessionId, Array<{requestId, status, startTime, text, response?, error?}>>
const pendingRequests = new Map();

// Get or create pending queue for a session
function getPendingQueue(sessionId) {
  if (!pendingRequests.has(sessionId)) {
    pendingRequests.set(sessionId, []);
  }
  return pendingRequests.get(sessionId);
}

// Add a new pending request to the queue
function addPendingRequest(sessionId, text) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const queue = getPendingQueue(sessionId);
  queue.push({
    requestId,
    status: 'processing',
    startTime: Date.now(),
    text: text.slice(0, 100)
  });
  return requestId;
}

// Update a pending request by requestId
function updatePendingRequest(sessionId, requestId, updates) {
  const queue = pendingRequests.get(sessionId);
  if (!queue) return false;
  const request = queue.find(r => r.requestId === requestId);
  if (request) {
    Object.assign(request, updates);
    return true;
  }
  return false;
}

// Remove a pending request by requestId
function removePendingRequest(sessionId, requestId) {
  const queue = pendingRequests.get(sessionId);
  if (!queue) return;
  const index = queue.findIndex(r => r.requestId === requestId);
  if (index !== -1) {
    queue.splice(index, 1);
  }
  // Clean up empty queues
  if (queue.length === 0) {
    pendingRequests.delete(sessionId);
  }
}

// Get or create session
function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      history: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      ws: null,
    });
  }
  const session = sessions.get(sessionId);
  session.lastActivity = Date.now(); // Update on access
  return session;
}

// Send to client if connected
function sendToClient(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session?.ws?.readyState === 1) { // WebSocket.OPEN
    try {
      session.ws.send(JSON.stringify(data));
      console.log(`📤 [${sessionId}] Sent ${data.type}:`, data.content?.slice?.(0, 50) || '');
      return true;
    } catch (e) {
      console.error(`❌ [${sessionId}] Failed to send ${data.type}:`, e.message);
      return false;
    }
  }
  console.log(`⚠️ [${sessionId}] Cannot send ${data.type} - WS not open (state: ${session?.ws?.readyState})`);
  return false;
}

// Connection handler for chat/notes
wss.on('connection', (ws, request) => {
  // Track portal clients for sync broadcasting
  portalClients.add(ws);
  
  // Heartbeat tracking
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  
  // Check if client is reconnecting with existing session
  const url = new URL(request.url, 'http://localhost');
  let sessionId = url.searchParams.get('session');
  
  if (sessionId && sessions.has(sessionId)) {
    // Reconnecting to existing session
    console.log(`⚡ [${sessionId}] Reconnected`);
  } else {
    // New session
    sessionId = `spark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`⚡ [${sessionId}] New connection (unified=${UNIFIED_SESSION})`);
  }
  
  const session = getOrCreateSession(sessionId);
  session.ws = ws;
  ws.sessionId = sessionId;
  
  // Check for pending request results (queue-based)
  const pendingQueue = pendingRequests.get(sessionId);
  if (pendingQueue && pendingQueue.length > 0) {
    const hasProcessing = pendingQueue.some(r => r.status === 'processing');
    const completedRequests = pendingQueue.filter(r => r.status === 'complete' || r.status === 'error');
    
    if (hasProcessing) {
      // At least one still processing - tell client
      ws.send(JSON.stringify({ type: 'ready', sessionId, pending: true }));
      ws.send(JSON.stringify({ type: 'thinking' }));
    } else {
      ws.send(JSON.stringify({ type: 'ready', sessionId }));
    }
    
    // Send all completed/errored results
    for (const req of completedRequests) {
      if (req.status === 'complete') {
        ws.send(JSON.stringify({ type: 'text', content: req.response }));
        ws.send(JSON.stringify({ type: 'done' }));
      } else if (req.status === 'error') {
        ws.send(JSON.stringify({ type: 'error', message: req.error }));
        ws.send(JSON.stringify({ type: 'done' }));
      }
      removePendingRequest(sessionId, req.requestId);
    }
  } else {
    ws.send(JSON.stringify({ type: 'ready', sessionId }));
  }
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(ws, msg);
    } catch (e) {
      console.error(`[${sessionId}] Error:`, e.message);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
  
  ws.on('close', () => {
    console.log(`[${sessionId}] Disconnected (processing continues)`);
    // Don't delete session - keep it for reconnection
    if (session) session.ws = null;
    // Remove from portal clients for sync broadcasting
    portalClients.delete(ws);
  });
});

// Message handler
async function handleMessage(ws, msg) {
  const session = sessions.get(ws.sessionId);
  if (!session) return;

  switch (msg.type) {
    case 'transcript':
      await handleTranscript(ws, session, msg.text, msg.mode || 'chat', msg.image, msg.file);
      break;
      
    case 'voice_note':
      await handleVoiceNote(ws, session, msg.audio, msg.duration);
      break;
      
    default:
      console.warn(`Unknown message: ${msg.type}`);
  }
}

// Extract text from PDF
async function extractPdfText(dataUrl) {
  const base64Data = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');
  const data = await pdf(buffer);
  return data.text;
}

// Extract text from DOCX
async function extractDocxText(dataUrl) {
  const base64Data = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Route messages through OpenClaw's main session (for tools/skills)
// Uses the CLI for reliable agent execution with full tool access
// isRetry: true if this is a retry from the queue (don't re-queue on failure)
async function routeThroughOpenClaw(ws, sessionId, text, isRetry = false) {
  console.log(`🔀 [${sessionId}] Routing through OpenClaw: ${text.slice(0, 50)}...${isRetry ? ' (retry)' : ''}`);
  sendToClient(sessionId, { type: 'thinking' });
  
  // Mark this client as processing - sync will skip assistant msgs for them
  if (ws) processingClients.add(ws);
  
  return new Promise((resolve) => {
    const timeout = CLI_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let completed = false;
    
    // Use openclaw agent CLI to route to main session
    const proc = spawn(OPENCLAW_PATH, [
      'agent',
      '--message', text,
      '--to', '+6587588470', // Parth's number - routes to main session
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
        console.error(`[${sessionId}] OpenClaw routing timeout after 5 minutes`);
        sendToClient(sessionId, { type: 'error', message: 'Request timed out after 5 minutes' });
        sendToClient(sessionId, { type: 'done' });
        // Unmark client as processing
        const session = sessions.get(sessionId);
        if (session?.ws) processingClients.delete(session.ws);
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
          
          // Check if this is a "connecting" error - queue message for retry
          if (!isRetry && isConnectingError(errorText)) {
            console.log(`⏳ [${sessionId}] Gateway connecting, queueing message...`);
            setGatewayConnecting(true);
            
            // Notify user their message is queued
            sendToClient(sessionId, { 
              type: 'text', 
              content: '⏳ WhatsApp is reconnecting... Your message has been queued and will be sent automatically when connected.' 
            });
            sendToClient(sessionId, { type: 'done' });
            
            // Queue the message
            queueMessage(ws, sessionId, text, resolve);
            startQueueDrainTimer();
            
            // Unmark client as processing (will be re-marked on retry)
            const sessionQueue = sessions.get(sessionId);
            if (sessionQueue?.ws) processingClients.delete(sessionQueue.ws);
            return;
          }
          
          throw new Error(`CLI exited with code ${code}: ${errorText.slice(0, 200)}`);
        }
        
        // Parse JSON output from CLI
        const result = JSON.parse(stdout);
        const payloads = result.result?.payloads || [];
        const reply = payloads.map(p => p.text).filter(Boolean).join('\n') || 
                      'Request processed by OpenClaw.';
        
        console.log(`✅ [${sessionId}] OpenClaw response: ${reply.slice(0, 100)}...`);
        sendToClient(sessionId, { type: 'text', content: reply });
        sendToClient(sessionId, { type: 'done' });
        
        // Add to hash set so sync won't re-broadcast this response
        const replyHash = hashMessage(reply);
        recentlySentHashes.add(replyHash);
        
        // Unmark client as processing
        const session = sessions.get(sessionId);
        if (session?.ws) processingClients.delete(session.ws);
        
        resolve(true);
      } catch (e) {
        console.error(`[${sessionId}] OpenClaw routing error:`, e.message);
        // If JSON parsing fails, try to extract any useful text
        const errorMsg = e.message.includes('JSON') 
          ? (stderr || stdout || 'Unknown error from OpenClaw').slice(0, 500)
          : e.message;
        sendToClient(sessionId, { type: 'error', message: errorMsg });
        sendToClient(sessionId, { type: 'done' });
        // Unmark client as processing
        const sessionErr = sessions.get(sessionId);
        if (sessionErr?.ws) processingClients.delete(sessionErr.ws);
        resolve(false);
      }
    });
    
    proc.on('error', (e) => {
      clearTimeout(timeoutId);
      if (completed) return;
      completed = true;
      
      console.error(`[${sessionId}] OpenClaw spawn error:`, e.message);
      sendToClient(sessionId, { type: 'error', message: `Failed to run OpenClaw: ${e.message}` });
      sendToClient(sessionId, { type: 'done' });
      // Unmark client as processing
      const sessionSpawn = sessions.get(sessionId);
      if (sessionSpawn?.ws) processingClients.delete(sessionSpawn.ws);
      resolve(false);
    });
  });
}

// Set up gateway queue callbacks now that functions are defined
setQueueCallbacks(routeThroughOpenClaw, sendToClient);

// Handle text/voice transcript (with optional image or file)
// ALL messages route through OpenClaw main session for unified experience
async function handleTranscript(ws, session, text, mode, imageDataUrl, fileData) {
  if (!text?.trim()) return;
  
  const sessionId = ws.sessionId;
  const hasImage = !!imageDataUrl;
  const hasFile = !!fileData;
  
  console.log(`🎤 [${sessionId}] (${mode}) User: ${text.slice(0, 50)}...${hasImage ? ' [+image]' : ''}${hasFile ? ` [+${fileData.filename}]` : ''}`);
  
  // Build the full message text
  let fullText = text;
  
  // Handle file attachments - extract text and include in message
  if (fileData) {
    try {
      const ext = fileData.filename.split('.').pop().toLowerCase();
      let extractedText = '';
      
      if (ext === 'pdf') {
        console.log(`📄 [${sessionId}] Extracting PDF: ${fileData.filename}`);
        extractedText = await extractPdfText(fileData.dataUrl);
      } else if (ext === 'docx' || ext === 'doc') {
        console.log(`📝 [${sessionId}] Extracting DOCX: ${fileData.filename}`);
        extractedText = await extractDocxText(fileData.dataUrl);
      }
      
      // Truncate if too long (keep first 30k chars for CLI)
      if (extractedText.length > MAX_FILE_TEXT_CLI) {
        extractedText = extractedText.slice(0, MAX_FILE_TEXT_CLI) + '\n\n[... truncated ...]';
      }
      
      fullText = `${text}\n\n[File: ${fileData.filename}]\n\n${extractedText}`;
    } catch (e) {
      console.error(`[${sessionId}] File extraction error:`, e.message);
      sendToClient(sessionId, { type: 'error', message: `Failed to read file: ${e.message}` });
      sendToClient(sessionId, { type: 'done' });
      return;
    }
  }
  
  // Handle images - save to temp file and reference in message
  if (hasImage) {
    try {
      const imgDir = '/tmp/spark-images';
      if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });
      
      const imgFilename = `img_${Date.now()}.jpg`;
      const imgPath = join(imgDir, imgFilename);
      const base64Data = imageDataUrl.replace(/^data:[^;]+;base64,/, '');
      writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));
      
      fullText = `[Image attached: ${imgPath}]\n\n${text}`;
      console.log(`📷 [${sessionId}] Image saved: ${imgPath}`);
    } catch (e) {
      console.error(`[${sessionId}] Image save error:`, e.message);
      // Continue without image
    }
  }
  
  // Route ALL messages through OpenClaw main session
  // This ensures same session, same tools, same memory as WhatsApp
  await routeThroughOpenClaw(ws, sessionId, fullText);
}

// Handle voice note (transcribe + summarize)
async function handleVoiceNote(ws, session, audioBase64, duration) {
  console.log(`🎙️ [${ws.sessionId}] Voice note: ${duration}s`);
  
  ws.send(JSON.stringify({ type: 'thinking' }));
  
  // Save audio file
  const notesDir = join(__dirname, '../notes');
  if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
  
  const filename = `note_${Date.now()}.webm`;
  const filepath = join(notesDir, filename);
  writeFileSync(filepath, Buffer.from(audioBase64, 'base64'));
  
  // Transcribe using Whisper API via gateway
  let transcription;
  try {
    transcription = await transcribeAudio(audioBase64);
    ws.send(JSON.stringify({ type: 'transcription', text: transcription }));
  } catch (e) {
    console.error('Transcription error:', e.message);
    ws.send(JSON.stringify({ type: 'error', message: 'Transcription failed' }));
    ws.send(JSON.stringify({ type: 'done' }));
    return;
  }
  
  // Summarize
  const prompt = `Here's a voice note transcription. Please provide a clear, concise summary with key points:\n\n${transcription}`;
  const summary = await chat([{ role: 'user', content: prompt }], MODELS.notes, 'notes');
  
  ws.send(JSON.stringify({ type: 'text', content: summary }));
  ws.send(JSON.stringify({ type: 'done' }));
}

// Chat with LLM
async function chat(history, model, mode, hasImage = false) {
  const systemPrompts = {
    voice: 'You are Spark, a voice assistant. Be concise (under 50 words), natural, conversational. No markdown.',
    chat: 'You are Spark, an AI assistant. Be thorough and helpful. Use markdown for formatting when useful.',
    notes: 'You are Spark. Summarize clearly with bullet points for key takeaways.'
  };
  
  const messages = [
    { role: 'system', content: systemPrompts[mode] || systemPrompts.chat },
    ...history.slice(-10)
  ];

  // Build request body
  const body = {
    model,
    messages,
    max_tokens: mode === 'voice' ? 150 : 4000,
  };
  
  // Enable extended thinking for chat mode (Opus 4.5), but not for images (too slow)
  if (mode === 'chat' && !hasImage) {
    body.thinking = { type: 'enabled', budget_tokens: 2000 };
  }

  // 5 minute timeout to prevent infinite hangs (increased for Opus + thinking)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  
  try {
    const jsonBody = JSON.stringify(body);
    const bodySize = Buffer.byteLength(jsonBody);
    console.log(`📡 Sending request to ${GATEWAY_URL}/v1/chat/completions (${Math.round(bodySize/1024)}KB)`);
    
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: jsonBody,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      console.error('API error:', response.status, err);
      throw new Error(`API error: ${response.status} - ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response';
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      console.error('Chat request timed out after 5 minutes');
      throw new Error('Request timed out after 5 minutes');
    }
    console.error('Chat fetch error:', e.message, e.cause || '');
    throw new Error(`Chat failed: ${e.message}`);
  }
}

// Transcribe audio using OpenAI Whisper API
async function transcribeAudio(audioBase64) {
  // Get OpenAI key from skills config
  const configPath = '/home/heisenberg/.clawdbot/clawdbot.json';
  let apiKey;
  
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    apiKey = cfg.skills?.entries?.['openai-whisper-api']?.apiKey;
  }
  
  if (!apiKey) {
    throw new Error('OpenAI API key not found');
  }
  
  // Convert base64 to buffer
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  
  // Build multipart form data manually
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
  
  const formParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n`,
    `Content-Type: audio/webm\r\n\r\n`,
  ];
  
  const formEnd = [
    `\r\n--${boundary}\r\n`,
    `Content-Disposition: form-data; name="model"\r\n\r\n`,
    `whisper-1`,
    `\r\n--${boundary}--\r\n`,
  ];
  
  const formBody = Buffer.concat([
    Buffer.from(formParts.join('')),
    audioBuffer,
    Buffer.from(formEnd.join(''))
  ]);
  
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: formBody,
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.error('Whisper error:', err);
    throw new Error(`Whisper error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.text;
}

// Start server
const PORT = config.port || 3456;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                    ⚡ SPARK VOICE ⚡                   ║
╠═══════════════════════════════════════════════════════╣
║  Server: http://localhost:${PORT}                      ║
║                                                       ║
║  Modes:                                               ║
║  • Voice: ${MODELS.voice}                ║
║  • Chat:  ${MODELS.chat}             ║
║  • Notes: Whisper + ${MODELS.notes}  ║
╚═══════════════════════════════════════════════════════╝
`);
});
