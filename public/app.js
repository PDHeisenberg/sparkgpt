/**
 * Spark - Three Mode AI Assistant
 * 
 * 1. Voice Mode - Fast conversational (Haiku)
 * 2. Chat Mode - Deep thinking (Opus), files, links
 * 3. Notes Mode - Record, transcribe, summarize
 */

const CONFIG = {
  wsUrl: `wss://${location.host}`,
  reconnectDelay: 2000,
  silenceThreshold: 1500,
};

// ============================================================================
// ELEMENTS
// ============================================================================

const $ = (id) => document.getElementById(id);
const chatEl = $('chat');
const emptyEl = $('empty');
const modeHint = $('mode-hint');
const statusDot = $('status-dot');
const statusText = $('status-text');

// Mode buttons
const modeBtns = document.querySelectorAll('.mode-btn');

// Voice mode
const voiceInput = $('voice-input');
const voiceBtn = $('voice-btn');
const voiceStatus = $('voice-status');

// Chat mode
const chatInput = $('chat-input');
const textInput = $('text-input');
const sendBtn = $('send-btn');
const fileBtn = $('file-btn');
const fileInput = $('file-input');

// Notes mode
const notesInput = $('notes-input');
const notesBtn = $('notes-btn');
const notesStatus = $('notes-status');
const recordingTime = $('recording-time');

const errorEl = $('error');

// ============================================================================
// STATE
// ============================================================================

let ws = null;
let currentMode = 'chat';
let recognition = null;
let isListening = false;
let isProcessing = false;
let audioContext = null;
let currentSource = null;
let currentInterimEl = null;

// Notes recording
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;

// ============================================================================
// MODE SWITCHING
// ============================================================================

function setMode(mode) {
  currentMode = mode;
  
  // Update tabs
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  
  // Update inputs
  voiceInput.classList.toggle('active', mode === 'voice');
  chatInput.classList.toggle('active', mode === 'chat');
  notesInput.classList.toggle('active', mode === 'notes');
  
  // Update hint
  const hints = {
    voice: 'Tap the mic and start talking',
    chat: 'Type a message or attach a file',
    notes: 'Record a voice memo for summary'
  };
  if (modeHint) modeHint.textContent = hints[mode];
  
  // Stop any ongoing actions
  if (mode !== 'voice' && isListening) {
    stopListening();
  }
  if (mode !== 'notes' && mediaRecorder?.state === 'recording') {
    stopRecording();
  }
}

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

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

function addSystemMessage(text) {
  hideEmpty();
  const msg = document.createElement('div');
  msg.className = 'message system';
  msg.textContent = text;
  chatEl.appendChild(msg);
  scrollToBottom();
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
// VOICE MODE - Fast Conversational
// ============================================================================

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';
  let silenceTimer = null;

  recognition.onresult = (event) => {
    if (isProcessing) return;
    
    let interim = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript + ' ';
        clearInterim();
      } else {
        interim += result[0].transcript;
      }
    }

    if (interim) {
      showInterim(finalTranscript + interim);
    } else if (finalTranscript) {
      showInterim(finalTranscript.trim());
    }

    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      const text = finalTranscript.trim();
      if (text && !isProcessing) {
        clearInterim();
        sendMessage(text, 'voice');
        finalTranscript = '';
      }
    }, CONFIG.silenceThreshold);
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      showError(`Mic error: ${e.error}`);
    }
  };

  recognition.onend = () => {
    if (isListening && !isProcessing) {
      setTimeout(() => {
        try { recognition.start(); } catch (e) {}
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
    voiceBtn.classList.add('listening');
    voiceStatus.textContent = 'Listening...';
    setStatus('listening', 'Listening');
  } catch (e) {}
}

function stopListening() {
  if (!recognition) return;
  isListening = false;
  voiceBtn.classList.remove('listening');
  voiceStatus.textContent = 'Tap to talk';
  try { recognition.stop(); } catch (e) {}
  if (!isProcessing) setStatus('connected', 'Ready');
}

voiceBtn?.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  } else {
    if (currentSource) try { currentSource.stop(); } catch (e) {}
    startListening();
  }
});

// ============================================================================
// CHAT MODE - Deep Thinking with Files
// ============================================================================

function setupTextInput() {
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = !textInput.value.trim();
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  });

  sendBtn.addEventListener('click', handleTextSubmit);
  
  // File handling
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFiles);
}

