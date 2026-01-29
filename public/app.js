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
const voiceContent = document.getElementById('voice-content');
const voiceTranscript = document.getElementById('voice-transcript');
const notesContent = document.getElementById('notes-content');
const notesTimerEl = document.getElementById('notes-timer');
const notesBar = document.getElementById('notes-bar');
const closeNotesBtn = document.getElementById('close-notes-btn');
const deleteNotesBtn = document.getElementById('delete-notes-btn');
const closeBtn = document.getElementById('close-btn');
const historyBtn = document.getElementById('history-btn');

// State
let ws = null;
let mode = 'chat';
let pageState = 'intro'; // 'intro' or 'chatfeed'
let recognition = null;
let isListening = false;
let isProcessing = false;
let audioContext = null;
let currentAudio = null;
let mediaRecorder = null;
let audioChunks = [];
let recordStart = null;
let timerInterval = null;
let mediaStream = null;

// ============================================================================
// PAGE STATE MANAGEMENT
// ============================================================================

function showIntroPage() {
  pageState = 'intro';
  // Show welcome
  if (welcomeEl) welcomeEl.style.display = '';
  // Clear messages (but keep welcome)
  messagesEl?.querySelectorAll('.msg').forEach(m => m.remove());
  // Show history button
  historyBtn?.classList.remove('hidden');
  // Hide close button
  closeBtn?.classList.remove('show');
}

function showChatFeedPage() {
  pageState = 'chatfeed';
  // Hide welcome
  if (welcomeEl) welcomeEl.style.display = 'none';
  // Hide history button
  historyBtn?.classList.add('hidden');
  // Show close button
  closeBtn?.classList.add('show');
}

// History button - load all messages and switch to chat feed
historyBtn?.addEventListener('click', async () => {
  showChatFeedPage();
  
  // Show loading
  const loadingEl = document.createElement('div');
  loadingEl.className = 'msg system';
  loadingEl.textContent = 'Loading...';
  messagesEl.appendChild(loadingEl);
  
  try {
    const response = await fetch('/api/messages/all');
    const data = await response.json();
    
    // Remove loading
    loadingEl.remove();
    
    if (!data.messages?.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'msg system';
      emptyEl.textContent = 'No chat history yet';
      messagesEl.appendChild(emptyEl);
      return;
    }
    
    // Display all messages
    data.messages.forEach(m => {
      const el = document.createElement('div');
      el.className = `msg ${m.role === 'user' ? 'user' : 'bot'}`;
      if (m.role === 'user') {
        el.textContent = m.text;
      } else {
        el.innerHTML = formatMessage(m.text);
      }
      messagesEl.appendChild(el);
    });
    
    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
  } catch (e) {
    loadingEl.textContent = 'Failed to load history';
    console.error('Failed to load messages:', e);
  }
});

// Close button - go back to intro
closeBtn?.addEventListener('click', () => {
  showIntroPage();
});

// ============================================================================
// MESSAGES
// ============================================================================

function addMsg(text, type) {
  // If on intro page and sending a message, switch to chat feed
  if (pageState === 'intro') {
    showChatFeedPage();
  }
  
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  
  if (type === 'bot') {
    el.innerHTML = formatMessage(text);
  } else if (type === 'user') {
    el.textContent = text;
  } else {
    el.textContent = text;
  }
  
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function formatMessage(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.*)$/, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');
}

