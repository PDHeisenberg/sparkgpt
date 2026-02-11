/**
 * Hybrid Realtime Voice Handler
 * 
 * Uses OpenAI Realtime API for speech-to-text ONLY,
 * then routes to main Clawdbot/Claude session for processing.
 * TTS is handled separately via OpenAI TTS API.
 * 
 * Benefits:
 * - More reliable responses (uses main Claude session)
 * - Correct timezone and context
 * - Consistent personality with text chat
 * - Better tool calling via Clawdbot
 */

import WebSocket from 'ws';
import { getOpenAIKey, getGatewayToken, loadConversationContext, appendToSession } from './services/shared.js';
import { SPEAKING_TIMEOUT_MS, AUDIO_CHUNK_SIZE } from './constants.js';

// OpenAI Realtime API endpoint
const REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

// Gateway for Claude processing
const GATEWAY_URL = 'http://localhost:18789';

// Send to Claude via Gateway for processing
async function processWithClaude(userMessage) {
  const gatewayToken = getGatewayToken();
  if (!gatewayToken) throw new Error('Gateway token not found');
  
  const history = loadConversationContext({ limit: 10 });
  
  const systemPrompt = `You are Spark, a voice assistant for Parth.

Current timezone: Asia/Singapore (SGT, UTC+8)
Current time: ${new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}

Voice response guidelines:
- Be concise (under 100 words typically)
- No markdown formatting - speak naturally
- No bullet points or numbered lists
- Be conversational and helpful
- If asked about time/schedule, use Singapore timezone

You have full access to Parth's context, calendar, emails, and tools through the main Clawdbot system.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8),
    { role: 'user', content: userMessage }
  ];

  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${gatewayToken}`,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', // Fast and good for voice
      messages,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gateway error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'Sorry, I couldn\'t process that.';
}

// Generate TTS via OpenAI TTS API
async function generateTTS(text, apiKey) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'alloy',
      input: text,
      response_format: 'pcm', // Raw PCM for streaming
      speed: 1.0,
    }),
  });

  if (!response.ok) {
    throw new Error(`TTS error: ${response.status}`);
  }

  // Get as array buffer and convert to base64
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buffer.toString('base64');
}

/**
 * Handle a hybrid realtime voice session
 * @param {WebSocket} clientWs - WebSocket connection from browser
 */
