/**
 * Spark Voice Server
 * 
 * Scalable architecture with pluggable providers:
 * - STT: Browser (free) → Deepgram (paid) → Whisper (self-host)
 * - TTS: ElevenLabs → OpenAI → Deepgram → Kokoro (self-host)
 * - LLM: Claude (Anthropic) → OpenAI → Local
 * - Avatar: Robot (built-in) → TalkingHead → Custom
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TTSProvider } from './providers/tts.js';
import { LLMProvider } from './providers/llm.js';
import { loadConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

// Initialize providers
const tts = new TTSProvider(config.tts);
const llm = new LLMProvider(config.llm);

// Express app for static files
const app = express();

// No caching for development, CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});

app.use(express.static(join(__dirname, '../public'), { etag: false, lastModified: false }));

// API endpoint for config (non-sensitive)
app.get('/api/config', (req, res) => {
  res.json({
    avatar: config.avatar,
    features: config.features,
  });
});

// Create HTTP server
const server = createServer(app);

// WebSocket server on same port
const wss = new WebSocketServer({ server });

// Conversation store (in production, use Redis or DB)
const conversations = new Map();

// Connection handler
wss.on('connection', (ws, req) => {
  const sessionId = generateSessionId();
  console.log(`⚡ [${sessionId}] Client connected`);
  
  // Initialize conversation
  conversations.set(sessionId, {
    history: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  });
  
  ws.sessionId = sessionId;
  ws.isAlive = true;
  
  // Send ready signal
  ws.send(JSON.stringify({ 
    type: 'ready', 
    sessionId,
    config: { avatar: config.avatar }
  }));
  
  // Heartbeat
  ws.on('pong', () => { ws.isAlive = true; });
  
  // Message handler
  ws.on('message', async (data) => {
    const session = conversations.get(sessionId);
    if (!session) return;
    
    session.lastActivity = Date.now();
    
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(ws, session, message);
    } catch (error) {
      console.error(`[${sessionId}] Error:`, error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: error.message,
        recoverable: true
      }));
    }
  });
  
  // Cleanup on close
  ws.on('close', () => {
    console.log(`[${sessionId}] Disconnected`);
    // Keep conversation for reconnect (clean up after timeout)
    setTimeout(() => {
      const session = conversations.get(sessionId);
      if (session && Date.now() - session.lastActivity > 30 * 60 * 1000) {
        conversations.delete(sessionId);
      }
    }, 30 * 60 * 1000);
  });
});

// Message handler
async function handleMessage(ws, session, message) {
  switch (message.type) {
    case 'transcript':
      await handleTranscript(ws, session, message.text, message.isFinal);
      break;
      
    case 'interrupt':
      // User interrupted, stop any ongoing TTS
      ws.send(JSON.stringify({ type: 'interrupt_ack' }));
      break;
      
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
      
    case 'config':
      // Update session config
      Object.assign(session, message.updates);
      break;
      
    default:
      console.warn(`Unknown message type: ${message.type}`);
  }
}

// Handle transcript from STT
async function handleTranscript(ws, session, text, isFinal = true) {
  if (!text?.trim()) return;
  
  console.log(`🎤 [${ws.sessionId}] User: ${text}`);
  
  // Add to history
  session.history.push({ role: 'user', content: text });
  
  // Acknowledge receipt
  ws.send(JSON.stringify({ type: 'ack', text }));
  
  // Get AI response
  ws.send(JSON.stringify({ type: 'thinking' }));
  
  const response = await llm.chat(session.history);
  console.log(`⚡ [${ws.sessionId}] Spark: ${response}`);
  
  // Add to history
  session.history.push({ role: 'assistant', content: response });
  
  // Trim history if too long (keep last 20 messages)
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }
  
  // Send text response
  ws.send(JSON.stringify({ type: 'text', content: response }));
  
  // Generate TTS and stream
  try {
    ws.send(JSON.stringify({ type: 'audio_start' }));
    
    const audioBuffer = await tts.synthesize(response);
    
    // Send audio in chunks for streaming playback
    const chunkSize = 16 * 1024; // 16KB chunks
    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.slice(i, i + chunkSize);
      ws.send(JSON.stringify({ 
        type: 'audio_chunk',
        data: chunk.toString('base64'),
        index: Math.floor(i / chunkSize),
        final: i + chunkSize >= audioBuffer.length
      }));
    }
    
    ws.send(JSON.stringify({ type: 'audio_end' }));
  } catch (ttsError) {
    console.error(`[${ws.sessionId}] TTS Error:`, ttsError.message);
    ws.send(JSON.stringify({ 
      type: 'tts_error', 
      message: 'Voice synthesis failed, text-only response'
    }));
  }
}

// Heartbeat interval to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log(`[${ws.sessionId}] Terminating dead connection`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// Session ID generator
function generateSessionId() {
  return `spark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                    ⚡ SPARK VOICE ⚡                   ║
╠═══════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}             ║
║                                                       ║
║  Providers:                                           ║
║  • LLM: ${'clawdbot-gateway'.padEnd(40)}║
║  • TTS: ${config.tts.provider.padEnd(40)}║
║  • Avatar: ${config.avatar.type.padEnd(37)}║
╚═══════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
});