function showThinking() {
  removeThinking();
  const el = document.createElement('div');
  el.className = 'msg bot thinking';
  el.id = 'thinking-indicator';
  el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeThinking() {
  document.getElementById('thinking-indicator')?.remove();
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
    setVoiceActive(true);

    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }

    const currentText = (final + interim).trim();
    if (currentText && voiceTranscript) {
      voiceTranscript.textContent = currentText;
      voiceTranscript.classList.remove('placeholder');
    }

    clearTimeout(timer);
    timer = setTimeout(() => {
      setVoiceActive(false);
      const text = final.trim();
      if (text && !isProcessing) {
        send(text, 'voice');
        final = '';
        if (voiceTranscript) {
          voiceTranscript.textContent = 'Start speaking...';
          voiceTranscript.classList.add('placeholder');
        }
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
      setTimeout(() => { try { recognition.start(); } catch {} }, 100);
    }
  };

  return true;
}

function startVoice() {
  if (!recognition && !initSpeech()) {
    toast('Speech not supported', true);
    return;
  }
  mode = 'voice';
  isListening = true;
  document.body.classList.add('voice-mode');
  bottomEl?.classList.add('voice-active');
  if (voiceTranscript) {
    voiceTranscript.textContent = 'Start speaking...';
    voiceTranscript.classList.add('placeholder');
  }
  try { recognition.start(); } catch {}
}

function stopVoice() {
  isListening = false;
  document.body.classList.remove('voice-mode');
  bottomEl?.classList.remove('voice-active');
  voiceBar?.classList.remove('speaking');
  try { recognition.stop(); } catch {}
  mode = 'chat';
}

function setVoiceActive(active) {
  voiceBar?.classList.toggle('speaking', active);
}

voiceBtn?.addEventListener('click', startVoice);
closeVoiceBtn?.addEventListener('click', stopVoice);

// ============================================================================
// CHAT MODE
// ============================================================================

textInput?.addEventListener('input', () => {
  const hasText = textInput.value.trim().length > 0 || pendingAttachment;
  sendBtn?.classList.toggle('show', hasText);
  voiceBtn?.classList.toggle('hidden', hasText);
  
  // Auto-resize textarea
  if (textInput) {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
  }
});

textInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitText();
  }
});

textInput?.addEventListener('focus', () => {
  if (isListening) stopVoice();
  mode = 'chat';
  bottomEl?.classList.add('focused');
});

textInput?.addEventListener('blur', () => {
  setTimeout(() => {
    if (document.activeElement !== textInput) {
      bottomEl?.classList.remove('focused');
    }
  }, 100);
});

sendBtn?.addEventListener('click', submitText);

function submitText() {
  const text = textInput?.value.trim();
  if (!text || isProcessing) return;
  textInput.value = '';
  textInput.style.height = 'auto'; // Reset height
  sendBtn?.classList.remove('show');
  send(text, 'chat');
}

// ============================================================================
// NOTES MODE
// ============================================================================

async function initRecorder() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = finishRecording;
    return true;
  } catch {
    toast('Mic access denied', true);
    return false;
  }
}

function releaseMicrophone() {
  mediaStream?.getTracks().forEach(t => t.stop());
  mediaStream = null;
  mediaRecorder = null;
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
  document.body.classList.add('notes-mode');
  bottomEl?.classList.add('notes-active');
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function stopRecording() {
  if (mediaRecorder?.state !== 'recording') return;
  mediaRecorder.stop();
  clearInterval(timerInterval);
  document.body.classList.remove('notes-mode');
  bottomEl?.classList.remove('notes-active');
  mode = 'chat';
}

function discardRecording() {
  if (mediaRecorder?.state !== 'recording') return;
  mediaRecorder.onstop = () => { toast('Recording discarded'); releaseMicrophone(); };
  mediaRecorder.stop();
  clearInterval(timerInterval);
  audioChunks = [];
  document.body.classList.remove('notes-mode');
  bottomEl?.classList.remove('notes-active');
  mode = 'chat';
}

function updateTimer() {
  const s = Math.floor((Date.now() - recordStart) / 1000);
  if (notesTimerEl) notesTimerEl.textContent = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

async function finishRecording() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const duration = Math.floor((Date.now() - recordStart) / 1000);
  releaseMicrophone();
  addMsg(`🎙️ Voice note (${Math.floor(duration/60)}:${(duration%60).toString().padStart(2,'0')})`, 'system');
  const reader = new FileReader();
  reader.onload = () => sendNote(reader.result.split(',')[1], duration);
  reader.readAsDataURL(blob);
}

function sendNote(audio, duration) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }
  isProcessing = true;
  addMsg('Transcribing...', 'system');
  ws.send(JSON.stringify({ type: 'voice_note', audio, duration }));
}

