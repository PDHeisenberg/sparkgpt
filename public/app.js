/**
 * Spark - Minimal Voice + Chat + Notes
 */

const CONFIG = {
  wsUrl: `wss://${location.host}`,
  silenceMs: 1500,
};

// Elements
const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const notesBtn = document.getElementById('notes-btn');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const toastEl = document.getElementById('toast');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const bottomEl = document.getElementById('bottom');
const voiceBar = document.getElementById('voice-bar');
const closeVoiceBtn = document.getElementById('close-voice-btn');
const waveformEl = document.getElementById('waveform');

// State
let ws = null;
let mode = 'chat'; // chat | voice | notes
let recognition = null;
let isListening = false;
let isProcessing = false;
let audioContext = null;
let currentAudio = null;

// Notes recording
let mediaRecorder = null;
let audioChunks = [];
let recordStart = null;
let timerInterval = null;

// ============================================================================
// MESSAGES
// ============================================================================

function addMsg(text, type) {
  if (welcomeEl) welcomeEl.style.display = 'none';
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  
  if (type === 'bot') {
    // Format bot messages with proper line breaks and basic markdown
    el.innerHTML = formatMessage(text);
  } else {
    el.textContent = text;
  }
  
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function formatMessage(text) {
  // Convert markdown-like formatting to HTML
  return text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Line breaks - double newline = paragraph
    .replace(/\n\n/g, '</p><p>')
    // Single newline = br
    .replace(/\n/g, '<br>')
    // Wrap in paragraph
    .replace(/^(.*)$/, '<p>$1</p>')
    // Fix empty paragraphs
    .replace(/<p><\/p>/g, '');
}

function showThinking() {
  if (welcomeEl) welcomeEl.style.display = 'none';
  removeThinking();
  const el = document.createElement('div');
  el.className = 'msg bot thinking';
  el.id = 'thinking-indicator';
  el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeThinking() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

let interimEl = null;
function showInterim(text) {
  if (emptyEl) emptyEl.style.display = 'none';
  if (!interimEl) {
    interimEl = document.createElement('div');
    interimEl.className = 'msg user interim';
    messagesEl.appendChild(interimEl);
  }
  interimEl.textContent = text;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clearInterim() {
  if (interimEl) {
    interimEl.remove();
    interimEl = null;
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = isError ? 'show error' : 'show';
  setTimeout(() => toastEl.className = '', 3000);
}

// ============================================================================
// VOICE MODE
// ============================================================================

function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let final = '';
  let timer = null;

  recognition.onresult = (e) => {
    if (isProcessing) return;

    // Show waveform animation when receiving audio
    setVoiceActive(true);

    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        final += r[0].transcript + ' ';
      } else {
        interim += r[0].transcript;
      }
    }

    showInterim(final + interim);

    clearTimeout(timer);
    timer = setTimeout(() => {
      setVoiceActive(false);
      const text = final.trim();
      if (text && !isProcessing) {
        clearInterim();
        send(text, 'voice');
        final = '';
      }
    }, CONFIG.silenceMs);
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      toast('Mic error: ' + e.error, true);
    }
  };

  recognition.onend = () => {
    if (isListening && !isProcessing) {
      setTimeout(() => {
        try { recognition.start(); } catch {}
      }, 100);
    }
  };

  return true;
}

function startVoice() {
  if (!recognition) {
    if (!initSpeech()) {
      toast('Speech not supported', true);
      return;
    }
  }
  
  mode = 'voice';
  isListening = true;
  bottomEl?.classList.add('voice-active');
  setStatus('Listening...');
  
  try { recognition.start(); } catch {}
}

function stopVoice() {
  isListening = false;
  bottomEl?.classList.remove('voice-active');
  voiceBar?.classList.remove('speaking');
  setStatus('');
  try { recognition.stop(); } catch {}
  mode = 'chat';
}

// Animate waveform when hearing voice
function setVoiceActive(active) {
  if (active) {
    voiceBar?.classList.add('speaking');
  } else {
    voiceBar?.classList.remove('speaking');
  }
}

voiceBtn.addEventListener('click', () => {
  startVoice();
});

closeVoiceBtn?.addEventListener('click', () => {
  stopVoice();
});

// ============================================================================
// CHAT MODE
// ============================================================================

textInput.addEventListener('input', () => {
  sendBtn.classList.toggle('show', textInput.value.trim().length > 0);
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitText();
  }
});

textInput.addEventListener('focus', () => {
  if (isListening) stopVoice();
  mode = 'chat';
  bottomEl?.classList.add('focused');
});

textInput.addEventListener('blur', () => {
  // Small delay to allow clicking send button
  setTimeout(() => {
    if (document.activeElement !== textInput) {
      bottomEl?.classList.remove('focused');
    }
  }, 100);
});

sendBtn.addEventListener('click', submitText);

function submitText() {
  const text = textInput.value.trim();
  if (!text || isProcessing) return;
  
  textInput.value = '';
  sendBtn.classList.remove('show');
  send(text, 'chat');
}

// ============================================================================
// NOTES MODE
// ============================================================================

