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

// Voice content
const voiceContent = document.getElementById('voice-content');
const voiceTranscript = document.getElementById('voice-transcript');

// Notes content & bar
const notesContent = document.getElementById('notes-content');
const notesTimerEl = document.getElementById('notes-timer');
const notesBar = document.getElementById('notes-bar');
const closeNotesBtn = document.getElementById('close-notes-btn');
const deleteNotesBtn = document.getElementById('delete-notes-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const historyBtn = document.getElementById('history-btn');
const historyPanel = document.getElementById('history-panel');
const historyBackBtn = document.getElementById('history-back-btn');
const sessionsList = document.getElementById('sessions-list');

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
  if (welcomeEl) welcomeEl.style.display = 'none';
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

    // Update big transcript display
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
        // Reset transcript
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
  document.body.classList.add('voice-mode');
  bottomEl?.classList.add('voice-active');
  
  // Reset transcript
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

let mediaStream = null;

async function initRecorder() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream);
    
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

function releaseMicrophone() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
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
  
  // Show notes mode
  document.body.classList.add('notes-mode');
  bottomEl?.classList.add('notes-active');
  
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function stopRecording() {
  if (mediaRecorder?.state !== 'recording') return;
  mediaRecorder.stop();
  clearInterval(timerInterval);
  
  // Hide notes mode
  document.body.classList.remove('notes-mode');
  bottomEl?.classList.remove('notes-active');
  mode = 'chat';
}

function discardRecording() {
  if (mediaRecorder?.state !== 'recording') return;
  
  mediaRecorder.onstop = () => {
    toast('Recording discarded');
    releaseMicrophone();
  };
  
  mediaRecorder.stop();
  clearInterval(timerInterval);
  audioChunks = [];
  
  document.body.classList.remove('notes-mode');
  bottomEl?.classList.remove('notes-active');
  mode = 'chat';
}

function updateTimer() {
  const s = Math.floor((Date.now() - recordStart) / 1000);
  const timeStr = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  if (notesTimerEl) notesTimerEl.textContent = timeStr;
}

async function finishRecording() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const duration = Math.floor((Date.now() - recordStart) / 1000);
  
  // Release microphone
  releaseMicrophone();
  
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
  if (isListening) stopVoice();
  startRecording();
});

closeNotesBtn?.addEventListener('click', () => {
  stopRecording();
});

deleteNotesBtn?.addEventListener('click', () => {
  discardRecording();
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

// Today's Reports button
document.getElementById('todays-reports-btn')?.addEventListener('click', async () => {
  if (welcomeEl) welcomeEl.style.display = 'none';
  showThinking();
  
  try {
    const response = await fetch('/api/reports/today');
    const data = await response.json();
    removeThinking();
    
    if (!data.reports?.length) {
      addMsg('No reports yet today.', 'bot');
      return;
    }
    
    addMsg(`📊 Today's Reports (${data.reports.length})`, 'system');
    data.reports.forEach(r => addMsg(r.summary, 'bot'));
  } catch (e) {
    removeThinking();
    toast('Failed to load reports', true);
  }
});

// Articulations mode
let articulationsMode = false;

document.getElementById('articulations-btn')?.addEventListener('click', () => {
  articulationsMode = true;
  if (welcomeEl) welcomeEl.style.display = 'none';
  addMsg('✍️ Articulations mode. Type your text and I\'ll refine it. Send "exit" to leave.', 'system');
  textInput?.focus();
});

// Wrap original send for articulations
const _originalSend = send;
send = function(text, sendMode) {
  if (articulationsMode) {
    if (text.toLowerCase() === 'exit') {
      articulationsMode = false;
      addMsg('Exited articulations mode.', 'system');
      return;
    }
    sendArticulation(text);
  } else {
    _originalSend(text, sendMode);
  }
};

async function sendArticulation(text) {
  if (!text.trim()) return;
  
  addMsg(text, 'user');
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
      addMsg(data.result, 'bot');
    } else {
      toast('Failed to refine text', true);
    }
  } catch (e) {
    removeThinking();
    toast('Failed to refine text', true);
  }
}

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

// ============================================================================
// CLEAR CHAT BUTTON
// ============================================================================