function handleTextSubmit() {
  const text = textInput.value.trim();
  if (!text || isProcessing) return;

  textInput.value = '';
  textInput.style.height = 'auto';
  sendBtn.disabled = true;

  sendMessage(text, 'chat');
}

async function handleFiles(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  for (const file of files) {
    addSystemMessage(`📎 Attached: ${file.name}`);
    
    // Read file content
    try {
      let content;
      if (file.type.startsWith('image/')) {
        content = await readFileAsDataURL(file);
        sendMessage(`[Image: ${file.name}]\n${content}`, 'chat');
      } else {
        content = await readFileAsText(file);
        sendMessage(`[File: ${file.name}]\n\`\`\`\n${content}\n\`\`\``, 'chat');
      }
    } catch (err) {
      showError(`Failed to read ${file.name}`);
    }
  }
  
  fileInput.value = '';
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// NOTES MODE - Record and Summarize
// ============================================================================

async function initRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    
    mediaRecorder.onstop = handleRecordingComplete;
    
    return true;
  } catch (e) {
    console.error('Mic access denied:', e);
    return false;
  }
}

function startRecording() {
  if (!mediaRecorder) {
    initRecording().then(ok => {
      if (ok) startRecording();
      else showError('Microphone access denied');
    });
    return;
  }
  
  audioChunks = [];
  mediaRecorder.start(1000); // Collect in 1s chunks
  recordingStartTime = Date.now();
  
  notesBtn.classList.add('recording');
  notesStatus.textContent = 'Recording... Tap to stop';
  setStatus('recording', 'Recording');
  
  recordingTimer = setInterval(updateRecordingTime, 1000);
  updateRecordingTime();
}

function stopRecording() {
  if (mediaRecorder?.state !== 'recording') return;
  
  mediaRecorder.stop();
  clearInterval(recordingTimer);
  
  notesBtn.classList.remove('recording');
  notesStatus.textContent = 'Processing...';
}

function updateRecordingTime() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  recordingTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function handleRecordingComplete() {
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
  
  addSystemMessage(`🎙️ Voice note recorded (${Math.floor(duration/60)}:${(duration%60).toString().padStart(2,'0')})`);
  
  // Convert to base64 and send for transcription
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    sendVoiceNote(base64, duration);
  };
  reader.readAsDataURL(audioBlob);
  
  notesStatus.textContent = 'Tap to start recording';
  recordingTime.textContent = '0:00';
  setStatus('thinking', 'Transcribing...');
}

function sendVoiceNote(audioBase64, duration) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showError('Not connected');
    return;
  }
  
  isProcessing = true;
  showThinking();
  
  ws.send(JSON.stringify({
    type: 'voice_note',
    audio: audioBase64,
    duration: duration
  }));
}

notesBtn?.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

// ============================================================================
// WEBSOCKET
// ============================================================================

function connect() {
  setStatus('', 'Connecting...');
  ws = new WebSocket(CONFIG.wsUrl);

  ws.onopen = () => setStatus('connected', 'Ready');
  ws.onclose = () => {
    setStatus('error', 'Disconnected');
    setTimeout(connect, CONFIG.reconnectDelay);
  };
  ws.onerror = () => setStatus('error', 'Error');
  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); } 
    catch (err) { console.error('Parse error:', err); }
  };
}

function sendMessage(text, mode = 'chat') {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showError('Not connected');
    return;
  }
  
  isProcessing = true;
  if (isListening) stopListening();
  
  addMessage(text, 'user');
  showThinking();
  setStatus('thinking', 'Thinking...');
  
  ws.send(JSON.stringify({ 
    type: 'transcript', 
    text,
    mode // 'voice' = fast, 'chat' = deep thinking
  }));
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
      setStatus('speaking', 'Speaking');
      break;
      
    case 'transcription':
      // Voice note transcribed
      addMessage(`📝 Transcription:\n${data.text}`, 'bot');
      break;
      
    case 'done':
      isProcessing = false;
      setStatus('connected', 'Ready');
      // Resume voice mode if active
      if (currentMode === 'voice') {
        setTimeout(startListening, 500);
      }
      break;
      
    case 'error':
      removeThinking();
      addMessage(data.message || 'Error occurred', 'bot');
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
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    
    if (currentSource) try { currentSource.stop(); } catch (e) {}

    currentSource = audioContext.createBufferSource();
    currentSource.buffer = buffer;
    currentSource.connect(audioContext.destination);
    currentSource.onended = () => { currentSource = null; };
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
  setupTextInput();
  initSpeech();
  connect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