notesBtn?.addEventListener('click', () => { if (isListening) stopVoice(); startRecording(); });
closeNotesBtn?.addEventListener('click', stopRecording);
deleteNotesBtn?.addEventListener('click', discardRecording);

// ============================================================================
// WEBSOCKET
// ============================================================================

function connect() {
  setStatus('Connecting...');
  ws = new WebSocket(CONFIG.wsUrl);
  ws.onopen = () => setStatus('');
  ws.onclose = () => { setStatus('Disconnected'); setTimeout(connect, 2000); };
  ws.onerror = () => setStatus('Connection error');
  ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch {} };
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
    case 'ready': setStatus(''); break;
    case 'text':
      removeThinking();
      const lastSys = messagesEl?.querySelector('.msg.system:last-child');
      if (lastSys?.textContent === 'Transcribing...') lastSys.remove();
      addMsg(data.content, 'bot');
      break;
    case 'transcription':
      const transSys = messagesEl?.querySelector('.msg.system:last-child');
      if (transSys?.textContent === 'Transcribing...') transSys.remove();
      addMsg('📝 ' + data.text, 'bot');
      break;
    case 'audio': playAudio(data.data); break;
    case 'done':
      isProcessing = false;
      setStatus('');
      if (mode === 'voice' && !isListening) startVoice();
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
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    if (currentAudio) try { currentAudio.stop(); } catch {}
    currentAudio = audioContext.createBufferSource();
    currentAudio.buffer = buffer;
    currentAudio.connect(audioContext.destination);
    currentAudio.start(0);
  } catch (e) { console.error('Audio error:', e); }
}

// ============================================================================
// INIT
// ============================================================================

initSpeech();
connect();

// Keyboard detection
if (window.visualViewport) {
  let initialHeight = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    const diff = initialHeight - window.visualViewport.height;
    document.body.classList.toggle('keyboard-open', diff > 150);
  });
}

// Shortcut buttons
document.querySelectorAll('.shortcut').forEach(btn => {
  btn.addEventListener('click', () => {
    const msg = btn.dataset.msg;
    if (msg) send(msg, 'chat');
  });
});

// Articulations mode
let articulationsMode = false;

document.getElementById('articulations-btn')?.addEventListener('click', () => {
  articulationsMode = true;
  showChatFeedPage();
  
  // Show intro message
  const introEl = document.createElement('div');
  introEl.className = 'msg system';
  introEl.textContent = '✍️ Articulations mode. Type your text and I\'ll refine it.';
  messagesEl.appendChild(introEl);
  
  // Update placeholder
  if (textInput) textInput.placeholder = 'Type text to refine...';
  
  // Focus input
  textInput?.focus();
});

// Override send for articulations mode
const originalSend = send;
send = function(text, sendMode) {
  if (articulationsMode) {
    sendArticulation(text);
  } else {
    originalSend(text, sendMode);
  }
};