async function initRecorder() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    
    mediaRecorder.onstop = finishRecording;
    return true;
  } catch {
    toast('Mic access denied', true);
    return false;
  }
}

function startRecording() {
  if (!mediaRecorder) {
    initRecorder().then(ok => ok && startRecording());
    return;
  }

  audioChunks = [];
  mediaRecorder.start();
  recordStart = Date.now();
  mode = 'notes';
  
  notesBtn.classList.add('recording');
  timerEl.classList.add('show');
  setStatus('Recording...');
  
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function stopRecording() {
  if (mediaRecorder?.state !== 'recording') return;
  mediaRecorder.stop();
  clearInterval(timerInterval);
  notesBtn.classList.remove('recording');
  timerEl.classList.remove('show');
  setStatus('Processing...');
}

function updateTimer() {
  const s = Math.floor((Date.now() - recordStart) / 1000);
  timerEl.textContent = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

async function finishRecording() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const duration = Math.floor((Date.now() - recordStart) / 1000);
  
  addMsg(`🎙️ Voice note (${Math.floor(duration/60)}:${(duration%60).toString().padStart(2,'0')})`, 'system');
  
  // Convert to base64
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    sendNote(base64, duration);
  };
  reader.readAsDataURL(blob);
}

function sendNote(audio, duration) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }
  
  isProcessing = true;
  addMsg('Transcribing...', 'system');
  
  ws.send(JSON.stringify({
    type: 'voice_note',
    audio,
    duration
  }));
}

notesBtn.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') {
    stopRecording();
  } else {
    if (isListening) stopVoice();
    startRecording();
  }
});

// ============================================================================
// WEBSOCKET
// ============================================================================

function connect() {
  setStatus('Connecting...');
  ws = new WebSocket(CONFIG.wsUrl);

  ws.onopen = () => setStatus('');
  ws.onclose = () => {
    setStatus('Disconnected');
    setTimeout(connect, 2000);
  };
  ws.onerror = () => setStatus('Connection error');
  
  ws.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch {}
  };
}

function send(text, sendMode) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }

  isProcessing = true;
  addMsg(text, 'user');
  showThinking();

  ws.send(JSON.stringify({ type: 'transcript', text, mode: sendMode }));
}

function handle(data) {
  switch (data.type) {
    case 'ready':
      setStatus('');
      break;

    case 'text':
      removeThinking();
      // Remove "Transcribing..." message if present
      const lastSys = messagesEl.querySelector('.msg.system:last-child');
      if (lastSys?.textContent === 'Transcribing...') lastSys.remove();
      
      addMsg(data.content, 'bot');
      break;

    case 'transcription':
      // Remove "Transcribing..." message
      const transSys = messagesEl.querySelector('.msg.system:last-child');
      if (transSys?.textContent === 'Transcribing...') transSys.remove();
      
      addMsg('📝 ' + data.text, 'bot');
      break;

    case 'audio':
      playAudio(data.data);
      break;

    case 'done':
      isProcessing = false;
      setStatus('');
      // Resume voice if in voice mode
      if (mode === 'voice' && !isListening) {
        startVoice();
      }
      break;

    case 'error':
      removeThinking();
      toast(data.message || 'Error', true);
      isProcessing = false;
      setStatus('');
      break;
  }
}

// ============================================================================
// AUDIO
// ============================================================================

async function playAudio(base64) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    
    if (currentAudio) try { currentAudio.stop(); } catch {}
    
    currentAudio = audioContext.createBufferSource();
    currentAudio.buffer = buffer;
    currentAudio.connect(audioContext.destination);
    currentAudio.start(0);
  } catch (e) {
    console.error('Audio error:', e);
  }
}

// ============================================================================
// INIT
// ============================================================================

initSpeech();
connect();

// Detect keyboard open/close for mobile
if (window.visualViewport) {
  let initialHeight = window.visualViewport.height;
  
  window.visualViewport.addEventListener('resize', () => {
    const currentHeight = window.visualViewport.height;
    const diff = initialHeight - currentHeight;
    
    // Keyboard is likely open if viewport shrunk significantly
    if (diff > 150) {
      document.body.classList.add('keyboard-open');
    } else {
      document.body.classList.remove('keyboard-open');
    }
  });
}

// Shortcut buttons
document.querySelectorAll('.shortcut').forEach(btn => {
  btn.addEventListener('click', () => {
    const msg = btn.dataset.msg;
    if (msg) send(msg, 'chat');
  });
});

// File upload
uploadBtn?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', handleFileUpload);

async function handleFileUpload(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  for (const file of files) {
    try {
      if (file.type.startsWith('image/')) {
        const dataUrl = await readAsDataURL(file);
        send(`[Attached image: ${file.name}]`, 'chat');
      } else {
        const text = await readAsText(file);
        send(`[File: ${file.name}]\n${text.slice(0, 2000)}${text.length > 2000 ? '...' : ''}`, 'chat');
      }
    } catch (err) {
      toast('Failed to read file', true);
    }
  }
  fileInput.value = '';
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
