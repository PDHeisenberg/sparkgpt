/**
 * Spark Voice Server - Three Modes
 * 
 * Voice Mode: Fast conversational (Haiku)
 * Chat Mode: Deep thinking (Opus), files, links
 * Notes Mode: Record, transcribe, summarize
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import express from 'express';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TTSProvider } from './providers/tts.js';
import { loadConfig } from './config.js';
import { handleRealtimeSession } from './realtime.js';
import { handleHybridRealtimeSession } from './hybrid-realtime.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

// Models for different modes
const MODELS = {
  voice: 'gemini-3-flash',                 // Fastest (Gemini 3 Flash)
  chat: 'claude-opus-4-5-20250514',        // Deep thinking (Opus 4.5)
  notes: 'claude-opus-4-5-20250514'        // Summary (Opus 4.5)
};

// Gateway connection
const GATEWAY_URL = config.llm?.gatewayUrl || 'http://localhost:18789';
const GATEWAY_TOKEN = config.llm?.gatewayToken || loadGatewayToken();

function loadGatewayToken() {
  const configPath = '/home/heisenberg/.clawdbot/clawdbot.json';
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      return cfg.gateway?.auth?.token;
    } catch {}
  }
  return null;
}

// TTS
const tts = new TTSProvider(config.tts);

// Shared session with Clawdbot (same as WhatsApp)
const SESSIONS_DIR = '/home/heisenberg/.clawdbot/agents/main/sessions';
const MAIN_SESSION_ID = 'd0bddcfd-ba66-479f-8f30-5cc187be5e61';
const MAIN_SESSION_PATH = join(SESSIONS_DIR, `${MAIN_SESSION_ID}.jsonl`);

// Load recent history from main session
function loadSessionHistory(limit = 20) {
  try {
    if (!existsSync(MAIN_SESSION_PATH)) return [];
    
    const content = readFileSync(MAIN_SESSION_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);
    
    const messages = [];
    for (const line of lines.slice(-limit * 2)) { // Read more to filter
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

import { appendFileSync } from 'fs';

// Append message to main session

function appendToSessionSync(role, content) {
  try {
    const entry = {
      type: 'message',
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      message: {
        role,
        content: [{ type: 'text', text: `[Spark Web] ${content}` }],
        timestamp: Date.now()
      }
    };
    
    appendFileSync(MAIN_SESSION_PATH, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to append to session:', e.message);
  }
}

console.log(`🧠 Models: Voice=${MODELS.voice}, Chat=${MODELS.chat}`);
console.log(`📁 Shared session: ${MAIN_SESSION_ID}`);

// Express app
const app = express();

// No caching
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

app.use(express.static(join(__dirname, '../public'), { etag: false }));

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

function extractTextFromContent(content) {
  if (!content) return null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textPart = content.find(c => c.type === 'text');
    return textPart?.text || null;
  }
  return null;
}

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

// Node status endpoint - check if PC is connected
const CLAWDBOT_PATH = '/home/heisenberg/.npm-global/bin/clawdbot';

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
    // Use clawdbot CLI to get node status
    const output = execSync(`${CLAWDBOT_PATH} nodes status --json`, { 
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

// HTTP server
const server = createServer(app);

// WebSocket server for chat/notes (existing)
const wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 });

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
      ws: null,
    });
  }
  return sessions.get(sessionId);
}

// Send to client if connected
function sendToClient(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session?.ws?.readyState === 1) { // WebSocket.OPEN
    session.ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

// Connection handler for chat/notes
wss.on('connection', (ws, request) => {
  // Check if client is reconnecting with existing session
  const url = new URL(request.url, 'http://localhost');
  let sessionId = url.searchParams.get('session');
  
  if (sessionId && sessions.has(sessionId)) {
    // Reconnecting to existing session
    console.log(`⚡ [${sessionId}] Reconnected`);
  } else {
    // New session
    sessionId = `spark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`⚡ [${sessionId}] New connection`);
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

// Handle text/voice transcript (with optional image or file)
// Processing continues even if client disconnects
async function handleTranscript(ws, session, text, mode, imageDataUrl, fileData) {
  if (!text?.trim()) return;
  
  const sessionId = ws.sessionId;
  const hasImage = !!imageDataUrl;
  // Use Sonnet for images (faster), Opus for text-only chat
  const model = hasImage ? 'claude-sonnet-4-20250514' : (MODELS[mode] || MODELS.chat);
  const hasFile = !!fileData;
  console.log(`🎤 [${sessionId}] (${mode}) User: ${text.slice(0, 50)}...${hasImage ? ' [+image]' : ''}${hasFile ? ` [+${fileData.filename}]` : ''}`);
  
  // Mark request as pending - processing will continue even if client disconnects
  // Uses queue to handle multiple rapid requests without overwriting
  const requestId = addPendingRequest(sessionId, text);
  
  sendToClient(sessionId, { type: 'thinking' });
  
  // Load shared history from main Clawdbot session
  const sharedHistory = loadSessionHistory(20);
  
  // Build content - handle images, PDFs, and docs
  let userContent = text;
  let fullText = text;
  
  try {
    if (imageDataUrl) {
      // Image - use Anthropic format for Claude models
      userContent = [
        { type: 'text', text: text },
        { 
          type: 'image', 
          source: { 
            type: 'base64', 
            media_type: imageDataUrl.match(/data:([^;]+);/)?.[1] || 'image/jpeg',
            data: imageDataUrl.replace(/^data:[^;]+;base64,/, '')
          }
        }
      ];
    } else if (fileData) {
      // PDF or DOCX - extract text
      const ext = fileData.filename.split('.').pop().toLowerCase();
      let extractedText = '';
      
      if (ext === 'pdf') {
        console.log(`📄 [${sessionId}] Extracting PDF: ${fileData.filename}`);
        extractedText = await extractPdfText(fileData.dataUrl);
      } else if (ext === 'docx' || ext === 'doc') {
        console.log(`📄 [${sessionId}] Extracting DOCX: ${fileData.filename}`);
        extractedText = await extractDocxText(fileData.dataUrl);
      }
      
      // Truncate if too long (keep first 50k chars)
      if (extractedText.length > 50000) {
        extractedText = extractedText.slice(0, 50000) + '\n\n[... truncated ...]';
      }
      
      fullText = `${text}\n\n[File: ${fileData.filename}]\n\n${extractedText}`;
      userContent = fullText;
    }
  } catch (e) {
    console.error(`[${sessionId}] File extraction error:`, e.message);
    updatePendingRequest(sessionId, requestId, { status: 'error', error: `Failed to read file: ${e.message}` });
    sendToClient(sessionId, { type: 'error', message: `Failed to read file: ${e.message}` });
    sendToClient(sessionId, { type: 'done' });
    return;
  }
  
  // Add current message to history for this request
  sharedHistory.push({ role: 'user', content: userContent });
  
  // Append user message to shared session file (text only, not full base64)
  appendToSessionSync('user', typeof userContent === 'string' ? userContent.slice(0, 2000) : text);
  
  // Get response using shared history
  const startTime = Date.now();
  let response;
  try {
    response = await chat(sharedHistory, model, mode, hasImage);
  } catch (e) {
    console.error(`[${sessionId}] Chat error:`, e.message);
    updatePendingRequest(sessionId, requestId, { status: 'error', error: `API error: ${e.message}` });
    sendToClient(sessionId, { type: 'error', message: `API error: ${e.message}` });
    sendToClient(sessionId, { type: 'done' });
    return;
  }
  console.log(`🧠 [${sessionId}] ${Date.now() - startTime}ms: ${response.slice(0, 50)}...`);
  
  // Append assistant response to shared session file
  appendToSessionSync('assistant', response);
  
  // Store response and try to send to client
  const sent = sendToClient(sessionId, { type: 'text', content: response });
  
  if (sent) {
    // Client connected - send response directly
    if (mode === 'voice') {
      try {
        const audio = await tts.synthesize(response);
        sendToClient(sessionId, { type: 'audio', data: audio.toString('base64') });
      } catch (e) {
        console.error('TTS error:', e.message);
      }
    }
    sendToClient(sessionId, { type: 'done' });
    removePendingRequest(sessionId, requestId);
  } else {
    // Client disconnected - store response for later
    console.log(`📦 [${sessionId}] Response stored for reconnection (request ${requestId})`);
    updatePendingRequest(sessionId, requestId, { 
      status: 'complete', 
      response,
      completedAt: Date.now()
    });
  }
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

  // 2 minute timeout to prevent infinite hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  
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
      console.error('Chat request timed out after 2 minutes');
      throw new Error('Request timed out after 2 minutes');
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
