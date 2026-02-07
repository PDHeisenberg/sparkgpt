/**
 * Pure OpenAI Realtime Voice Handler with Tools
 * 
 * End-to-end voice conversation using GPT-4o Realtime API.
 * Fast, natural, ~200-500ms latency for conversation.
 * Tools for calendar, time, and Clawdbot queries.
 */

import WebSocket from 'ws';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { getOpenAIKey, loadConversationContext, appendToSession } from './services/shared.js';

// OpenAI Realtime API endpoint
const REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

/**
 * Handle a pure realtime voice session
 * @param {WebSocket} clientWs - WebSocket connection from browser
 */
export function handleRealtimeSession(clientWs) {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'OpenAI API key not configured' }));
    return;
  }

  console.log('🎙️ Starting Realtime session with tools');
  
  let openaiWs = null;
  let isConnected = false;
  let currentTranscript = '';
  let responseTranscript = '';
  let pendingFunctionCall = null;

  // Connect to OpenAI Realtime API
  openaiWs = new WebSocket(REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  openaiWs.on('open', () => {
    console.log('🔗 Connected to OpenAI Realtime API');
    isConnected = true;

    // Load recent context
    const context = loadConversationContext({ limit: 5, format: 'text', maxLength: 300 });
    
    // Get current time in Singapore
    const sgTime = new Date().toLocaleString('en-SG', { 
      timeZone: 'Asia/Singapore',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Build instructions
    let instructions = `You are Spark, a friendly voice assistant for Parth.

Current time: ${sgTime} (Singapore)

You have access to tools:
- get_calendar: Check Parth's calendar (today, tomorrow, or this week)
- get_time: Get exact current time
- ask_clawdbot: For complex questions needing deep analysis

Personality:
- Warm, natural, conversational
- Concise but complete answers
- A bit witty when appropriate
- Tech-savvy

Guidelines:
- Keep responses brief for voice (2-3 sentences typical)
- No markdown, bullet points, or formatting
- Speak naturally like a friend
- USE TOOLS when asked about calendar, schedule, meetings, or time
- For complex questions you can't answer, use ask_clawdbot`;

    if (context) {
      instructions += `\n\nRecent conversation:\n${context}`;
    }

    // Configure session with tools
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions,
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 200,
          silence_duration_ms: 400
        },
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto'
      }
    };

    openaiWs.send(JSON.stringify(sessionConfig));
    clientWs.send(JSON.stringify({ type: 'ready', mode: 'realtime' }));
  });

  openaiWs.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());
      
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          console.log(`📋 Session ${event.type}`);
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
          currentTranscript = event.transcript || '';
          console.log(`📝 User: "${currentTranscript}"`);
          if (currentTranscript) {
            clientWs.send(JSON.stringify({ type: 'transcript', text: currentTranscript }));
            appendToSession('user', currentTranscript);
          }
          break;

        // Tool calling events
        case 'response.output_item.added':
          if (event.item?.type === 'function_call') {
            console.log(`🔧 Tool call starting: ${event.item.name}`);
            pendingFunctionCall = {
              name: event.item.name,
              call_id: event.item.call_id,
              arguments: ''
            };
            // Notify client
            clientWs.send(JSON.stringify({ 
              type: 'tool_call', 
              name: event.item.name 
            }));
          }
          break;

        case 'response.function_call_arguments.delta':
          if (pendingFunctionCall) {
            pendingFunctionCall.arguments += event.delta || '';
          }
          break;

        case 'response.function_call_arguments.done':
          if (pendingFunctionCall) {
            const funcName = pendingFunctionCall.name;
            const funcArgs = event.arguments || pendingFunctionCall.arguments || '{}';
            const callId = pendingFunctionCall.call_id;
            
            console.log(`🔧 Executing: ${funcName}(${funcArgs})`);
            pendingFunctionCall = null;
            
            try {
              const args = JSON.parse(funcArgs);
              const result = await executeTool(funcName, args);
              
              console.log(`📤 Tool result: ${result.slice(0, 100)}...`);
              
              // Send result back to OpenAI
              openaiWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: result
                }
              }));
              
              // Trigger response generation
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
              
            } catch (e) {
              console.error('Tool error:', e.message);
              openaiWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: `Error: ${e.message}`
                }
              }));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            }
          }
          break;

        case 'response.audio_transcript.delta':
          responseTranscript += event.delta || '';
          clientWs.send(JSON.stringify({ type: 'text_delta', delta: event.delta }));
          break;

        case 'response.audio_transcript.done':
          console.log(`🤖 Spark: "${responseTranscript.slice(0, 60)}..."`);
          clientWs.send(JSON.stringify({ type: 'text', content: responseTranscript }));
          if (responseTranscript) {
            appendToSession('assistant', responseTranscript);
          }
          responseTranscript = '';
          break;

        case 'response.audio.delta':
          if (event.delta) {
            clientWs.send(JSON.stringify({ type: 'audio_delta', data: event.delta }));
          }
          break;

        case 'response.audio.done':
          clientWs.send(JSON.stringify({ type: 'audio_done' }));
          break;

        case 'response.done':
          console.log('✅ Turn complete');
          clientWs.send(JSON.stringify({ type: 'done' }));
          break;

        case 'error':
          console.error('❌ OpenAI error:', event.error);
          clientWs.send(JSON.stringify({ type: 'error', message: event.error?.message || 'Unknown error' }));
          break;

        default:
          // Ignore frequent delta events in logs
          if (!event.type.includes('delta') && !event.type.includes('rate_limits')) {
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
  });

  // Handle messages from browser
  clientWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'audio':
          // Forward audio to OpenAI
          if (isConnected && msg.data) {
            openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: msg.data
            }));
          }
          break;

        case 'commit':
          // Manual trigger (push-to-talk style)
          if (isConnected) {
            openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            openaiWs.send(JSON.stringify({ type: 'response.create' }));
          }
          break;

        case 'cancel':
          // Cancel current response
          if (isConnected) {
            openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          break;

        case 'stop':
          console.log('🛑 Session ended');
          if (openaiWs) openaiWs.close();
          break;
      }
    } catch (e) {
      console.error('Failed to handle client message:', e.message);
    }
  });

  // Cleanup on client disconnect
  clientWs.on('close', () => {
    console.log('🔌 Client disconnected');
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
}
