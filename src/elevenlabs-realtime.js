/**
 * ElevenLabs Conversational AI WebSocket Handler
 * 
 * Migrated from OpenAI Realtime API to ElevenLabs Conversational AI
 * for ultra-low latency (~350-500ms) voice conversations with full Spark personality.
 */

import WebSocket from 'ws';
import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

// ElevenLabs Conversational AI WebSocket endpoint
const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/convai/conversation';

// Session config for OpenClaw sync
const SESSIONS_DIR = '/home/heisenberg/.clawdbot/agents/main/sessions';
const MAIN_SESSION_ID = 'd0bddcfd-ba66-479f-8f30-5cc187be5e61';
const MAIN_SESSION_PATH = join(SESSIONS_DIR, `${MAIN_SESSION_ID}.jsonl`);

// OpenClaw API endpoint for tool calls
const OPENCLAW_API_URL = 'http://localhost:18789';
const OPENCLAW_HOOK_TOKEN = 'spark-portal-hook-token-2026';

/**
 * Get ElevenLabs API key from OpenClaw config or environment
 */
function getElevenLabsApiKey() {
  // Try environment first
  if (process.env.ELEVENLABS_API_KEY) {
    return process.env.ELEVENLABS_API_KEY;
  }
  
  // Try OpenClaw config
  const configPath = '/home/heisenberg/.openclaw/openclaw.json';
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.messages?.tts?.elevenlabs?.apiKey;
    } catch (e) {
      console.error('Failed to read OpenClaw config:', e.message);
    }
  }
  
  return null;
}

/**
 * Load recent conversation context for agent awareness
 */
function loadConversationContext(limit = 5) {
  try {
    if (!existsSync(MAIN_SESSION_PATH)) return '';
    
    const content = readFileSync(MAIN_SESSION_PATH, 'utf8');
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
            
            // Skip system messages and heartbeats
            if (text.includes('HEARTBEAT') || text.includes('Read HEARTBEAT.md')) continue;
            if (text.includes('[Cron') || text.includes('systemEvent')) continue;
            if (text.includes('[Spark Voice]')) continue; // Skip previous voice messages
            
            // Clean markers
            text = text
              .replace(/^\[WhatsApp[^\]]*\]\s*/g, '')
              .replace(/^\[Spark[^\]]*\]\s*/g, '')
              .replace(/\n?\[message_id:[^\]]+\]/g, '')
              .trim();
            
            if (text && text.length < 300) {
              messages.push(`${msg.role === 'user' ? 'User' : 'You'}: ${text}`);
            }
          }
        }
      } catch {}
    }
    
    return messages.slice(-limit).join('\n');
  } catch (e) {
    console.error('Failed to load context:', e.message);
    return '';
  }
}

/**
 * Append conversation to OpenClaw main session for WhatsApp sync
 */
