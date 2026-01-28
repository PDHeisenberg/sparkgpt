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
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TTSProvider } from './providers/tts.js';
import { loadConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

// Models for different modes
const MODELS = {
  voice: 'claude-3-5-haiku-20241022',  // Fast
  chat: 'claude-sonnet-4-20250514',      // Deep thinking
  notes: 'claude-sonnet-4-20250514'      // For summarization
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

console.log(`🧠 Models: Voice=${MODELS.voice}, Chat=${MODELS.chat}`);

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

// HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

// Session store
const sessions = new Map();

// Connection handler
wss.on('connection', (ws) => {
  const sessionId = `spark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  console.log(`⚡ [${sessionId}] Connected`);
  
  sessions.set(sessionId, {
    history: [],
    createdAt: Date.now(),
  });
  
  ws.sessionId = sessionId;
  ws.send(JSON.stringify({ type: 'ready', sessionId }));
  
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
    console.log(`[${sessionId}] Disconnected`);
  });
});

// Message handler
async function handleMessage(ws, msg) {
  const session = sessions.get(ws.sessionId);
  if (!session) return;

  switch (msg.type) {
    case 'transcript':
      await handleTranscript(ws, session, msg.text, msg.mode || 'chat');
      break;
      
    case 'voice_note':
      await handleVoiceNote(ws, session, msg.audio, msg.duration);
      break;
      
    default:
      console.warn(`Unknown message: ${msg.type}`);
  }
}

// Handle text/voice transcript
async function handleTranscript(ws, session, text, mode) {
  if (!text?.trim()) return;
  
  const model = MODELS[mode] || MODELS.chat;
  console.log(`🎤 [${ws.sessionId}] (${mode}) User: ${text.slice(0, 50)}...`);
  
  session.history.push({ role: 'user', content: text });
  ws.send(JSON.stringify({ type: 'thinking' }));
  
  // Get response
  const startTime = Date.now();
  const response = await chat(session.history, model, mode);
  console.log(`🧠 [${ws.sessionId}] ${Date.now() - startTime}ms: ${response.slice(0, 50)}...`);
  
  session.history.push({ role: 'assistant', content: response });
  
  // Trim history
  if (session.history.length > 30) {
    session.history = session.history.slice(-30);
  }
  
  // Send text
  ws.send(JSON.stringify({ type: 'text', content: response }));
  
  // TTS for voice mode
  if (mode === 'voice') {
    try {
      const audio = await tts.synthesize(response);
      ws.send(JSON.stringify({ type: 'audio', data: audio.toString('base64') }));
    } catch (e) {
      console.error('TTS error:', e.message);
    }
  }
  
  ws.send(JSON.stringify({ type: 'done' }));
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
async function chat(history, model, mode) {
  const systemPrompts = {
    voice: 'You are Spark, a voice assistant. Be concise (under 50 words), natural, conversational. No markdown.',
    chat: 'You are Spark, an AI assistant. Be thorough and helpful. Use markdown for formatting when useful.',
    notes: 'You are Spark. Summarize clearly with bullet points for key takeaways.'
  };
  
  const messages = [
    { role: 'system', content: systemPrompts[mode] || systemPrompts.chat },
    ...history.slice(-10)
  ];

  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: mode === 'voice' ? 150 : 2000,
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response';
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
  
  // Create form data
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper error: ${err}`);
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
