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

// Articulations endpoint
app.post('/api/articulate', express.json(), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text' });
    
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        messages: [
          { role: 'system', content: 'Rewrite the text with better grammar and clarity. Output ONLY the rewritten text, nothing else.' },
          { role: 'user', content: text }
        ],
        max_tokens: 1000,
      }),
    });
    if (!response.ok) throw new Error(`API: ${response.status}`);
    const data = await response.json();
    res.json({ result: data.choices?.[0]?.message?.content?.trim() || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch chat history from session files
import { readdirSync, statSync } from 'fs';

const SESSIONS_DIR = '/home/heisenberg/.clawdbot/agents/main/sessions';

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

// Today's reports
app.get('/api/reports/today', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const reports = [];
    const patterns = ['☀️ MORNING', '📊 MARKET', '🔬 SCIENCE', '🌍 GEOPOLITICS', '📈 PRE-MARKET', '🤖 AI/TECH'];
    
    for (const f of readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'))) {
      const filepath = join(SESSIONS_DIR, f);
      if (statSync(filepath).mtimeMs < today.getTime()) continue;
      
      for (const line of readFileSync(filepath, 'utf8').trim().split('\n')) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'message' && entry.message?.role === 'assistant') {
            const text = extractTextFromContent(entry.message.content);
            if (text?.length > 200 && patterns.some(p => text.includes(p))) {
              if (!reports.some(r => r.summary.slice(0,100) === text.slice(0,100))) {
                reports.push({ summary: text });
              }
            }
          }
        } catch {}
      }
    }
    res.json({ reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

  // Build request body
  const body = {
    model,
    messages,
    max_tokens: mode === 'voice' ? 150 : 4000,
  };
  
  // Enable extended thinking for chat mode (Opus 4.5)
  if (mode === 'chat') {
    body.thinking = { type: 'enabled', budget_tokens: 2000 };
  }

  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('API error:', err);
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