async function sendArticulation(text) {
  if (!text.trim()) return;
  
  // Show user message
  const userEl = document.createElement('div');
  userEl.className = 'msg user';
  userEl.textContent = text;
  messagesEl.appendChild(userEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  // Show thinking
  showThinking();
  
  try {
    const response = await fetch('/api/articulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    const data = await response.json();
    removeThinking();
    
    if (data.result) {
      const botEl = document.createElement('div');
      botEl.className = 'msg bot';
      botEl.textContent = data.result;
      messagesEl.appendChild(botEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch (e) {
    removeThinking();
    toast('Failed to refine text', true);
  }
}

// Reset articulations mode when closing
const originalShowIntroPage = showIntroPage;
showIntroPage = function() {
  articulationsMode = false;
  if (textInput) textInput.placeholder = 'Talk to me';
  originalShowIntroPage();
};

// Today's Reports button - shows all daily reports
document.getElementById('todays-reports-btn')?.addEventListener('click', async () => {
  showChatFeedPage();
  
  // Show loading
  const loadingEl = document.createElement('div');
  loadingEl.className = 'msg system';
  loadingEl.textContent = 'Loading today\'s reports...';
  messagesEl.appendChild(loadingEl);
  
  try {
    const response = await fetch('/api/reports/today');
    const data = await response.json();
    
    loadingEl.remove();
    
    if (!data.reports?.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'msg system';
      emptyEl.textContent = 'No reports yet today';
      messagesEl.appendChild(emptyEl);
      return;
    }
    
    // Show header
    const headerEl = document.createElement('div');
    headerEl.className = 'msg system';
    headerEl.textContent = `📊 Today's Reports (${data.reports.length})`;
    messagesEl.appendChild(headerEl);
    
    // Display each report as a bot message
    data.reports.forEach(r => {
      const el = document.createElement('div');
      el.className = 'msg bot';
      el.innerHTML = formatMessage(r.summary);
      messagesEl.appendChild(el);
    });
    
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
  } catch (e) {
    loadingEl.textContent = 'Failed to load reports';
    console.error('Failed to load reports:', e);
  }
});

// File upload with preview
const attachmentPreview = document.getElementById('attachment-preview');
const attachmentIcon = document.getElementById('attachment-icon');
const attachmentName = document.getElementById('attachment-name');
const attachmentSize = document.getElementById('attachment-size');
const removeAttachmentBtn = document.getElementById('remove-attachment-btn');

let pendingAttachment = null;

uploadBtn?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  
  // Store the file
  pendingAttachment = file;
  
  // Update preview
  attachmentName.textContent = file.name;
  attachmentSize.textContent = formatFileSize(file.size);
  
  // Update icon based on type
  if (file.type.startsWith('image/')) {
    attachmentIcon.classList.add('image');
    attachmentIcon.innerHTML = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
  } else {
    attachmentIcon.classList.remove('image');
    attachmentIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
  }
  
  // Show preview
  attachmentPreview?.classList.add('show');
  
  // Show send button, hide voice button
  sendBtn?.classList.add('show');
  voiceBtn?.classList.add('hidden');
  
  // Focus text input
  textInput?.focus();
  
  fileInput.value = '';
});

removeAttachmentBtn?.addEventListener('click', () => {
  pendingAttachment = null;
  attachmentPreview?.classList.remove('show');
  if (!textInput?.value.trim()) {
    sendBtn?.classList.remove('show');
    voiceBtn?.classList.remove('hidden');
  }
});

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Override submitText to handle attachments
const originalSubmitText = submitText;
submitText = async function() {
  const text = textInput?.value.trim() || '';
  
  if (!text && !pendingAttachment) return;
  if (isProcessing) return;
  
  let messageText = text;
  let imageData = null;
  
  // Handle attachment
  if (pendingAttachment) {
    const file = pendingAttachment;
    try {
      if (file.type.startsWith('image/')) {
        // Read image as base64
        imageData = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result); // This is a data URL
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        messageText = text || 'What is this image?';
      } else {
        const content = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = rej;
          r.readAsText(file);
        });
        const preview = content.slice(0, 2000) + (content.length > 2000 ? '...' : '');
        messageText = text ? `${text}\n\n[File: ${file.name}]\n${preview}` : `[File: ${file.name}]\n${preview}`;
      }
    } catch {
      toast('Failed to read file', true);
      return;
    }
    
    // Clear attachment
    pendingAttachment = null;
    attachmentPreview?.classList.remove('show');
  }
  
  if (!messageText) return;
  
  textInput.value = '';
  textInput.style.height = 'auto';
  sendBtn?.classList.remove('show');
  voiceBtn?.classList.remove('hidden');
  
  // Send with image if present
  if (imageData) {
    sendWithImage(messageText, imageData);
  } else {
    send(messageText, 'chat');
  }
};

// Send message with image attachment
function sendWithImage(text, imageData) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }
  isProcessing = true;
  
  // Show user message with image indicator
  const userMsg = addMsg(text + ' 📷', 'user');
  showThinking();
  
  ws.send(JSON.stringify({ type: 'transcript', text, image: imageData, mode: 'chat' }));
}
