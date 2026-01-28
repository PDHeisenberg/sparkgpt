/**
 * Spark Voice - Conversational AI (Voice + Text)
 */

const CONFIG = {
  wsUrl: `wss://${location.host}`,
  reconnectDelay: 2000,
  silenceThreshold: 1500, // Wait longer for complete sentences
};

// ============================================================================
// ELEMENTS
// ============================================================================

const $ = (id) => document.getElementById(id);
const chatEl = $('chat');
const emptyEl = $('empty');
const statusDot = $('status-dot');
const statusText = $('status-text');
const textInput = $('text-input');
const sendBtn = $('send-btn');
const micBtn = $('mic-btn');
const errorEl = $('error');

// ============================================================================
// STATE
// ============================================================================

let ws = null;
let recognition = null;
let isListening = false;
let isProcessing = false;
let audioContext = null;
let currentInterimEl = null;
let currentSource = null;

// ============================================================================
// CHAT UI
// ============================================================================

function hideEmpty() {
  if (emptyEl) emptyEl.style.display = 'none';
}

function addMessage(text, type = 'user') {
  hideEmpty();
  const msg = document.createElement('div');
  msg.className = `message ${type}`;
  msg.textContent = text;
  chatEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function showInterim(text) {
  hideEmpty();
  if (!currentInterimEl) {
    currentInterimEl = document.createElement('div');
    currentInterimEl.className = 'message user interim';
    chatEl.appendChild(currentInterimEl);
  }
  currentInterimEl.textContent = text;
  scrollToBottom();
}

function clearInterim() {
  if (currentInterimEl) {
    currentInterimEl.remove();
    currentInterimEl = null;
  }
}

function showThinking() {
  hideEmpty();
  const msg = document.createElement('div');
  msg.className = 'message bot thinking';
  msg.id = 'thinking-msg';
  msg.textContent = 'Thinking';
  chatEl.appendChild(msg);
  scrollToBottom();
}

function removeThinking() {
  const el = $('thinking-msg');
  if (el) el.remove();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

// ============================================================================
// SPEECH RECOGNITION (Improved reliability)
// ============================================================================

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech not supported');
    micBtn.style.display = 'none';
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  let finalTranscript = '';
  let silenceTimer = null;
  let lastResultTime = Date.now();

  recognition.onresult = (event) => {
    if (isProcessing) return;
    
    lastResultTime = Date.now();
    let interim = '';
    
    // Collect all results
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      
      if (result.isFinal) {
        finalTranscript += transcript + ' ';
        clearInterim();
      } else {
        interim += transcript;
      }
    }

    // Show what we're hearing
    if (interim) {
      showInterim(finalTranscript + interim);
    } else if (finalTranscript) {
      showInterim(finalTranscript.trim());
    }

    // Reset silence timer - wait for pause in speech
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      const text = finalTranscript.trim();
      if (text && !isProcessing) {
        clearInterim();
        sendMessage(text);
        finalTranscript = '';
      }
    }, CONFIG.silenceThreshold);
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') {
      // Normal, just continue
    } else if (e.error === 'aborted') {
      // User stopped
    } else {
      console.error('Speech error:', e.error);
      showError(`Mic error: ${e.error}`);
    }
  };

  recognition.onend = () => {
    // Auto-restart if we're supposed to be listening
    if (isListening && !isProcessing) {
      setTimeout(() => {
        try { 
          recognition.start(); 
        } catch (e) {}
      }, 100);
    }
  };

  return true;
}

function startListening() {
  if (!recognition) return;
  
  try {
    recognition.start();
    isListening = true;
    micBtn.classList.add('listening');
    setStatus('listening', 'Listening...');
  } catch (e) {
    // Already started
  }
}

function stopListening() {
  if (!recognition) return;
  
  isListening = false;
  micBtn.classList.remove('listening');
  
  try { 
    recognition.stop(); 
  } catch (e) {}
  
  if (!isProcessing) {
    setStatus('connected', 'Ready');
  }
}

function toggleMic() {
  if (isListening) {
    stopListening();
  } else {
    // Stop any playing audio
    if (currentSource) {
      try { currentSource.stop(); } catch (e) {}
    }
    startListening();
  }
}

// ============================================================================
// TEXT INPUT
// ============================================================================

function setupTextInput() {
  // Auto-resize textarea
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = !textInput.value.trim();
  });

  // Send on Enter (Shift+Enter for newline)
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (textInput.value.trim()) {
        handleTextSubmit();
      }
    }
  });

  // Send button
  sendBtn.addEventListener('click', handleTextSubmit);
}

function handleTextSubmit() {
  const text = textInput.value.trim();
  if (!text || isProcessing) return;

  // Stop listening while we process
  if (isListening) {
    stopListening();
  }

  // Clear input
  textInput.value = '';
  textInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Send
  sendMessage(text);
}

// ============================================================================
// WEBSOCKET
// ============================================================================

function connect() {
  setStatus('', 'Connecting...');
  ws = new WebSocket(CONFIG.wsUrl);

  ws.onopen = () => {
    setStatus('connected', 'Ready');
  };

  ws.onclose = () => {
    setStatus('error', 'Disconnected');
    setTimeout(connect, CONFIG.reconnectDelay);
  };

  ws.onerror = () => {
    setStatus('error', 'Connection error');
  };

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (e) {
      console.error('Parse error:', e);
    }
  };
}

function sendMessage(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showError('Not connected');
    return;
  }
  
  isProcessing = true;
  clearInterim();
  addMessage(text, 'user');
  showThinking();
  setStatus('thinking', 'Thinking...');
  
  ws.send(JSON.stringify({ type: 'transcript', text }));
}

function handleMessage(data) {
  switch (data.type) {
    case 'ready':
      setStatus('connected', 'Ready');
      break;
      
    case 'thinking':
      setStatus('thinking', 'Thinking...');
      break;
      
    case 'text':
      removeThinking();
      addMessage(data.content, 'bot');
      break;
      
    case 'audio':
      playAudio(data.data);
      setStatus('speaking', 'Speaking...');
      break;
      
    case 'done':
      isProcessing = false;
      setStatus('connected', 'Ready');
      // Resume listening if mic was on
      if (micBtn.classList.contains('listening')) {
        startListening();
      }
      break;
      
    case 'error':
      removeThinking();
      addMessage(data.message || 'Something went wrong', 'bot');
      isProcessing = false;
      setStatus('connected', 'Ready');
      break;
  }
}

// ============================================================================
// AUDIO PLAYBACK
// ============================================================================

async function playAudio(base64) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    
    if (currentSource) {
      try { currentSource.stop(); } catch (e) {}
    }

    currentSource = audioContext.createBufferSource();
    currentSource.buffer = buffer;
    currentSource.connect(audioContext.destination);
    
    currentSource.onended = () => {
      currentSource = null;
    };
    
    currentSource.start(0);
  } catch (e) {
    console.error('Audio error:', e);
  }
}

// ============================================================================
// UI HELPERS
// ============================================================================

function setStatus(state, text) {
  statusDot.className = state;
  statusText.textContent = text;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add('show');
  setTimeout(() => errorEl.classList.remove('show'), 3000);
}

// ============================================================================
// INIT
// ============================================================================

function init() {
  // Setup text input
  setupTextInput();

  // Setup speech (optional)
  const hasSpeech = initSpeech();
  
  // Mic button
  if (hasSpeech) {
    micBtn.addEventListener('click', toggleMic);
  }

  // Connect
  connect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