let clearBtnTimeout = null;
let hasMessages = false;

function checkHasMessages() {
  // Check if there are any messages (not just welcome)
  const msgs = messagesEl?.querySelectorAll('.msg:not(.system)');
  hasMessages = msgs && msgs.length > 0;
}

function showClearBtn() {
  if (hasMessages && mode === 'chat') {
    clearChatBtn?.classList.add('show');
  }
}

function hideClearBtn() {
  clearChatBtn?.classList.remove('show');
}

function resetClearBtnTimer() {
  hideClearBtn();
  clearTimeout(clearBtnTimeout);
  clearBtnTimeout = setTimeout(() => {
    checkHasMessages();
    showClearBtn();
  }, 2000);
}

// Hide on scroll
messagesEl?.addEventListener('scroll', () => {
  hideClearBtn();
  resetClearBtnTimer();
});

// Hide on any interaction, show after 2s idle
document.addEventListener('click', () => {
  resetClearBtnTimer();
});

document.addEventListener('touchstart', () => {
  resetClearBtnTimer();
});

// Clear chat action
clearChatBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  
  // Stop any ongoing processing
  isProcessing = false;
  removeThinking();
  
  // Remove all messages
  const msgs = messagesEl?.querySelectorAll('.msg');
  msgs?.forEach(msg => msg.remove());
  
  // Remove thinking indicator if present
  const thinking = document.getElementById('thinking-indicator');
  if (thinking) thinking.remove();
  
  // Show welcome again
  if (welcomeEl) welcomeEl.style.display = '';
  
  hideClearBtn();
  hasMessages = false;
  toast('Chat cleared');
});

// Start the timer
resetClearBtnTimer();

// ============================================================================
// CHAT HISTORY
// ============================================================================

historyBtn?.addEventListener('click', () => {
  historyPanel?.classList.add('show');
  loadSessions();
});

historyBackBtn?.addEventListener('click', () => {
  historyPanel?.classList.remove('show');
});

async function loadSessions() {
  if (!sessionsList) return;
  
  sessionsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-tertiary);">Loading...</div>';
  
  try {
    const response = await fetch('/api/sessions');
    const data = await response.json();
    
    if (!data.sessions?.length) {
      sessionsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-tertiary);">No chat history</div>';
      return;
    }
    
    sessionsList.innerHTML = data.sessions.map(s => {
      const time = new Date(s.updatedAt).toLocaleString();
      const channelLabel = s.channel === 'whatsapp' ? '📱 WhatsApp' : '🌐 Web';
      return `
        <div class="session-item" data-key="${s.key}">
          <div class="channel">${channelLabel}</div>
          <div class="preview">${escapeHtml(s.preview)}</div>
          <div class="time">${time}</div>
        </div>
      `;
    }).join('');
    
    // Add click handlers
    sessionsList.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', () => {
        const key = item.dataset.key;
        loadSessionHistory(key);
      });
    });
    
  } catch (e) {
    console.error('Failed to load sessions:', e);
    sessionsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-tertiary);">Failed to load history</div>';
  }
}

async function loadSessionHistory(sessionKey) {
  // For now, just show the session in the main chat
  // Could expand to a detailed view later
  historyPanel?.classList.remove('show');
  
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}`);
    const data = await response.json();
    
    if (!data.messages?.length) {
      toast('No messages in this session');
      return;
    }
    
    // Clear current messages
    const msgs = messagesEl?.querySelectorAll('.msg');
    msgs?.forEach(msg => msg.remove());
    if (welcomeEl) welcomeEl.style.display = 'none';
    
    // Show messages from history
    data.messages.forEach(m => {
      if (m.role === 'user') {
        const text = m.content?.[0]?.text || m.content || '';
        if (text && !text.startsWith('[message_id:')) {
          addMsg(text.replace(/\n\[message_id:.*\]$/, ''), 'user');
        }
      } else if (m.role === 'assistant') {
        const textPart = m.content?.find?.(c => c.type === 'text');
        const text = textPart?.text || m.content || '';
        if (text) {
          addMsg(text, 'bot');
        }
      }
    });
    
    hasMessages = true;
    
  } catch (e) {
    console.error('Failed to load session history:', e);
    toast('Failed to load chat', true);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