export function handleHybridRealtimeSession(clientWs) {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'OpenAI API key not configured' }));
    return;
  }

  console.log('🎙️ Starting Hybrid Realtime session (STT → Claude → TTS)');
  
  let openaiWs = null;
  let isConnected = false;
  let currentTranscript = '';
  let isProcessing = false;
  let isSpeaking = false; // True while TTS is playing - suppress audio input
  let speakingTimeout = null; // Safety timeout to resume listening

  // Connect to OpenAI Realtime API (STT only)
  openaiWs = new WebSocket(REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  openaiWs.on('open', () => {
    console.log('🔗 Connected to OpenAI Realtime API (STT mode)');
    isConnected = true;

    // Configure session for STT ONLY - no text generation
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text'], // Text output only (transcription)
        instructions: 'Transcribe user speech accurately. Do not respond or generate any text - only transcribe.', // Minimal instructions
        input_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 700 // Slightly longer for natural speech
        },
        // No tools - we'll use Clawdbot's tools
        tools: [],
      }
    };

    openaiWs.send(JSON.stringify(sessionConfig));
    clientWs.send(JSON.stringify({ type: 'ready', mode: 'hybrid' }));
  });

  openaiWs.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());
      
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          console.log(`📋 Session ${event.type} (STT mode)`);
          break;

        case 'input_audio_buffer.speech_started':
          console.log('🎤 User speaking...');
          clientWs.send(JSON.stringify({ type: 'user_speaking' }));
          currentTranscript = '';
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('🎤 User stopped speaking');
          clientWs.send(JSON.stringify({ type: 'user_stopped' }));
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User's speech transcribed - this is the key event
          currentTranscript = event.transcript || '';
          console.log(`📝 Transcribed: "${currentTranscript}"`);
          
          if (currentTranscript && currentTranscript.trim() && !isProcessing) {
            isProcessing = true;
            
            // Send transcript to client
            clientWs.send(JSON.stringify({ type: 'transcript', text: currentTranscript }));
            
            // Append user message to session
            appendToSession('user', currentTranscript, 'ClawChat Voice Realtime');
            
            // Notify client we're processing with Claude
            clientWs.send(JSON.stringify({ type: 'processing', engine: 'claude' }));
            
            try {
              // Process with Claude
              console.log('🧠 Sending to Claude...');
              const response = await processWithClaude(currentTranscript);
              console.log(`🤖 Claude response: "${response.slice(0, 50)}..."`);
              
              // Append assistant response to session
              appendToSession('assistant', response, 'ClawChat Voice Realtime');
              
              // Send text response
              clientWs.send(JSON.stringify({ type: 'text', content: response }));
              
              // Generate and stream TTS
              // CRITICAL: Stop listening while we speak to prevent echo
              isSpeaking = true;
              
              // Safety timeout: resume listening after max 30s (in case client doesn't notify)
              if (speakingTimeout) clearTimeout(speakingTimeout);
              speakingTimeout = setTimeout(() => {
                if (isSpeaking) {
                  console.log('⚠️ Speaking timeout - resuming listening');
                  isSpeaking = false;
                }
              }, SPEAKING_TIMEOUT_MS);
              
              clientWs.send(JSON.stringify({ type: 'tts_start' }));
              
              try {
                console.log('🔊 Generating TTS...');
                const audioBase64 = await generateTTS(response, apiKey);
                
                // Send audio in chunks for streaming playback
                const chunkSize = AUDIO_CHUNK_SIZE;
                for (let i = 0; i < audioBase64.length; i += chunkSize) {
                  const chunk = audioBase64.slice(i, i + chunkSize);
                  clientWs.send(JSON.stringify({ type: 'audio_chunk', data: chunk }));
                }
                
                clientWs.send(JSON.stringify({ type: 'audio_done' }));
              } catch (ttsErr) {
                console.error('TTS error:', ttsErr.message);
                // Still send text even if TTS fails
              }
              
            } catch (claudeErr) {
              console.error('Claude error:', claudeErr.message);
              clientWs.send(JSON.stringify({ 
                type: 'error', 
                message: 'Sorry, I had trouble processing that. Please try again.' 
              }));
            }
            
            isProcessing = false;
            clientWs.send(JSON.stringify({ type: 'done' }));
          }
          break;

        case 'error':
          console.error('❌ OpenAI error:', event.error);
          clientWs.send(JSON.stringify({ type: 'error', message: event.error?.message || 'Unknown error' }));
          break;

        default:
          // Log events for debugging
          if (event.type.includes('audio') || event.type.includes('response')) {
            // Ignore audio/response events in STT-only mode
          } else {
            console.log(`📨 ${event.type}`);
          }
      }
    } catch (e) {
      console.error('Failed to parse OpenAI event:', e.message);
    }
  });

  openaiWs.on('error', (err) => {
    console.error('❌ OpenAI WebSocket error:', err.message);
    clientWs.send(JSON.stringify({ type: 'error', message: 'Connection error' }));
  });

  openaiWs.on('close', () => {
    console.log('🔌 OpenAI connection closed');
    isConnected = false;
    clientWs.send(JSON.stringify({ type: 'disconnected' }));
  });

  // Handle messages from browser
  clientWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'audio':
          // Audio chunk from browser (base64 PCM16)
          // CRITICAL: Don't send audio while we're speaking (echo cancellation)
          if (isConnected && msg.data && !isProcessing && !isSpeaking) {
            openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: msg.data
            }));
          }
          break;
        
        case 'audio_playback_ended':
          // Client notifies us TTS playback finished - resume listening
          console.log('🔊 TTS playback ended, resuming listening');
          isSpeaking = false;
          if (speakingTimeout) {
            clearTimeout(speakingTimeout);
            speakingTimeout = null;
          }
          break;

        case 'stop':
          // End session
          console.log('🛑 Client requested stop');
          if (openaiWs) {
            openaiWs.close();
          }
          break;
      }
    } catch (e) {
      console.error('Failed to handle client message:', e.message);
    }
  });

  // Cleanup on client disconnect
  clientWs.on('close', () => {
    console.log('🔌 Client disconnected');
    // Clear speaking timeout to prevent memory leak / stale callback
    if (speakingTimeout) {
      clearTimeout(speakingTimeout);
      speakingTimeout = null;
    }
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
}
