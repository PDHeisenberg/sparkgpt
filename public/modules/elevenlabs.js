/**
 * ClawChat - ElevenLabs Conversational AI Voice Module
 * 
 * Handles ElevenLabs WebSocket connection, audio capture/playback
 * for ultra-low latency voice conversations.
 */

let elevenLabsWs = null;
let elevenLabsAudioContext = null;
let voiceMediaStream = null;
let audioWorkletNode = null;
let elevenLabsAudioQueue = [];
let isPlayingElevenLabs = false;

// Callbacks set by main app
let onStatusUpdate = () => {};
let onVoiceMessage = () => {};
let onStopped = () => {};

export function setCallbacks({ onStatus, onMessage, onStop }) {
  if (onStatus) onStatusUpdate = onStatus;
  if (onMessage) onVoiceMessage = onMessage;
  if (onStop) onStopped = onStop;
}

function getElevenLabsWsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${location.host}`;
  const path = location.pathname.replace(/\/+$/, '');
  return path && path !== '/' ? `${base}${path}/elevenlabs-realtime` : `${base}/elevenlabs-realtime`;
}

export async function startElevenLabsVoice() {
  console.log('🎙️ Starting ElevenLabs voice mode');
  
  try {
    if (!await startAudioCapture()) {
      return false;
    }
    connectWebSocket();
    return true;
  } catch (error) {
    console.error('Failed to start ElevenLabs voice:', error);
    return false;
  }
}

function connectWebSocket() {
  const wsUrl = getElevenLabsWsUrl();
  console.log('🔗 Connecting to ElevenLabs WebSocket:', wsUrl);
  
  elevenLabsWs = new WebSocket(wsUrl);
  
  elevenLabsWs.onopen = () => {
    console.log('✅ ElevenLabs WebSocket connected');
    onStatusUpdate('Starting...');
  };
  
  elevenLabsWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error('Failed to parse ElevenLabs message:', e);
    }
  };
  
  elevenLabsWs.onclose = (event) => {
    console.log('🔌 ElevenLabs WebSocket closed:', event.code);
  };
  
  elevenLabsWs.onerror = (error) => {
    console.error('❌ ElevenLabs WebSocket error:', error);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'ready':
      onStatusUpdate('Listening');
      break;
      
    case 'transcript':
      if (msg.text) onVoiceMessage('user', msg.text, msg.final);
      break;
      
    case 'text':
    case 'agent_response':
      const content = msg.content || msg.text;
      if (content) {
        onVoiceMessage('assistant', content, true);
        onStatusUpdate('Speaking...');
      }
      break;
      
    case 'audio_delta':
    case 'audio':
      const audioData = msg.data || msg.audio_base_64;
      if (audioData) {
        elevenLabsAudioQueue.push(audioData);
        playAudioQueue();
      }
      break;
      
    case 'interruption':
      console.log('⚡ User interruption detected');
      stopAudioPlayback();
      break;
      
    case 'tool_call':
      onStatusUpdate('Checking...');
      onVoiceMessage('assistant', 'Checking...', false);
      break;
      
    case 'conversation_ended':
    case 'session_ended':
      console.log('🏁 ElevenLabs conversation ended');
      break;
      
    case 'error':
      console.error('❌ ElevenLabs error:', msg.message);
      break;
  }
}

async function startAudioCapture() {
  try {
    voiceMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    
    elevenLabsAudioContext = new (window.AudioContext || window.webkitAudioContext)({ 
      sampleRate: 16000 
    });
    
    const source = elevenLabsAudioContext.createMediaStreamSource(voiceMediaStream);
    
    try {
      await elevenLabsAudioContext.audioWorklet.addModule('/audio-processor.js');
      audioWorkletNode = new AudioWorkletNode(elevenLabsAudioContext, 'audio-processor');
      
      audioWorkletNode.port.onmessage = (event) => {
        const { audioData } = event.data;
        if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
          const base64Audio = float32ToPCM16Base64(audioData);
          elevenLabsWs.send(JSON.stringify({ type: 'audio', data: base64Audio }));
        }
      };
      
      source.connect(audioWorkletNode);
      audioWorkletNode.connect(elevenLabsAudioContext.destination);
    } catch (workletError) {
      console.warn('AudioWorklet not available, falling back to ScriptProcessor');
      const processor = elevenLabsAudioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
          const base64Audio = float32ToPCM16Base64(inputData);
          elevenLabsWs.send(JSON.stringify({ type: 'audio', data: base64Audio }));
        }
      };
      source.connect(processor);
      processor.connect(elevenLabsAudioContext.destination);
    }
    
    return true;
  } catch (error) {
    console.error('ElevenLabs audio capture error:', error);
    return false;
  }
}

function float32ToPCM16Base64(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64PCM16ToFloat32EL(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return float32;
}

async function playAudioQueue() {
  if (isPlayingElevenLabs || elevenLabsAudioQueue.length === 0) return;
  isPlayingElevenLabs = true;
  
  while (elevenLabsAudioQueue.length > 0) {
    const audioData = elevenLabsAudioQueue.shift();
    try {
      if (!elevenLabsAudioContext || elevenLabsAudioContext.state === 'closed') {
        elevenLabsAudioContext = new (window.AudioContext || window.webkitAudioContext)({ 
          sampleRate: 16000 
        });
      }
      
      const float32 = base64PCM16ToFloat32EL(audioData);
      const audioBuffer = elevenLabsAudioContext.createBuffer(1, float32.length, 16000);
      audioBuffer.getChannelData(0).set(float32);
      
      const source = elevenLabsAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(elevenLabsAudioContext.destination);
      
      await new Promise(resolve => {
        source.onended = resolve;
        source.start();
      });
    } catch (e) {
      console.error('ElevenLabs audio playback error:', e);
    }
  }
  
  isPlayingElevenLabs = false;
}

function stopAudioPlayback() {
  elevenLabsAudioQueue = [];
  isPlayingElevenLabs = false;
}

export function stopElevenLabsVoice() {
  console.log('🔌 Stopping ElevenLabs voice mode');
  
  if (voiceMediaStream) {
    voiceMediaStream.getTracks().forEach(track => track.stop());
    voiceMediaStream = null;
  }
  
  if (audioWorkletNode) {
    audioWorkletNode.disconnect();
    audioWorkletNode = null;
  }
  
  if (elevenLabsAudioContext && elevenLabsAudioContext.state !== 'closed') {
    elevenLabsAudioContext.close().catch(() => {});
    elevenLabsAudioContext = null;
  }
  
  stopAudioPlayback();
  
  if (elevenLabsWs) {
    try { elevenLabsWs.send(JSON.stringify({ type: 'end' })); } catch {}
    elevenLabsWs.close();
    elevenLabsWs = null;
  }
}

export function isConnected() {
  return elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN;
}