function appendToSession(role, content) {
  try {
    const entry = {
      type: 'message',
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      message: {
        role,
        content: [{ type: 'text', text: `[Spark Voice] ${content}` }],
        timestamp: Date.now()
      }
    };
    appendFileSync(MAIN_SESSION_PATH, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to append to session:', e.message);
  }
}

/**
 * Execute tool call via OpenClaw API
 */
async function executeToolCall(toolName, args) {
  console.log(`🔧 Executing tool: ${toolName}(${JSON.stringify(args)})`);
  
  try {
    // Create the ask_spark request for OpenClaw
    const query = `Tool: ${toolName}\nArgs: ${JSON.stringify(args, null, 2)}\n\nPlease execute this tool and return the result.`;
    
    const response = await fetch(`${OPENCLAW_API_URL}/api/agents/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_HOOK_TOKEN}`
      },
      body: JSON.stringify({
        sessionKey: 'agent:main:main',
        message: query,
        thinking: 'low'
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenClaw API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.text();
    console.log(`📤 Tool result: ${result.slice(0, 200)}...`);
    
    return result;
    
  } catch (error) {
    console.error('Tool execution error:', error.message);
    return `Error executing ${toolName}: ${error.message}`;
  }
}

/**
 * Handle ElevenLabs Conversational AI session
 * @param {WebSocket} clientWs - WebSocket connection from browser
 * @param {Object} config - Configuration object with agent settings
 */
export function handleElevenLabsSession(clientWs, config = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    clientWs.send(JSON.stringify({ 
      type: 'error', 
      message: 'ElevenLabs API key not configured. Check ~/.openclaw/openclaw.json or ELEVENLABS_API_KEY env var' 
    }));
    return;
  }

  const agentId = config.elevenlabs?.agentId || process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) {
    clientWs.send(JSON.stringify({ 
      type: 'error', 
      message: 'ElevenLabs agent_id not configured. Set config.elevenlabs.agentId or ELEVENLABS_AGENT_ID env var' 
    }));
    return;
  }

  console.log('🎙️ Starting ElevenLabs Conversational AI session');
  console.log(`   Agent ID: ${agentId}`);
  
  let elevenLabsWs = null;
  let isConnected = false;
  let conversationId = null;
  let currentUserTranscript = '';
  let currentAgentResponse = '';
  let audioFormat = 'pcm_16000'; // Default format

  // Connect to ElevenLabs Conversational AI WebSocket
  elevenLabsWs = new WebSocket(ELEVENLABS_WS_URL, {
    headers: {
      'xi-api-key': apiKey
    }
  });

  elevenLabsWs.on('open', () => {
    console.log('🔗 Connected to ElevenLabs Conversational AI');
    isConnected = true;

    // Send conversation initiation
    const initMessage = {
      type: 'conversation_initiation_client_data',
      ...(agentId && { agent_id: agentId })
    };
    
    elevenLabsWs.send(JSON.stringify(initMessage));
    console.log('📤 Sent conversation initiation');
  });

  elevenLabsWs.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());
      
      switch (event.type) {
        case 'conversation_initiation_metadata':
          const metadata = event.conversation_initiation_metadata_event;
          conversationId = metadata.conversation_id;
          audioFormat = metadata.agent_output_audio_format || 'pcm_16000';
          
          console.log(`📋 Conversation initiated: ${conversationId}`);
          console.log(`   Audio format: ${audioFormat}`);
          
          clientWs.send(JSON.stringify({ 
            type: 'ready', 
            mode: 'elevenlabs',
            conversationId,
            audioFormat 
          }));
          break;

        case 'user_transcript':
          const userText = event.user_transcription_event?.user_transcript || '';
          currentUserTranscript = userText;
          
          console.log(`📝 User: "${userText}"`);
          
          if (userText) {
            clientWs.send(JSON.stringify({ 
              type: 'transcript', 
              text: userText 
            }));
            
            // Append to session for WhatsApp sync
            appendToSession('user', userText);
          }
          break;

        case 'agent_response':
          const agentText = event.agent_response_event?.agent_response || '';
          currentAgentResponse = agentText;
          
          console.log(`🤖 Spark: "${agentText.slice(0, 60)}..."`);
          
          if (agentText) {
            clientWs.send(JSON.stringify({ 
              type: 'text', 
              content: agentText 
            }));
            
            // Append to session for WhatsApp sync
            appendToSession('assistant', agentText);
          }
          break;

        case 'agent_response_correction':
          const correctedText = event.agent_response_correction_event?.corrected_agent_response || '';
          
          console.log(`🔧 Correction: "${correctedText}"`);
          
          if (correctedText) {
            clientWs.send(JSON.stringify({ 
              type: 'text_correction', 
              content: correctedText 
            }));
            
            // Update session with correction
            currentAgentResponse = correctedText;
            appendToSession('assistant', correctedText);
          }
          break;

        case 'audio':
          const audioData = event.audio_event?.audio_base_64;
          
          if (audioData) {
            clientWs.send(JSON.stringify({ 
              type: 'audio_delta', 
              data: audioData 
            }));
          }
          break;

        case 'interruption':
          console.log('⚡ User interruption');
          clientWs.send(JSON.stringify({ type: 'interruption' }));
          
          // Clear any partial responses
          currentAgentResponse = '';
          break;

        case 'ping':
          const pingEventId = event.ping_event?.event_id;
          const pingMs = event.ping_event?.ping_ms;
          
          console.log(`🏓 Ping (${pingMs}ms) - responding with pong`);
          
          // Respond with pong
          elevenLabsWs.send(JSON.stringify({
            type: 'pong',
            event_id: pingEventId
          }));
          break;

        // Tool calling - ElevenLabs uses function calling format similar to OpenAI
        case 'tool_call':
        case 'function_call':
          const toolCall = event.tool_call || event.function_call;
          const toolName = toolCall?.name;
          const toolArgs = toolCall?.arguments;
          const callId = toolCall?.call_id || toolCall?.id;
          
          if (toolName && toolArgs) {
            console.log(`🔧 Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);
            
            clientWs.send(JSON.stringify({ 
              type: 'tool_call', 
              name: toolName,
              args: toolArgs
            }));

            try {
              // Execute tool via OpenClaw
              const toolResult = await executeToolCall(toolName, toolArgs);
              
              // Send result back to ElevenLabs
              const resultMessage = {
                type: 'tool_result',
                tool_call_id: callId,
                result: toolResult
              };
              
              elevenLabsWs.send(JSON.stringify(resultMessage));
              
            } catch (error) {
              console.error('Tool execution error:', error.message);
              
              // Send error back to ElevenLabs
              const errorMessage = {
                type: 'tool_result',
                tool_call_id: callId,
                error: error.message
              };
              
              elevenLabsWs.send(JSON.stringify(errorMessage));
            }
          }
          break;

        case 'error':
          console.error('❌ ElevenLabs error:', event.error || event.message);
          clientWs.send(JSON.stringify({ 
            type: 'error', 
            message: event.error?.message || event.message || 'ElevenLabs error' 
          }));
          break;

        case 'conversation_ended':
        case 'session_ended':
          console.log('🏁 Conversation ended');
          clientWs.send(JSON.stringify({ type: 'session_ended' }));
          break;

        default:
          // Log unknown events for debugging
          if (event.type && !event.type.includes('_delta')) {
            console.log(`📨 ${event.type}:`, JSON.stringify(event).slice(0, 200));
          }
      }
      
    } catch (e) {
      console.error('Failed to parse ElevenLabs event:', e.message);
      console.error('Raw data:', data.toString().slice(0, 500));
    }
  });

  elevenLabsWs.on('error', (err) => {
    console.error('❌ ElevenLabs WebSocket error:', err.message);
    clientWs.send(JSON.stringify({ 
      type: 'error', 
      message: `ElevenLabs connection error: ${err.message}` 
    }));
  });

  elevenLabsWs.on('close', (code, reason) => {
    console.log(`🔌 ElevenLabs connection closed: ${code} ${reason}`);
    isConnected = false;
    clientWs.send(JSON.stringify({ 
      type: 'error', 
      message: 'ElevenLabs connection closed' 
    }));
  });

  // Handle messages from browser (audio chunks, control commands)
  clientWs.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'audio':
          // Forward PCM audio chunk to ElevenLabs
          if (isConnected && message.data) {
            elevenLabsWs.send(JSON.stringify({
              user_audio_chunk: message.data // Should be base64 PCM 16-bit audio
            }));
          }
          break;

        case 'start_recording':
          console.log('🎤 Browser started recording');
          break;

        case 'stop_recording':
          console.log('🎤 Browser stopped recording');
          break;

        case 'interrupt':
          console.log('⚡ Client requested interruption');
          // ElevenLabs should detect this automatically via VAD, but we can send if needed
          break;

        default:
          console.log(`📨 Client message: ${message.type}`);
      }
      
    } catch (e) {
      console.error('Failed to parse client message:', e.message);
    }
  });

  clientWs.on('close', () => {
    console.log('🔌 Client disconnected, closing ElevenLabs connection');
    if (elevenLabsWs && isConnected) {
      elevenLabsWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('❌ Client WebSocket error:', err.message);
  });
}