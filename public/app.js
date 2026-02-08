/**
 * SparkGPT - Voice + Chat + Notes
 * 
 * Modular architecture - see /modules/ for components
 */

import { CONFIG } from './modules/config.js';
import { 
  trackDisplayedMessage, 
  isMessageDisplayed, 
  formatMessage,
  formatFileSize,
  extractMessageText,
  escapeHtml
} from './modules/ui.js';
import {
  getRealtimeWsUrl,
  float32ToBase64PCM16,
  base64PCM16ToFloat32
} from './modules/audio.js';

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
const sparkStatusEl = document.getElementById('spark-status');
const sessionStatusIndicator = document.getElementById('session-status-indicator');

// Update Spark gateway connection status pill (and session page status)
function updateSparkStatus(state) {
  // Update main status pill
  if (sparkStatusEl) {
    sparkStatusEl.classList.remove('connected', 'connecting');
    if (state === 'connected') {
      sparkStatusEl.classList.add('connected');
      sparkStatusEl.title = 'Clawdbot Gateway: Connected';
    } else if (state === 'connecting') {
      sparkStatusEl.classList.add('connecting');
      sparkStatusEl.title = 'Clawdbot Gateway: Connecting...';
    } else {
      // disconnected - no class, shows red
      sparkStatusEl.title = 'Clawdbot Gateway: Disconnected';
    }
  }

  // Update session page status indicator
  if (sessionStatusIndicator) {
    sessionStatusIndicator.classList.remove('connected', 'connecting');
    if (state === 'connected') {
      sessionStatusIndicator.classList.add('connected');
      sessionStatusIndicator.title = 'Connected';
    } else if (state === 'connecting') {
      sessionStatusIndicator.classList.add('connecting');
      sessionStatusIndicator.title = 'Connecting...';
    } else {
      sessionStatusIndicator.title = 'Disconnected';
    }
  }
}
const voiceBar = document.getElementById('voice-bar');
const closeVoiceBtn = document.getElementById('close-voice-btn');
const waveformEl = document.getElementById('waveform');
const voiceContent = document.getElementById('voice-content');
const voiceStatus = document.getElementById('voice-status');
const notesContent = document.getElementById('notes-content');
const notesTimerEl = document.getElementById('notes-timer');
const notesBar = document.getElementById('notes-bar');
const closeNotesBtn = document.getElementById('close-notes-btn');
const deleteNotesBtn = document.getElementById('delete-notes-btn');
const notesRecording = document.getElementById('notes-recording');
const notesResults = document.getElementById('notes-results');
const notesStatus = document.getElementById('notes-status');
const notesTranscriptionMsg = document.getElementById('notes-transcription-msg');
const notesTranscription = document.getElementById('notes-transcription');
const notesSummaryMsg = document.getElementById('notes-summary-msg');
const notesSummary = document.getElementById('notes-summary');
const notesSaveBtn = document.getElementById('notes-save-btn');
const notesDeleteBtn = document.getElementById('notes-delete-btn');
const notesBackBtn = document.getElementById('notes-back-btn');

// Current note data for saving
let currentNoteData = { transcription: '', summary: '' };
const closeBtn = document.getElementById('close-btn');
const historyBtn = document.getElementById('history-btn');
const themeBtn = document.getElementById('theme-btn');

// Theme toggle
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
}
initTheme();

themeBtn?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  let newTheme;
  if (current === 'dark') {
    newTheme = 'light';
  } else if (current === 'light') {
    newTheme = 'dark';
  } else {
    // No explicit theme set, toggle from system preference
    newTheme = prefersDark ? 'light' : 'dark';
  }
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});

// State
let ws = null;
let mode = 'chat';
let pageState = 'intro'; // 'intro' or 'chatfeed'
let articulationsMode = false; // Text refinement mode
// Realtime voice state is defined in the REALTIME VOICE MODE section
let isListening = false;
let realtimeReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isProcessing = false;
let audioContext = null;
let currentAudio = null;
let mediaRecorder = null;
let audioChunks = [];
let recordStart = null;
let timerInterval = null;
let mediaStream = null;

// ============================================================================
// MODE SESSION STATE - Separate sessions for each mode
// ============================================================================
let currentSparkMode = null; // null = main session, or 'dev', 'research', 'plan', 'articulate', 'dailyreports', 'videogen'
let modeHistory = {}; // Cache history per mode
let modeConfigs = {}; // Loaded from server

// Mode configuration (will be loaded from server, fallback here)
const MODE_DEFAULTS = {
  dev: { name: 'Dev Mode', icon: '👨‍💻', notifyWhatsApp: true },
  research: { name: 'Research Mode', icon: '🔬', notifyWhatsApp: true },
  plan: { name: 'Plan Mode', icon: '📋', notifyWhatsApp: true },
  articulate: { name: 'Articulate Mode', icon: '✍️', notifyWhatsApp: false },
  dailyreports: { name: 'Daily Reports', icon: '📊', notifyWhatsApp: true },
  videogen: { name: 'Video Gen', icon: '🎬', notifyWhatsApp: true }
};

// Load mode configs from server
async function loadModeConfigs() {
  try {
    const res = await fetch('/api/modes');
    const data = await res.json();
    modeConfigs = data.modes || {};
    console.log('📦 Loaded mode configs:', Object.keys(modeConfigs));
  } catch (e) {
    console.error('Failed to load mode configs:', e);
    modeConfigs = MODE_DEFAULTS;
  }
}

// Get config for a mode
function getModeConfig(mode) {
  return modeConfigs[mode] || MODE_DEFAULTS[mode] || { name: mode, icon: '📦' };
}

// Enter a mode (show mode-specific chat view)
async function enterMode(modeName) {
  const config = getModeConfig(modeName);
  console.log(`📦 Entering ${config.name}...`);
  
  currentSparkMode = modeName;
  
  // Show chat feed page with mode indicator
  showChatFeedPage();
  
  // Update UI to show mode
  updateModeIndicator();
  
  // Load mode history
  await loadModeHistory(modeName);
  
  // Clear current messages and show mode history
  renderModeHistory(modeName);
}

// Exit mode (return to main session)
function exitMode() {
  console.log('📦 Exiting mode, returning to main...');
  
  currentSparkMode = null;
  updateModeIndicator();
  
  // Reload main chat history
  historyRendered = false;
  if (pageState === 'chatfeed') {
    renderChatHistory();
  }
}

// Update mode indicator in UI
function updateModeIndicator() {
  let indicator = document.getElementById('mode-indicator');
  
  if (currentSparkMode) {
    const config = getModeConfig(currentSparkMode);
    
    if (!indicator) {
      // Create indicator
      indicator = document.createElement('div');
      indicator.id = 'mode-indicator';
      indicator.className = 'mode-indicator';
      document.querySelector('.top-bar')?.appendChild(indicator);
    }
    
    indicator.innerHTML = `
      <span class="mode-icon">${config.icon}</span>
      <span class="mode-name">${config.name}</span>
      <button class="mode-exit-btn" onclick="exitMode()">✕</button>
    `;
    indicator.style.display = 'flex';
  } else {
    if (indicator) {
      indicator.style.display = 'none';
    }
  }
}

// Load history from mode session
async function loadModeHistory(modeName) {
  try {
    // Request via WebSocket if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'mode_history', sparkMode: modeName }));
    } else {
      // Fallback to REST
      const res = await fetch(`/api/modes/${modeName}/history`);
      const data = await res.json();
      modeHistory[modeName] = data.messages || [];
    }
  } catch (e) {
    console.error(`Failed to load ${modeName} history:`, e);
    modeHistory[modeName] = [];
  }
}

// Render mode history in chat feed
function renderModeHistory(modeName) {
  const messages = modeHistory[modeName] || [];
  // Clear messages but preserve the welcome element
  messagesEl.querySelectorAll('.msg, .mode-empty-state').forEach(el => el.remove());
  
  if (messages.length === 0) {
    const config = getModeConfig(modeName);
    // Show empty state
    const emptyEl = document.createElement('div');
    emptyEl.className = 'mode-empty-state';
    emptyEl.innerHTML = `
      <div class="mode-empty-icon">${config.icon}</div>
      <div class="mode-empty-title">${config.name}</div>
      <div class="mode-empty-desc">Start a conversation in this mode.</div>
    `;
    messagesEl.appendChild(emptyEl);
  } else {
    // Render messages
    for (const msg of messages) {
      const text = extractMessageText(msg);
      if (text) {
        addMessage(msg.role === 'assistant' ? 'bot' : 'user', text);
      }
    }
  }
  
  scrollToBottom();
}

// extractMessageText imported from modules/ui.js

// Initialize mode system
loadModeConfigs();

// Pre-loaded chat history (loaded in background on page init)
let preloadedHistory = null;
let historyLoadPromise = null;
let historyRendered = false; // Prevent double-rendering

// ============================================================================
// PAGE STATE MANAGEMENT
// ============================================================================

// Background load chat history on page init (no loading screen)
function loadHistoryInBackground(forceRefresh = false) {
  if (historyLoadPromise && !forceRefresh) return historyLoadPromise;
  
  historyLoadPromise = fetch('/api/messages/all')
    .then(res => res.json())
    .then(data => {
      preloadedHistory = data.messages || [];
      console.log(`📜 Pre-loaded ${preloadedHistory.length} messages`);
      
      // Track latest timestamp for catch-up on reconnect
      if (preloadedHistory.length > 0) {
        const lastMsg = preloadedHistory[preloadedHistory.length - 1];
        if (lastMsg.timestamp && lastMsg.timestamp > lastMessageTimestamp) {
          lastMessageTimestamp = lastMsg.timestamp;
          console.log(`📜 Set lastMessageTimestamp to ${lastMessageTimestamp}`);
        }
      }
      
      return preloadedHistory;
    })
    .catch(e => {
      console.error('Failed to preload history:', e);
      preloadedHistory = [];
      return [];
    });
  
  return historyLoadPromise;
}

// Refresh preloaded history in background (called after new messages arrive)
function refreshHistoryCache() {
  historyLoadPromise = null;
  historyRendered = false;
  loadHistoryInBackground(true);
}

// Render pre-loaded history into messages container
function renderPreloadedHistory() {
  // Prevent double-rendering
  if (historyRendered) return;
  if (!preloadedHistory || preloadedHistory.length === 0) return;

  historyRendered = true;

  preloadedHistory.forEach(m => {
    const el = document.createElement('div');
    el.className = `msg ${m.role === 'user' ? 'user' : 'bot'}`;
    if (m.role === 'user') {
      el.textContent = m.text;
    } else {
      el.innerHTML = formatMessage(m.text);
    }

    // Add timestamp if available
    if (m.timestamp) {
      const timeEl = document.createElement('span');
      timeEl.className = 'msg-time';
      timeEl.textContent = formatRelativeTime(m.timestamp);
      el.appendChild(timeEl);
    }

    messagesEl.appendChild(el);
  });

  // Scroll to bottom
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Transition lock to prevent race conditions between page state changes
let isTransitioning = false;

function showIntroPage() {
  // Prevent race conditions during transitions
  if (isTransitioning) {
    console.log('showIntroPage blocked - transition in progress');
    return;
  }
  isTransitioning = true;
  
  console.log('showIntroPage called');
  
  requestAnimationFrame(() => {
    pageState = 'intro';
    
    // Clear any active mode session
    currentSparkMode = null;
    updateModeIndicator();
    
    // Reset articulations mode (previously monkey-patched)
    articulationsMode = false;
    if (textInput) textInput.placeholder = 'Talk to me';
    
    // Remove chatfeed mode from body
    document.body.classList.remove('chatfeed-mode');
    // Show welcome
    if (welcomeEl) welcomeEl.style.display = '';
    // Clear messages (but keep welcome) - includes thinking indicators
    messagesEl?.querySelectorAll('.msg').forEach(m => m.remove());
    // Remove any thinking indicator that might be lingering
    removeThinking();
    // Reset history rendered flag so it can be re-rendered next time
    historyRendered = false;
    // Show history button (class-based only)
    if (historyBtn) {
      historyBtn.classList.remove('hidden');
    }
    // Close button removed - overscroll gesture handles return to intro
    // Reset scroll position and set overflow for browsers without :has() support
    if (messagesEl) {
      messagesEl.scrollTop = 0;
      messagesEl.style.overflow = 'hidden';
    }
    
    isTransitioning = false;
  });
}

function showChatFeedPage(options = {}) {
  // Prevent race conditions during transitions
  if (isTransitioning) {
    console.log('showChatFeedPage blocked - transition in progress');
    return;
  }
  isTransitioning = true;
  
  console.log('showChatFeedPage called');
  
  requestAnimationFrame(() => {
    pageState = 'chatfeed';
    // Add chatfeed mode to body (hides header buttons)
    document.body.classList.add('chatfeed-mode');
    // Hide welcome
    if (welcomeEl) welcomeEl.style.display = 'none';
    // Hide history button (class-based only)
    if (historyBtn) {
      historyBtn.classList.add('hidden');
    }
    // Close button removed - overscroll gesture handles return to intro
    // Enable scrolling for browsers without :has() support
    if (messagesEl) {
      messagesEl.style.overflow = 'auto';
    }
    
    // Render pre-loaded history instantly (unless skipped)
    if (!options.skipHistory && preloadedHistory && preloadedHistory.length > 0) {
      renderPreloadedHistory();
    }
    
    isTransitioning = false;
  });
}

// History button - show chat feed with pre-loaded history (instant, no loading)
historyBtn?.addEventListener('click', async () => {
  // If history not yet loaded, wait for it briefly
  if (preloadedHistory === null && historyLoadPromise) {
    await historyLoadPromise;
  }
  
  // showChatFeedPage will render pre-loaded history automatically
  showChatFeedPage();
  
  // If still empty after load, show message
  if (!preloadedHistory || preloadedHistory.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'msg system';
    emptyEl.textContent = 'No chat history yet';
    messagesEl.appendChild(emptyEl);
  }
});

// Close button - go back to intro (legacy, button now hidden)
closeBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  console.log('Close button clicked');
  showIntroPage();
});

// ============================================================================
// CLOSE CHAT BUTTON (shown in chatfeed mode)
// ============================================================================
const closeChatBtn = document.getElementById('close-chat-btn');

closeChatBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  // Add slide-out animation
  document.body.classList.add('slide-out');
  setTimeout(() => {
    document.body.classList.remove('slide-out');
    showIntroPage();
  }, 250);
});

// ============================================================================
// PULL DOWN TO OPEN CHAT (on intro page)
// ============================================================================
const SCROLL_THRESHOLD = 50; // pixels to pull down to trigger
let introTouchStartY = 0;
let introScrollTriggered = false;

// Touch detection on messages area (which contains welcome on intro)
messagesEl?.addEventListener('touchstart', (e) => {
  if (pageState !== 'intro') return;
  introTouchStartY = e.touches[0].clientY;
  introScrollTriggered = false;
}, { passive: true });

messagesEl?.addEventListener('touchmove', (e) => {
  if (pageState !== 'intro' || introScrollTriggered) return;
  
  const currentY = e.touches[0].clientY;
  const pullDistance = currentY - introTouchStartY; // positive = finger moved down (pull down gesture)
  
  if (pullDistance >= SCROLL_THRESHOLD) {
    introScrollTriggered = true;
    openChatWithLoading();
  }
}, { passive: true });

// Mouse wheel on intro
messagesEl?.addEventListener('wheel', (e) => {
  if (pageState !== 'intro') return;
  
  // deltaY < 0 means scrolling up (pull down equivalent)
  if (e.deltaY < -SCROLL_THRESHOLD) {
    openChatWithLoading();
  }
}, { passive: true });

// Open chat with loading state
async function openChatWithLoading() {
  // Show loading indicator
  showThinking();
  
  // Try to load history with timeout
  try {
    if (preloadedHistory === null && historyLoadPromise) {
      // Wait for existing load, but timeout after 3s
      await Promise.race([
        historyLoadPromise,
        new Promise((_, reject) => setTimeout(() => reject('timeout'), 3000))
      ]);
    } else if (preloadedHistory === null) {
      // Force a fresh load with timeout
      await Promise.race([
        loadHistoryInBackground(true),
        new Promise((_, reject) => setTimeout(() => reject('timeout'), 3000))
      ]);
    }
  } catch (e) {
    console.log('History load timeout or error:', e);
  }
  
  removeThinking();
  
  // Add slide-in animation
  document.body.classList.add('slide-in');
  showChatFeedPage();
  setTimeout(() => document.body.classList.remove('slide-in'), 400);
  
  // Show message if no history
  if (!preloadedHistory || preloadedHistory.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'msg system';
    emptyEl.textContent = 'No chat history yet';
    messagesEl.appendChild(emptyEl);
  }
}

// ============================================================================
// MESSAGES
// ============================================================================
// Message deduplication: trackDisplayedMessage, isMessageDisplayed, formatMessage
// are imported from modules/ui.js

// Check if user is scrolled near the bottom
function isNearBottom(threshold = 100) {
  if (!messagesEl) return true;
  const { scrollTop, scrollHeight, clientHeight } = messagesEl;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

// Auto-scroll only if user is near bottom
function scrollToBottomIfNeeded() {
  if (isNearBottom()) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function addMsg(text, type, options = {}) {
  // If on intro page, DON'T auto-switch unless it's a user-initiated message
  // This prevents sync/bot messages from interrupting the intro page
  if (pageState === 'intro') {
    if (options.userInitiated) {
      // User sent a message - switch to chat feed
      if (preloadedHistory && preloadedHistory.length > 0 && !historyRendered) {
        renderPreloadedHistory();
      }
      showChatFeedPage({ skipHistory: true });
    } else {
      // Bot/sync message while on intro - just show toast, don't add to DOM
      if (type === 'bot') {
        toast('New message from Spark');
      }
      return null; // Don't add message to DOM
    }
  }

  // Track this message for deduplication
  trackDisplayedMessage(text);

  const el = document.createElement('div');
  el.className = `msg ${type}`;

  if (type === 'bot') {
    el.innerHTML = formatMessage(text);
  } else if (type === 'user') {
    el.textContent = text;
  } else {
    el.textContent = text;
  }

  // Add timestamp if provided (options.timestamp)
  const timestamp = options.timestamp;
  if (timestamp) {
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatRelativeTime(timestamp);
    el.appendChild(timeEl);
  }

  messagesEl.appendChild(el);

  // Only auto-scroll if user is near bottom (allows scrolling up to read history)
  // Exception: user messages always scroll to bottom
  if (type === 'user') {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else {
    scrollToBottomIfNeeded();
  }
  return el;
}

// formatMessage is imported from modules/ui.js

function showThinking() {
  // Don't show thinking indicator on intro page
  if (pageState === 'intro') return;
  
  removeThinking();
  const el = document.createElement('div');
  el.className = 'msg bot thinking';
  el.id = 'thinking-indicator';
  el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(el);
  scrollToBottomIfNeeded();
}

function removeThinking() {
  document.getElementById('thinking-indicator')?.remove();
}

function updateThinking(statusText) {
  const el = document.getElementById('thinking-indicator');
  if (!el) {
    showThinking();
    return updateThinking(statusText);
  }
  el.innerHTML = `
    <div class="thinking-content">
      <span class="thinking-status">${escapeHtml(statusText)}</span>
      <div class="thinking-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  scrollToBottomIfNeeded();
}

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.classList.toggle('show', !!text);
  }
}

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = isError ? 'show error' : 'show';
  setTimeout(() => toastEl.className = '', 3000);
}

// ============================================================================
// VOICE MODE
// ============================================================================
// REALTIME VOICE MODE (OpenAI Realtime API)
// ============================================================================

let realtimeWs = null;
let realtimeAudioContext = null;
let realtimeMediaStream = null;
let realtimeScriptProcessor = null;
let realtimePlaybackContext = null;
let audioQueue = [];
let isPlaying = false;

// Waiting/thinking sound state
let thinkingAudio = null;
let thinkingInterval = null;

// Create a simple, gentle thinking sound
function createThinkingSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const sampleRate = ctx.sampleRate;
  const duration = 0.3; // Short 300ms pulse
  const samples = duration * sampleRate;
  const buffer = ctx.createBuffer(1, samples, sampleRate);
  const data = buffer.getChannelData(0);
  
  // Simple soft "ping" sound
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    // Single gentle tone at 880Hz (A5)
    const freq = 880;
    // Quick fade out envelope
    const env = Math.exp(-8 * t / duration);
    // Simple sine wave
    data[i] = env * 0.2 * Math.sin(2 * Math.PI * freq * t);
  }
  
  return { ctx, buffer };
}

// Play the thinking sound in a loop
function playWaitingSound() {
  if (thinkingInterval) return; // Already playing
  
  console.log('🔊 Thinking sound started');
  
  // Play initial sound
  playThinkingPulse();
  
  // Loop every 2 seconds (less frequent, less annoying)
  thinkingInterval = setInterval(playThinkingPulse, 2000);
}

function playThinkingPulse() {
  let ctx = null;
  try {
    const result = createThinkingSound();
    ctx = result.ctx;
    const buffer = result.buffer;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.2, ctx.currentTime); // Gentle volume
    
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    
    // Clean up after playing
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      ctx.close().catch(() => {});
    };
  } catch (e) {
    console.error('Thinking sound error:', e);
    // Close context on error to prevent memory leak
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  }
}

// Stop the thinking sound
function stopWaitingSound() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
    console.log('🔇 Thinking sound stopped');
  }
}

// Voice transcript message helpers
let currentUserMsg = null;
let currentAssistantMsg = null;

function addVoiceMessage(role, text) {
  if (!voiceContent) return null;
  
  const msg = document.createElement('div');
  msg.className = `voice-msg ${role}`;
  msg.textContent = text;
  voiceContent.appendChild(msg);
  
  // Auto-scroll to bottom
  voiceContent.scrollTop = voiceContent.scrollHeight;
  
  return msg;
}

function updateVoiceStatus(text) {
  if (voiceStatus) {
    voiceStatus.textContent = text;
  }
}

// Audio utilities imported from modules/audio.js:
// getRealtimeWsUrl, float32ToBase64PCM16, base64PCM16ToFloat32

// Play audio from queue (PCM16 format - legacy realtime mode)
async function playAudioQueue() {
  if (isPlaying || audioQueue.length === 0) return;
  isPlaying = true;
  
  while (audioQueue.length > 0) {
    const audioData = audioQueue.shift();
    try {
      if (!realtimePlaybackContext) {
        realtimePlaybackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const float32 = base64PCM16ToFloat32(audioData);
      const audioBuffer = realtimePlaybackContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      
      const source = realtimePlaybackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(realtimePlaybackContext.destination);
      
      await new Promise(resolve => {
        source.onended = resolve;
        source.start();
      });
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }
  
  // Small delay before lowering volume gate
  await new Promise(r => setTimeout(r, 100));
  isPlaying = false;
}

// TTS audio buffer for reassembly
let ttsAudioBuffer = [];

// Play audio from queue (TTS API format - hybrid mode)
// OpenAI TTS returns raw PCM at 24000Hz
async function playAudioQueueTTS() {
  if (isPlaying) return;
  
  // Collect all chunks first (TTS chunks need to be played together)
  while (audioQueue.length > 0) {
    ttsAudioBuffer.push(audioQueue.shift());
  }
  
  // If we have accumulated audio, play it
  if (ttsAudioBuffer.length > 0) {
    isPlaying = true;
    let ctx = null;
    
    try {
      // Combine all base64 chunks
      const combinedBase64 = ttsAudioBuffer.join('');
      ttsAudioBuffer = [];
      
      // Convert base64 to raw bytes
      const binary = atob(combinedBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      // OpenAI TTS PCM format: 24000Hz, 16-bit signed little-endian
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7FFF);
      }
      
      // Create audio context and play
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      
      await new Promise(resolve => {
        source.onended = () => {
          ctx.close().catch(() => {});
          resolve();
        };
        source.start();
      });
      
      // CRITICAL: Notify server that playback finished so it can resume listening
      if (hybridWs && hybridWs.readyState === WebSocket.OPEN) {
        hybridWs.send(JSON.stringify({ type: 'audio_playback_ended' }));
        console.log('🔊 Notified server: playback ended');
      }
      
    } catch (e) {
      console.error('TTS playback error:', e);
      // Close context on error to prevent memory leak
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
      // Still notify server even on error
      if (hybridWs && hybridWs.readyState === WebSocket.OPEN) {
        hybridWs.send(JSON.stringify({ type: 'audio_playback_ended' }));
      }
    }
    
    // Small delay before lowering volume gate
    await new Promise(r => setTimeout(r, 100));
    isPlaying = false;
  }
}

// Stop audio playback
function stopAudioPlayback() {
  audioQueue = [];
  isPlaying = false;
  if (realtimePlaybackContext) {
    realtimePlaybackContext.close().catch(() => {});
    realtimePlaybackContext = null;
  }
}

// Wave animation state (CSS-based, JS just tracks analyser for speaking detection)
let waveAnimationFrame = null;
let analyserNode = null;

// Start monitoring audio for speaking detection
function startWaveAnimation() {
  // CSS handles the actual animation, we just detect speaking state
  function checkSpeaking() {
    if (analyserNode) {
      const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const amplitude = (sum / dataArray.length) / 255;
      const isSpeaking = amplitude > 0.05;
      
      // Toggle speaking class on voice-bar
      const voiceBar = document.getElementById('voice-bar');
      if (voiceBar) {
        voiceBar.classList.toggle('speaking', isSpeaking);
      }
    }
    waveAnimationFrame = requestAnimationFrame(checkSpeaking);
  }
  checkSpeaking();
}

// Stop wave animation monitoring
function stopWaveAnimation() {
  if (waveAnimationFrame) {
    cancelAnimationFrame(waveAnimationFrame);
    waveAnimationFrame = null;
  }
  const voiceBar = document.getElementById('voice-bar');
  if (voiceBar) {
    voiceBar.classList.remove('speaking');
  }
}

// Start audio capture and streaming
async function startAudioCapture() {
  try {
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Microphone not supported in this browser', true);
      return false;
    }
    
    realtimeAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    
    // Request microphone access with specific error handling
    try {
      realtimeMediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
    } catch (micError) {
      // Specific error handling for microphone access
      if (micError.name === 'NotAllowedError') {
        toast('Microphone permission denied. Please allow access.', true);
      } else if (micError.name === 'NotFoundError') {
        toast('No microphone found', true);
      } else {
        toast('Microphone error: ' + micError.message, true);
      }
      console.error('Microphone access error:', micError);
      
      // Clean up audio context on failure
      if (realtimeAudioContext) {
        realtimeAudioContext.close().catch(() => {});
        realtimeAudioContext = null;
      }
      return false;
    }
    
    const source = realtimeAudioContext.createMediaStreamSource(realtimeMediaStream);
    
    // Add analyser for wave visualization
    analyserNode = realtimeAudioContext.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);
    
    // Start wave animation
    startWaveAnimation();
    
    // Use ScriptProcessorNode for capturing audio (deprecated but widely supported)
    realtimeScriptProcessor = realtimeAudioContext.createScriptProcessor(4096, 1, 1);
    
    realtimeScriptProcessor.onaudioprocess = (e) => {
      if (realtimeWs && realtimeWs.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate RMS volume
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        
        // While playing: only send if volume is high (user interrupting)
        // Echo is typically ~0.01-0.03 RMS, direct speech is ~0.05-0.2+
        if (isPlaying && rms < 0.04) return;
        
        const base64Audio = float32ToBase64PCM16(inputData);
        realtimeWs.send(JSON.stringify({ type: 'audio', data: base64Audio }));
      }
    };
    
    source.connect(realtimeScriptProcessor);
    realtimeScriptProcessor.connect(realtimeAudioContext.destination);
    
    console.log('🎤 Audio capture started');
    return true;
  } catch (e) {
    console.error('Audio capture error:', e);
    toast('Audio initialization failed: ' + e.message, true);
    // Clean up on any unexpected error
    if (realtimeAudioContext) {
      realtimeAudioContext.close().catch(() => {});
      realtimeAudioContext = null;
    }
    return false;
  }
}

// Stop audio capture
function stopAudioCapture() {
  // Stop wave animation
  stopWaveAnimation();
  analyserNode = null;
  
  if (realtimeScriptProcessor) {
    realtimeScriptProcessor.disconnect();
    realtimeScriptProcessor = null;
  }
  if (realtimeMediaStream) {
    realtimeMediaStream.getTracks().forEach(t => t.stop());
    realtimeMediaStream = null;
  }
  if (realtimeAudioContext) {
    realtimeAudioContext.close().catch(() => {});
    realtimeAudioContext = null;
  }
  console.log('🎤 Audio capture stopped');
}

// Connect to realtime WebSocket
function connectRealtime() {
  const url = getRealtimeWsUrl();
  console.log('🔗 Connecting to realtime:', url);
  
  realtimeWs = new WebSocket(url);
  
  realtimeWs.onopen = async () => {
    realtimeReconnectAttempts = 0;
    console.log('✅ Realtime connected');
    setStatus('');
    
    // Start audio capture
    const started = await startAudioCapture();
    if (!started) {
      stopVoice();
    }
  };
  
  realtimeWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleRealtimeMessage(msg);
    } catch (err) {
      console.error('Failed to parse realtime message:', err);
    }
  };
  
  realtimeWs.onclose = () => {
    console.log('🔌 Realtime disconnected');
    if (isListening && realtimeReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(2000 * Math.pow(2, realtimeReconnectAttempts), 30000);
      realtimeReconnectAttempts++;
      setStatus(`Reconnecting (${realtimeReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(connectRealtime, delay);
    } else if (realtimeReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      toast('Voice connection failed. Please try again.', true);
      stopVoice();
    }
  };
  
  realtimeWs.onerror = (e) => {
    console.error('Realtime WebSocket error:', e);
  };
}

// Handle messages from realtime server (supports both legacy and hybrid modes)
function handleRealtimeMessage(msg) {
  switch (msg.type) {
    case 'ready':
      const modeLabel = msg.mode === 'hybrid' ? 'Hybrid (Claude)' : 'Direct';
      console.log(`🎙️ Realtime session ready - Mode: ${modeLabel}`);
      updateVoiceStatus('Listening');
      break;
      
    case 'user_speaking':
      setVoiceActive(true);
      updateVoiceStatus('Hearing you...');
      // Stop any playing audio when user speaks (interruption)
      stopAudioPlayback();
      stopWaitingSound();
      // Reset for new turn
      currentUserMsg = null;
      currentAssistantMsg = null;
      break;
      
    case 'user_stopped':
      setVoiceActive(false);
      updateVoiceStatus('Processing...');
      // Start thinking sound when user stops speaking
      playWaitingSound();
      break;
      
    case 'interim':
    case 'transcript':
      // User's transcribed speech
      stopWaitingSound();
      if (msg.text && voiceContent) {
        if (!currentUserMsg) {
          // Create user message element
          const userMsg = document.createElement('div');
          userMsg.className = 'voice-msg user';
          userMsg.textContent = msg.text;
          
          // If assistant already started responding, insert BEFORE it
          if (currentAssistantMsg && currentAssistantMsg.parentNode === voiceContent) {
            voiceContent.insertBefore(userMsg, currentAssistantMsg);
          } else {
            voiceContent.appendChild(userMsg);
          }
          currentUserMsg = userMsg;
        } else {
          currentUserMsg.textContent = msg.text;
        }
        voiceContent.scrollTop = voiceContent.scrollHeight;
      }
      playWaitingSound();
      break;
    
    case 'processing':
      // Hybrid mode: processing with Spark Opus
      const engineName = msg.engine || 'Spark Opus';
      const statusMsg = msg.message || `Checking with ${engineName}...`;
      console.log(`🧠 ${statusMsg}`);
      updateVoiceStatus(statusMsg);
      playWaitingSound();
      if (!currentAssistantMsg) {
        currentAssistantMsg = addVoiceMessage('assistant', statusMsg);
        currentAssistantMsg.classList.add('thinking');
      } else {
        currentAssistantMsg.textContent = statusMsg;
        currentAssistantMsg.classList.add('thinking');
      }
      break;
      
    case 'text_delta':
      // AI response streaming text (legacy mode)
      stopWaitingSound();
      updateVoiceStatus('Speaking...');
      if (msg.delta) {
        if (!currentAssistantMsg) {
          currentAssistantMsg = addVoiceMessage('assistant', msg.delta);
        } else {
          currentAssistantMsg.textContent += msg.delta;
          currentAssistantMsg.classList.remove('thinking');
        }
        // Auto-scroll
        if (voiceContent) voiceContent.scrollTop = voiceContent.scrollHeight;
      }
      break;
      
    case 'text':
      // Full AI response text
      stopWaitingSound();
      if (msg.content) {
        if (!currentAssistantMsg) {
          currentAssistantMsg = addVoiceMessage('assistant', msg.content);
        } else {
          currentAssistantMsg.textContent = msg.content;
          currentAssistantMsg.classList.remove('thinking');
        }
      }
      break;
    
    case 'tts_start':
      // Hybrid mode: TTS generation starting
      console.log('🔊 Generating speech...');
      updateVoiceStatus('Speaking...');
      stopWaitingSound();
      break;
    
    case 'audio_chunk':
      // Hybrid mode: audio chunk (TTS API format - needs conversion)
      stopWaitingSound();
      updateVoiceStatus('Speaking...');
      if (msg.data) {
        // Queue audio chunk for playback
        audioQueue.push(msg.data);
        playAudioQueueTTS();
      }
      break;
      
    case 'audio_delta':
      // Audio chunk from AI (legacy mode - PCM16)
      stopWaitingSound();
      updateVoiceStatus('Speaking...');
      if (msg.data) {
        audioQueue.push(msg.data);
        playAudioQueue();
      }
      break;
      
    case 'audio_done':
      console.log('🔊 Audio complete');
      break;
      
    case 'tool_call':
      // Tool is being executed - show feedback and play waiting sound
      console.log('🔧 Tool call:', msg.name);
      const toolName = msg.name?.replace('get_', '').replace('ask_', '').replace('_', ' ') || 'info';
      updateVoiceStatus(`Checking ${toolName}...`);
      // Add a thinking message
      if (!currentAssistantMsg) {
        currentAssistantMsg = addVoiceMessage('assistant', `Checking ${toolName}...`);
        currentAssistantMsg.classList.add('thinking');
      }
      playWaitingSound();
      break;
      
    case 'done':
      // Response complete - reset for next turn (but keep messages!)
      stopWaitingSound();
      currentUserMsg = null;
      currentAssistantMsg = null;
      updateVoiceStatus('Listening');
      break;
      
    case 'error':
      stopWaitingSound();
      console.error('Realtime error:', msg.message);
      toast(msg.message || 'Voice error', true);
      updateVoiceStatus('Error');
      break;
      
    case 'disconnected':
      stopWaitingSound();
      if (isListening) {
        toast('Disconnected', true);
      }
      break;
  }
}

function startVoice() {
  mode = 'voice';
  isListening = true;
  document.body.classList.add('voice-mode');
  bottomEl?.classList.add('voice-active');
  
  // Reset message state
  currentUserMsg = null;
  currentAssistantMsg = null;
  
  // Update status indicator
  updateVoiceStatus('Connecting...');
  setStatus('Connecting...');
  connectRealtime();
}

function stopVoice() {
  isListening = false;
  document.body.classList.remove('voice-mode');
  bottomEl?.classList.remove('voice-active');
  voiceBar?.classList.remove('speaking');
  
  // Reset message state
  currentUserMsg = null;
  currentAssistantMsg = null;
  
  // Stop audio capture
  stopAudioCapture();
  
  // Stop playback
  stopAudioPlayback();
  
  // Close realtime WebSocket
  if (realtimeWs) {
    realtimeWs.send(JSON.stringify({ type: 'stop' }));
    realtimeWs.close();
    realtimeWs = null;
  }
  
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

async function submitText() {
  const text = textInput?.value.trim();
  if (!text || isProcessing) return;
  textInput.value = '';
  textInput.style.height = 'auto'; // Reset height
  sendBtn?.classList.remove('show');
  voiceBtn?.classList.remove('hidden'); // Reset voice button visibility
  await send(text, 'chat');
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
  // Keep notes-mode active to show results
  // User can exit via close button or "New Note"
  bottomEl?.classList.remove('notes-active');
}

// Exit notes mode completely
function exitNotesMode() {
  document.body.classList.remove('notes-mode');
  document.body.classList.remove('notes-results');
  bottomEl?.classList.remove('notes-active');
  resetNotesView();
  mode = 'chat';
}

// Save note to file (notes folder)
async function saveNote() {
  if (!currentNoteData.transcription && !currentNoteData.summary) {
    toast('No note to save', true);
    return;
  }
  
  try {
    const res = await fetch('/api/notes/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcription: currentNoteData.transcription,
        summary: currentNoteData.summary,
        timestamp: Date.now()
      })
    });
    
    const data = await res.json();
    if (res.ok) {
      toast('Note saved ✓');
      exitNotesMode();
    } else {
      toast('Failed to save', true);
    }
  } catch (e) {
    toast('Save failed', true);
  }
}

// Delete current note
function deleteCurrentNote() {
  currentNoteData = { transcription: '', summary: '' };
  if (notesTranscription) notesTranscription.textContent = '';
  if (notesSummary) notesSummary.textContent = '';
  toast('Note deleted');
  exitNotesMode();
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
  
  // Switch to results view with "Transcribing..." status
  document.body.classList.add('notes-results');
  if (notesStatus) {
    notesStatus.textContent = 'Transcribing...';
    notesStatus.style.display = 'block';
  }
  if (notesTranscriptionMsg) notesTranscriptionMsg.style.display = 'none';
  if (notesSummaryMsg) notesSummaryMsg.style.display = 'none';
  currentNoteData = { transcription: '', summary: '' };
  
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
  // Don't add to main chat - results will show in notes view
  ws.send(JSON.stringify({ type: 'voice_note', audio, duration }));
}

// Reset notes view to recording state
function resetNotesView() {
  document.body.classList.remove('notes-results');
  if (notesTimerEl) notesTimerEl.textContent = '0:00';
  if (notesStatus) notesStatus.style.display = 'block';
  if (notesTranscriptionMsg) notesTranscriptionMsg.style.display = 'none';
  if (notesSummaryMsg) notesSummaryMsg.style.display = 'none';
  if (notesTranscription) notesTranscription.textContent = '';
  if (notesSummary) notesSummary.textContent = '';
  currentNoteData = { transcription: '', summary: '' };
}

notesBtn?.addEventListener('click', () => { 
  if (isListening) stopVoice(); 
  resetNotesView();
  startRecording(); 
});
closeNotesBtn?.addEventListener('click', () => {
  // Stop recording and process
  if (mediaRecorder?.state === 'recording') {
    stopRecording();
  }
});
deleteNotesBtn?.addEventListener('click', discardRecording);

// Results action buttons (Save, Delete, Back)
notesSaveBtn?.addEventListener('click', saveNote);
notesDeleteBtn?.addEventListener('click', deleteCurrentNote);
notesBackBtn?.addEventListener('click', exitNotesMode);

// ============================================================================
// WEBSOCKET
// ============================================================================

// Session persistence
let chatSessionId = localStorage.getItem('spark_session_id');
let lastMessageTimestamp = 0; // Track last received message time for catch-up
let isReconnecting = false;

// Catch up on missed messages after reconnection
async function catchUpMissedMessages() {
  if (pageState !== 'chatfeed') return; // Only catch up if viewing chat
  
  try {
    console.log('🔄 Catching up on missed messages since:', lastMessageTimestamp);
    const res = await fetch(`/api/messages/recent?since=${lastMessageTimestamp}`);
    if (!res.ok) return;
    
    const data = await res.json();
    const messages = data.messages || [];
    
    if (messages.length === 0) {
      console.log('🔄 No missed messages');
      return;
    }
    
    console.log(`🔄 Found ${messages.length} missed message(s)`);
    
    for (const msg of messages) {
      // Skip duplicates
      if (isMessageDisplayed(msg.text)) continue;
      
      trackDisplayedMessage(msg.text);
      
      const el = document.createElement('div');
      el.className = `msg ${msg.role === 'user' ? 'user' : 'bot'}`;
      if (msg.role === 'user') {
        el.textContent = msg.text;
      } else {
        el.innerHTML = formatMessage(msg.text);
      }
      messagesEl.appendChild(el);
      
      // Update last timestamp
      if (msg.timestamp > lastMessageTimestamp) {
        lastMessageTimestamp = msg.timestamp;
      }
    }
    
    scrollToBottomIfNeeded();
  } catch (e) {
    console.error('Catch-up failed:', e);
  }
}

function connect() {
  // Build URL with session ID for reconnection
  let wsUrl = CONFIG.wsUrl;
  if (chatSessionId) {
    wsUrl += (wsUrl.includes('?') ? '&' : '?') + `session=${chatSessionId}`;
  }
  
  console.log('🔌 Connecting to:', wsUrl);
  updateSparkStatus('connecting');
  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log('✅ Chat WebSocket connected');
      updateSparkStatus('connected');
      
      // Catch up on any missed messages during disconnection
      if (isReconnecting) {
        catchUpMissedMessages();
      }
      isReconnecting = false;
    };
    ws.onclose = (e) => {
      console.log('🔌 Chat WebSocket closed:', e.code, e.reason);
      updateSparkStatus('disconnected');
      isReconnecting = true; // Mark that next connect is a reconnection
      setTimeout(connect, 2000);
    };
    ws.onerror = (e) => {
      console.error('❌ Chat WebSocket error:', e);
      updateSparkStatus('disconnected');
    };
    
    // Reconnect when page becomes visible (fixes mobile Safari background disconnect)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('👁️ Page visible, checking WebSocket...');
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('🔄 WebSocket stale, reconnecting...');
          connect();
        } else {
          // Connection looks good, but catch up on any missed messages
          catchUpMissedMessages();
        }
      }
    });
    ws.onmessage = (e) => { 
      try { 
        const data = JSON.parse(e.data);
        console.log('📨 WS received:', data.type, data.content?.slice?.(0, 50) || '');
        handle(data); 
      } catch (err) {
        console.error('❌ WS message error:', err, e.data?.slice?.(0, 100));
      } 
    };
  } catch (e) {
    console.error('❌ Failed to create WebSocket:', e);
    updateSparkStatus('disconnected');
  }
}

async function send(text, sendMode) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }
  
  // If on intro page, ensure history is loaded before showing chat feed
  // This prevents the "blank space" issue where user's message appears alone
  if (pageState === 'intro') {
    // Wait for history to load (should already be loaded, but ensure it)
    if (historyLoadPromise) {
      try {
        await historyLoadPromise;
        console.log('📜 History ready, preloaded:', preloadedHistory?.length || 0, 'messages');
      } catch (e) {
        console.log('History load failed, continuing anyway');
      }
    }
    
    // Render history BEFORE switching to chat feed and adding user message
    // Skip this if we're in a mode (mode has its own history)
    if (!currentSparkMode && preloadedHistory && preloadedHistory.length > 0 && !historyRendered) {
      console.log('📜 Rendering history before first message');
      renderPreloadedHistory();
    }
    
    // Now switch to chat feed (history already rendered)
    showChatFeedPage({ skipHistory: true });
  }
  
  isProcessing = true;
  
  // Add user message (history should already be rendered above if on intro)
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  // Track message to prevent duplicate from sync
  trackDisplayedMessage(text);
  
  showThinking();
  
  // Route to mode session or main session
  if (currentSparkMode) {
    // Send to mode-specific session
    console.log(`📦 Sending to ${currentSparkMode} mode session`);
    ws.send(JSON.stringify({ type: 'mode_message', sparkMode: currentSparkMode, text }));
  } else {
    // Send to main session
    ws.send(JSON.stringify({ type: 'transcript', text, mode: sendMode }));
  }
}

function handle(data) {
  switch (data.type) {
    case 'ready': 
      // Store session ID for reconnection (local only, unified session handled server-side)
      if (data.sessionId) {
        chatSessionId = data.sessionId;
        localStorage.setItem('spark_session_id', data.sessionId);
        console.log('📋 Session:', data.sessionId);
      }
      // Check if there's a pending request
      if (data.pending) {
        console.log('⏳ Pending request detected - showing loading');
        showThinking();
      }
      console.log('✅ Chat ready');
      break;
    
    case 'sync':
      // Real-time sync: new message from WhatsApp or other surface
      console.log('📡 Sync message:', data.message?.source, data.message?.text?.slice(0, 50));
      refreshHistoryCache(); // Keep history cache up to date
      if (data.message && data.message.text) {
        // Track timestamp for catch-up on reconnect
        if (data.message.timestamp && data.message.timestamp > lastMessageTimestamp) {
          lastMessageTimestamp = data.message.timestamp;
        }
        
        // Check for duplicates using hash-based tracking
        if (isMessageDisplayed(data.message.text)) {
          console.log('📡 Skipping duplicate sync message (hash match)');
          break;
        }
        
        // Show on chat feed if we're viewing it
        if (pageState === 'chatfeed') {
          // Track and display
          trackDisplayedMessage(data.message.text);
          
          const el = document.createElement('div');
          el.className = `msg ${data.message.role === 'user' ? 'user' : 'bot'}`;
          if (data.message.role === 'user') {
            el.textContent = data.message.text;
          } else {
            el.innerHTML = formatMessage(data.message.text);
          }
          // Add source indicator for WhatsApp messages
          if (data.message.source === 'whatsapp') {
            el.title = 'From WhatsApp';
          }
          messagesEl.appendChild(el);
          // Auto-scroll only if near bottom
          scrollToBottomIfNeeded();
          
          // Remove thinking indicator if this is a bot response
          if (data.message.role === 'bot') {
            removeThinking();
          }
        } else if (pageState === 'intro') {
          // Show toast notification on intro page for new messages
          if (data.message.role === 'bot') {
            toast('New message from Spark');
          }
        }
      }
      break;
    case 'thinking':
      // Server acknowledged request and is processing
      console.log('🤔 Server thinking...');
      // Route to session page if active
      if (currentSessionMode && sessionPage.classList.contains('show')) {
        showSessionThinking();
      } else {
        showThinking();
      }
      break;
    case 'progress':
      // Real-time progress from transcript watcher (tool calls)
      console.log('📊 Progress:', data.status);
      if (currentSessionMode && sessionPage.classList.contains('show')) {
        updateSessionThinking(data.status);
      } else {
        updateThinking(data.status);
      }
      break;
    case 'text':
      console.log('✅ Text message received:', data.content?.slice?.(0, 100));
      // Route to notes view if in notes mode
      if (document.body.classList.contains('notes-mode') && notesSummary) {
        if (data.content) {
          // Hide status, show summary message
          if (notesStatus) notesStatus.style.display = 'none';
          notesSummary.innerHTML = formatMessage(data.content);
          currentNoteData.summary = data.content;
          if (notesSummaryMsg) notesSummaryMsg.style.display = 'block';
        }
      }
      // Route to session page if active
      else if (currentSessionMode && sessionPage.classList.contains('show')) {
        removeSessionThinking();
        if (data.content) {
          addSessionMessage('bot', data.content);
        }
      } else {
        removeThinking();
        setStatus('');
        const lastSys = messagesEl?.querySelector('.msg.system:last-child');
        if (lastSys?.textContent === 'Transcribing...') lastSys.remove();
        if (data.content) {
          addMsg(data.content, 'bot');
          console.log('✅ Bot message added to DOM');
        } else {
          console.warn('⚠️ Empty text content received');
        }
      }
      break;
    case 'transcription':
      // Check if we're in notes mode - show in notes view
      if (document.body.classList.contains('notes-mode') && notesTranscription) {
        // Show transcription message, update status to "Summarizing..."
        notesTranscription.textContent = data.text;
        currentNoteData.transcription = data.text;
        if (notesTranscriptionMsg) notesTranscriptionMsg.style.display = 'block';
        if (notesStatus) notesStatus.textContent = 'Summarizing...';
      } else {
        const transSys = messagesEl?.querySelector('.msg.system:last-child');
        if (transSys?.textContent === 'Transcribing...') transSys.remove();
        addMsg('📝 ' + data.text, 'bot');
      }
      break;
    case 'audio': playAudio(data.data); break;
    case 'done':
      isProcessing = false;
      sessionPageProcessing = false;
      setStatus('');
      checkActiveSubagentSessions(); // Refresh mode button states (also saves session state + updates bar)
      saveSessionState(); // Persist session state (sessions may have completed)
      refreshHistoryCache(); // Keep history cache up to date
      if (mode === 'voice' && !isListening) startVoice();
      break;
    case 'error':
      // Route to session page if active
      if (currentSessionMode && sessionPage.classList.contains('show')) {
        removeSessionThinking();
        addSessionMessage('bot', `Error: ${data.message || 'Something went wrong'}`);
        sessionPageProcessing = false;
      } else {
        removeThinking();
      }
      toast(data.message || 'Error', true);
      isProcessing = false;
      setStatus('');
      break;
    
    case 'mode_history':
      // Received history from a mode session
      console.log(`📦 Mode history received for ${data.mode}:`, data.messages?.length || 0, 'messages');
      if (data.mode && data.messages) {
        modeHistory[data.mode] = data.messages;
        // If we're currently in this mode, render the history
        if (currentSparkMode === data.mode) {
          renderModeHistory(data.mode);
        }
      }
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
// MESSAGE CONTEXT MENU (long-press)
// ============================================================================

const msgMenu = document.getElementById('msg-menu');
const menuCopy = document.getElementById('menu-copy');
const menuEdit = document.getElementById('menu-edit');
const menuDelete = document.getElementById('menu-delete');

let selectedMsg = null;
let longPressTimer = null;

function showMsgMenu(msgEl, x, y) {
  selectedMsg = msgEl;
  msgEl.classList.add('selected');
  
  // Position menu near the touch point
  const menuWidth = 148; // 3 buttons * ~44px + padding
  const menuHeight = 60;
  
  // Keep menu on screen
  const finalX = Math.min(x, window.innerWidth - menuWidth - 10);
  const finalY = Math.max(y - menuHeight - 10, 10);
  
  msgMenu.style.left = finalX + 'px';
  msgMenu.style.top = finalY + 'px';
  msgMenu.classList.add('show');
}

function hideMsgMenu() {
  msgMenu?.classList.remove('show');
  selectedMsg?.classList.remove('selected');
  selectedMsg = null;
}

// Long-press detection on messages
messagesEl?.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg');
  if (!msgEl || msgEl.classList.contains('system') || msgEl.classList.contains('thinking')) return;
  
  const touch = e.touches[0];
  longPressTimer = setTimeout(() => {
    e.preventDefault();
    showMsgMenu(msgEl, touch.clientX, touch.clientY);
  }, 500);
}, { passive: false });

messagesEl?.addEventListener('touchend', () => {
  clearTimeout(longPressTimer);
});

messagesEl?.addEventListener('touchmove', () => {
  clearTimeout(longPressTimer);
});

// Hide menu on tap elsewhere
document.addEventListener('touchstart', (e) => {
  if (!e.target.closest('#msg-menu') && !e.target.closest('.msg')) {
    hideMsgMenu();
  }
});

// Copy action
menuCopy?.addEventListener('click', () => {
  if (!selectedMsg) return;
  const text = selectedMsg.textContent || selectedMsg.innerText;
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied!');
  }).catch(() => {
    toast('Failed to copy', true);
  });
  hideMsgMenu();
});

// Edit action (puts text in input) - routes to session input if session page is active
menuEdit?.addEventListener('click', () => {
  if (!selectedMsg) return;
  const text = selectedMsg.textContent || selectedMsg.innerText;

  // Check if session page is active
  if (currentSessionMode && sessionPage?.classList.contains('show')) {
    if (sessionInput) {
      sessionInput.value = text;
      sessionInput.style.height = 'auto';
      sessionInput.style.height = Math.min(sessionInput.scrollHeight, 120) + 'px';
      sessionSendBtn?.classList.add('active');
      sessionInput.focus();
    }
  } else {
    if (textInput) {
      textInput.value = text;
      textInput.style.height = 'auto';
      textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
      sendBtn?.classList.add('show');
      textInput.focus();
    }
  }
  hideMsgMenu();
});

// Delete action
menuDelete?.addEventListener('click', () => {
  if (!selectedMsg) return;
  selectedMsg.remove();
  toast('Deleted');
  hideMsgMenu();
});

// ============================================================================
// INIT
// ============================================================================

// Initialize WebSocket connection
connect();

// Pre-load chat history in background (instant render when user opens chat)
loadHistoryInBackground();

// ============================================================================
// PREVENT DOUBLE-TAP ZOOM (iOS Safari fix)
// ============================================================================

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, { passive: false });

// ============================================================================
// PC STATUS INDICATOR
// ============================================================================

const pcStatusEl = document.getElementById('pc-status');

async function checkPcStatus() {
  try {
    const response = await fetch('/api/nodes/status');
    const data = await response.json();
    
    if (pcStatusEl) {
      pcStatusEl.classList.toggle('connected', data.connected);
      pcStatusEl.title = data.connected 
        ? `${data.nodeName || 'PC'} connected` 
        : 'PC disconnected';
    }
  } catch (e) {
    console.error('PC status check failed:', e);
    if (pcStatusEl) {
      pcStatusEl.classList.remove('connected');
    }
  }
}

// Check immediately and then every 30 seconds
checkPcStatus();
let statusInterval = setInterval(checkPcStatus, 30000);

// Pause PC status polling when page is hidden (save battery)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  } else {
    // Resume when visible
    if (!statusInterval) {
      checkPcStatus();
      statusInterval = setInterval(checkPcStatus, 30000);
    }
  }
});

// Click handler for WoL
let fastPoll = null; // Track fast polling interval to prevent stacking

pcStatusEl?.addEventListener('click', async () => {
  // Clear any existing fast poll first to prevent stacking
  if (fastPoll) {
    clearInterval(fastPoll);
    fastPoll = null;
  }
  
  // Only wake if disconnected
  if (pcStatusEl.classList.contains('connected')) {
    toast('PC is already connected');
    return;
  }
  
  toast('Waking PC...');
  
  try {
    const response = await fetch('/api/nodes/wake', { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      toast('Wake signal sent! Waiting for PC...');
      
      // Poll more frequently for 2 minutes
      clearInterval(statusInterval);
      let attempts = 0;
      fastPoll = setInterval(async () => {
        attempts++;
        await checkPcStatus();
        
        if (pcStatusEl.classList.contains('connected')) {
          toast('PC connected! ✅');
          clearInterval(fastPoll);
          statusInterval = setInterval(checkPcStatus, 30000);
        } else if (attempts >= 24) { // 2 minutes (24 * 5s)
          toast('PC did not respond', true);
          clearInterval(fastPoll);
          statusInterval = setInterval(checkPcStatus, 30000);
        }
      }, 5000);
    } else {
      toast('Wake failed: ' + (data.error || 'Unknown error'), true);
    }
  } catch (e) {
    toast('Wake request failed', true);
    console.error('WoL error:', e);
  }
});

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

// Articulations mode button handler - opens articulate session page
document.getElementById('articulations-btn')?.addEventListener('click', async () => {
  showSessionPage('articulate');
});

// ============================================================================
// ACTIVE SUBAGENT SESSION TRACKING
// ============================================================================

// Track active subagent sessions by mode
const activeSubagentSessions = {
  'spark-dev-mode': null,
  'spark-research-mode': null,
  'spark-plan-mode': null,
  'spark-videogen-mode': null,
  'spark-articulate-mode': null,
  'spark-dailyreports-mode': null
};

// Map button IDs to session labels
const buttonToSessionLabel = {
  'devteam-btn': 'spark-dev-mode',
  'researcher-btn': 'spark-research-mode',
  'plan-btn': 'spark-plan-mode',
  'videogen-btn': 'spark-videogen-mode',
  'articulations-btn': 'spark-articulate-mode',
  'todays-reports-btn': 'spark-dailyreports-mode'
};

// Map mode names to session labels
const modeToSessionLabel = {
  'dev': 'spark-dev-mode',
  'research': 'spark-research-mode',
  'plan': 'spark-plan-mode',
  'videogen': 'spark-videogen-mode',
  'articulate': 'spark-articulate-mode',
  'dailyreports': 'spark-dailyreports-mode'
};

// Check for active subagent sessions (uses mode-sessions JSONL files, not OpenClaw sessions)
async function checkActiveSubagentSessions() {
  try {
    // Fetch mode sessions (JSONL-based, from mode-sessions.js)
    const modeRes = await fetch('/api/mode-sessions');
    const modeData = await modeRes.json();
    const modeSessions = modeData.sessions || {};
    
    // Reset all
    activeSubagentSessions['spark-dev-mode'] = null;
    activeSubagentSessions['spark-research-mode'] = null;
    activeSubagentSessions['spark-plan-mode'] = null;
    activeSubagentSessions['spark-videogen-mode'] = null;
    
    // Map mode-sessions response to activeSubagentSessions
    const modeMap = {
      'dev': 'spark-dev-mode',
      'research': 'spark-research-mode',
      'plan': 'spark-plan-mode',
      'videogen': 'spark-videogen-mode'
    };
    
    for (const [mode, sessionData] of Object.entries(modeSessions)) {
      const label = modeMap[mode];
      if (label && sessionData.active) {
        // Session is actively being used (updated in last 5 min) — mark as active
        activeSubagentSessions[label] = {
          key: sessionData.sessionId,
          label: sessionData.label,
          active: sessionData.active,
          exists: sessionData.exists,
          lastUpdated: sessionData.lastUpdated
        };
      }
    }
    
    updateSubagentButtonStates();
    saveSessionState();
  } catch (e) {
    console.error('Failed to check active sessions:', e);
  }
}

// Update button visual states based on active sessions
function updateSubagentButtonStates() {
  for (const [btnId, label] of Object.entries(buttonToSessionLabel)) {
    const btn = document.getElementById(btnId);
    if (btn) {
      const isActive = activeSubagentSessions[label] !== null;
      btn.classList.toggle('session-active', isActive);
      
      // Update subtitle to show status
      const subEl = btn.querySelector('.shortcut-sub');
      if (subEl) {
        if (isActive) {
          const originalText = subEl.dataset.originalText || subEl.textContent;
          subEl.dataset.originalText = originalText;
          subEl.textContent = '● Session active';
        } else if (subEl.dataset.originalText) {
          subEl.textContent = subEl.dataset.originalText;
        }
      }
    }
  }
}

// Get active session for a mode
function getActiveSession(mode) {
  const label = modeToSessionLabel[mode] || mode;
  return activeSubagentSessions[label];
}

// ============================================================================
// SESSION PAGE - Full-screen mode session interface
// ============================================================================

const sessionPage = document.getElementById('session-page');
const sessionMessagesEl = document.getElementById('session-messages');
const sessionInput = document.getElementById('session-input');
const sessionSendBtn = document.getElementById('session-send-btn');
const sessionBackBtn = document.getElementById('session-back-btn');

let currentSessionMode = null; // 'dev', 'research', 'plan', 'video'
let currentSessionId = null;   // The specific session ID from the index
let sessionPageProcessing = false;

// Mode configurations for session page
const SESSION_MODE_CONFIG = {
  dev: {
    name: 'Dev Mode',
    icon: '👨‍💻',
    sessionKey: 'spark-dev-mode',
    placeholder: 'Describe what you want to build or fix...',
    emptyTitle: 'Dev Mode',
    emptyDesc: 'Start a coding session. Describe what you want to build or fix.'
  },
  research: {
    name: 'Research Mode',
    icon: '🔬',
    sessionKey: 'spark-research-mode',
    placeholder: 'What would you like to research?',
    emptyTitle: 'Research Mode',
    emptyDesc: 'Start a deep research session. Ask about any topic.'
  },
  plan: {
    name: 'Plan Mode',
    icon: '📋',
    sessionKey: 'spark-plan-mode',
    placeholder: 'What do you want to plan?',
    emptyTitle: 'Plan Mode',
    emptyDesc: 'Start planning. Describe your project or feature.'
  },
  videogen: {
    name: 'Video Gen',
    icon: '🎬',
    sessionKey: 'spark-videogen-mode',
    placeholder: 'Describe the video you want to create...',
    emptyTitle: 'Video Gen',
    emptyDesc: 'Generate AI videos. Describe what you want to create.'
  },
  articulate: {
    name: 'Articulate',
    icon: '💬',
    sessionKey: 'spark-articulate-mode',
    placeholder: 'Type text to refine...',
    emptyTitle: 'Articulate',
    emptyDesc: 'Refine and improve your text. Paste content to polish.'
  },
  dailyreports: {
    name: 'Daily Reports',
    icon: '📊',
    sessionKey: 'spark-dailyreports-mode',
    placeholder: 'Ask about your portfolio or generate a briefing...',
    emptyTitle: 'Daily Reports',
    emptyDesc: 'View portfolio updates and generate market briefings.'
  }
};

// ============================================================================
// SESSION PERSISTENCE via localStorage
// ============================================================================

// Save session state when it changes
function saveSessionState() {
  const state = {};
  for (const [mode, config] of Object.entries(SESSION_MODE_CONFIG)) {
    const label = config.sessionKey;
    if (activeSubagentSessions[label]) {
      state[mode] = {
        label,
        lastActive: Date.now(),
        hasHistory: true
      };
    }
  }
  localStorage.setItem('sparkgpt-active-sessions', JSON.stringify(state));
}

// Restore session state on page load
function restoreSessionState() {
  try {
    const stored = JSON.parse(localStorage.getItem('sparkgpt-active-sessions') || '{}');
    // Remove stale entries (older than 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [mode, data] of Object.entries(stored)) {
      if (data.lastActive < cutoff) {
        delete stored[mode];
      }
    }
    localStorage.setItem('sparkgpt-active-sessions', JSON.stringify(stored));
    return stored;
  } catch {
    return {};
  }
}

// (Active Sessions Bar removed — mode buttons are now session-aware)

// ============================================================================
// SESSION STATUS POLLING on session page
// ============================================================================

let sessionStatusInterval = null;

// Start polling when session page opens (refreshes mode button states)
function startSessionStatusPolling() {
  stopSessionStatusPolling(); // Clear any existing
  
  sessionStatusInterval = setInterval(async () => {
    if (!currentSessionMode) return;
    // Just refresh the mode button states
    checkActiveSubagentSessions();
  }, 15000); // Every 15 seconds
}

function stopSessionStatusPolling() {
  if (sessionStatusInterval) {
    clearInterval(sessionStatusInterval);
    sessionStatusInterval = null;
  }
}

// Show session page for a specific mode
async function showSessionPage(mode, specificSessionId) {
  const config = SESSION_MODE_CONFIG[mode];
  if (!config) {
    console.error('Unknown session mode:', mode);
    return;
  }
  
  currentSessionMode = mode;
  
  // Update input placeholder
  sessionInput.placeholder = config.placeholder;
  
  // Clear messages
  sessionMessagesEl.innerHTML = '';
  
  // Resolve session ID — use specific one if provided, else fetch latest
  if (specificSessionId) {
    currentSessionId = specificSessionId;
  } else {
    try {
      const res = await fetch(`/api/modes/${mode}/sessions`);
      const data = await res.json();
      if (data.sessions && data.sessions.length > 0) {
        currentSessionId = data.sessions[0].id; // Already sorted by createdAt desc
      } else {
        // Create a new session
        const createRes = await fetch(`/api/modes/${mode}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const newSession = await createRes.json();
        currentSessionId = newSession.id;
      }
    } catch (e) {
      console.error('Failed to resolve session ID:', e);
      currentSessionId = null;
    }
  }
  
  // Update header title
  updateSessionHeaderTitle(mode);
  
  // Show session page
  sessionPage.classList.add('show');
  
  // Load session history
  await loadSessionHistory(mode, config);
  
  // Start status polling
  startSessionStatusPolling();
  
  // Focus input
  setTimeout(() => sessionInput.focus(), 100);
}

// Update session header title
function updateSessionHeaderTitle(mode) {
  const headerTitle = document.getElementById('session-header-title');
  if (headerTitle) {
    const config = SESSION_MODE_CONFIG[mode];
    headerTitle.textContent = config ? `${config.icon} ${config.name}` : mode;
  }
}

// Hide session page
function hideSessionPage() {
  sessionPage.classList.remove('show');
  currentSessionMode = null;
  currentSessionId = null;
  sessionPageProcessing = false;
  stopSessionStatusPolling();
  // Also close history panel if open
  document.getElementById('session-history-panel')?.classList.remove('show');
}

// Load session history from API
async function loadSessionHistory(mode, config) {
  try {
    // Use specific session endpoint if we have a sessionId, otherwise fallback to mode history
    let url;
    if (currentSessionId) {
      url = `/api/modes/${mode}/sessions/${currentSessionId}/history?limit=50`;
    } else {
      url = `/api/modes/${mode}/history?limit=50`;
    }
    const res = await fetch(url);
    const data = await res.json();
    const messages = data.messages || [];
    
    if (messages.length === 0) {
      // Show empty state
      sessionMessagesEl.innerHTML = `
        <div class="session-empty-state">
          <div class="session-empty-icon">${config.icon}</div>
          <div class="session-empty-title">${config.emptyTitle}</div>
          <div class="session-empty-desc">${config.emptyDesc}</div>
        </div>
      `;
    } else {
      // Render messages
      for (const msg of messages) {
        const text = extractMessageText(msg);
        if (text) {
          addSessionMessage(msg.role === 'assistant' ? 'bot' : 'user', text, msg.timestamp);
        }
      }
      // Scroll to bottom
      sessionMessagesEl.scrollTop = sessionMessagesEl.scrollHeight;
    }
  } catch (e) {
    console.error('Failed to load session history:', e);
    sessionMessagesEl.innerHTML = `
      <div class="session-empty-state">
        <div class="session-empty-icon">${config.icon}</div>
        <div class="session-empty-title">${config.emptyTitle}</div>
        <div class="session-empty-desc">${config.emptyDesc}</div>
      </div>
    `;
  }
}

// extractMessageText (used here) imported from modules/ui.js

// Add message to session page (matches main chat styling)
function addSessionMessage(type, text, timestamp) {
  // Remove empty state if present
  const emptyState = sessionMessagesEl.querySelector('.session-empty-state');
  if (emptyState) emptyState.remove();

  // Check if user is near bottom before adding message (for smart scroll)
  const wasNearBottom = isNearBottom(sessionMessagesEl);

  const el = document.createElement('div');
  el.className = `msg ${type}`;

  if (type === 'bot') {
    el.innerHTML = formatMessage(text);
  } else {
    el.textContent = text;
  }

  // Add timestamp
  if (timestamp) {
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatRelativeTime(timestamp);
    el.appendChild(timeEl);
  }

  sessionMessagesEl.appendChild(el);

  // Smart scroll: only auto-scroll if user was near bottom or message is from user
  if (type === 'user' || wasNearBottom) {
    sessionMessagesEl.scrollTop = sessionMessagesEl.scrollHeight;
  }

  return el;
}

// Format relative time for session messages
function formatRelativeTime(ts) {
  if (!ts) return '';
  const now = Date.now();
  const time = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(time)) return '';
  
  const diffSec = Math.floor((now - time) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  // Format as date
  const d = new Date(time);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Show thinking indicator in session
function showSessionThinking() {
  // Remove existing thinking
  removeSessionThinking();
  
  const el = document.createElement('div');
  el.className = 'msg bot thinking';
  el.id = 'session-thinking-indicator';
  el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  sessionMessagesEl.appendChild(el);
  sessionMessagesEl.scrollTop = sessionMessagesEl.scrollHeight;
}

// Remove thinking indicator from session
function removeSessionThinking() {
  document.getElementById('session-thinking-indicator')?.remove();
}

// Update session thinking indicator with progress text
function updateSessionThinking(statusText) {
  const el = document.getElementById('session-thinking-indicator');
  if (!el) {
    showSessionThinking();
    return updateSessionThinking(statusText);
  }
  el.innerHTML = `
    <div class="thinking-content">
      <span class="thinking-status">${escapeHtml(statusText)}</span>
      <div class="thinking-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  if (sessionMessagesEl) sessionMessagesEl.scrollTop = sessionMessagesEl.scrollHeight;
}

// Send message in session page
async function sendSessionMessage() {
  const text = sessionInput.value.trim();
  if (!text && !sessionPendingAttachment) return;
  if (sessionPageProcessing) return;

  let messageText = text;
  let imageData = null;

  // Handle attachment
  if (sessionPendingAttachment) {
    const file = sessionPendingAttachment;
    try {
      if (file.type.startsWith('image/')) {
        // Read image as base64
        imageData = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
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
    sessionPendingAttachment = null;
    sessionAttachmentPreview?.classList.remove('show');
  }

  if (!messageText) return;

  sessionInput.value = '';
  sessionInput.style.height = 'auto';
  sessionSendBtn.classList.remove('active');
  sessionSendBtn.classList.remove('show');

  sessionPageProcessing = true;

  // Add user message (with image indicator if applicable)
  addSessionMessage('user', imageData ? messageText + ' 📷' : messageText);

  // Show thinking
  showSessionThinking();

  // Send via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = {
      type: 'mode_message',
      sparkMode: currentSessionMode,
      sessionId: currentSessionId,
      text: messageText
    };
    if (imageData) payload.image = imageData;
    ws.send(JSON.stringify(payload));
  } else {
    removeSessionThinking();
    addSessionMessage('bot', 'Not connected. Please try again.');
    sessionPageProcessing = false;
  }
}

// Session input handlers
sessionInput?.addEventListener('input', () => {
  const hasText = sessionInput.value.trim().length > 0 || sessionPendingAttachment;
  sessionSendBtn?.classList.toggle('show', hasText);
  sessionSendBtn?.classList.toggle('active', hasText); // Keep legacy class for compatibility

  // Auto-resize
  sessionInput.style.height = 'auto';
  sessionInput.style.height = Math.min(sessionInput.scrollHeight, 120) + 'px';
});

sessionInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendSessionMessage();
  }
});

sessionSendBtn?.addEventListener('click', sendSessionMessage);

sessionBackBtn?.addEventListener('click', hideSessionPage);

// New Session button — creates a new session via API
document.getElementById('session-new-btn')?.addEventListener('click', async () => {
  if (!currentSessionMode) return;
  // Confirm if there's existing content
  const hasMessages = sessionMessagesEl.querySelectorAll('.msg').length > 0;
  if (hasMessages && !confirm('Start a new session? Current session will be saved.')) return;
  
  try {
    // Create new session via API
    const res = await fetch(`/api/modes/${currentSessionMode}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const newSession = await res.json();
    currentSessionId = newSession.id;
    console.log('Created new session:', newSession.id);
  } catch (e) {
    console.error('Failed to create new session:', e);
  }
  
  // Clear the session messages display
  sessionMessagesEl.innerHTML = '';
  
  // Show empty state for the current mode
  const config = SESSION_MODE_CONFIG[currentSessionMode];
  if (config) {
    sessionMessagesEl.innerHTML = `
      <div class="session-empty-state">
        <div class="session-empty-icon">${config.icon}</div>
        <div class="session-empty-title">${config.emptyTitle}</div>
        <div class="session-empty-desc">${config.emptyDesc}</div>
      </div>
    `;
  }
  
  // Focus input
  sessionInput?.focus();
});

// ============================================================================
// SESSION FILE UPLOAD
// ============================================================================

const sessionUploadBtn = document.getElementById('session-upload-btn');
const sessionFileInput = document.getElementById('session-file-input');
const sessionAttachmentPreview = document.getElementById('session-attachment-preview');
const sessionAttachmentIcon = document.getElementById('session-attachment-icon');
const sessionAttachmentName = document.getElementById('session-attachment-name');
const sessionAttachmentSize = document.getElementById('session-attachment-size');
const sessionRemoveAttachmentBtn = document.getElementById('session-remove-attachment-btn');

let sessionPendingAttachment = null;

sessionUploadBtn?.addEventListener('click', () => sessionFileInput?.click());

sessionFileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  // Validate file size
  if (file.size > CONFIG.maxFileSize) {
    toast(`File too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(CONFIG.maxFileSize)}.`, true);
    sessionFileInput.value = '';
    return;
  }

  // Store the file
  sessionPendingAttachment = file;

  // Update preview
  if (sessionAttachmentName) sessionAttachmentName.textContent = file.name;
  if (sessionAttachmentSize) sessionAttachmentSize.textContent = formatFileSize(file.size);

  // Update icon based on type
  if (sessionAttachmentIcon) {
    if (file.type.startsWith('image/')) {
      sessionAttachmentIcon.classList.add('image');
      sessionAttachmentIcon.innerHTML = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
    } else {
      sessionAttachmentIcon.classList.remove('image');
      sessionAttachmentIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
    }
  }

  // Show preview
  sessionAttachmentPreview?.classList.add('show');

  // Show send button
  sessionSendBtn?.classList.add('show');

  // Focus text input
  sessionInput?.focus();

  sessionFileInput.value = '';
});

sessionRemoveAttachmentBtn?.addEventListener('click', () => {
  sessionPendingAttachment = null;
  sessionAttachmentPreview?.classList.remove('show');
  if (!sessionInput?.value.trim()) {
    sessionSendBtn?.classList.remove('show');
  }
});

// ============================================================================
// SESSION HISTORY PANEL
// ============================================================================

const sessionHistoryPanel = document.getElementById('session-history-panel');
const sessionHistoryList = document.getElementById('session-history-list');

// Open history panel
document.getElementById('session-history-btn')?.addEventListener('click', async () => {
  if (!currentSessionMode) return;
  
  sessionHistoryPanel?.classList.add('show');
  sessionHistoryList.innerHTML = '<div class="session-history-empty">Loading...</div>';
  
  try {
    const res = await fetch(`/api/modes/${currentSessionMode}/sessions`);
    const data = await res.json();
    const sessions = data.sessions || [];
    
    if (sessions.length === 0) {
      sessionHistoryList.innerHTML = '<div class="session-history-empty">No sessions yet</div>';
      return;
    }
    
    sessionHistoryList.innerHTML = '';
    for (const s of sessions) {
      const entry = document.createElement('div');
      entry.className = 'session-history-entry';
      if (s.id === currentSessionId) entry.classList.add('active');
      
      const title = s.title || 'Untitled';
      const timeStr = formatRelativeTime(s.createdAt);
      const countStr = s.messageCount ? `${s.messageCount} msgs` : '';
      
      entry.innerHTML = `
        <div class="session-history-entry-title">${escapeHtml(title)}</div>
        <div class="session-history-entry-meta">
          <span>${timeStr}</span>
          ${countStr ? `<span>· ${countStr}</span>` : ''}
        </div>
      `;
      
      entry.addEventListener('click', () => {
        sessionHistoryPanel?.classList.remove('show');
        // Reload with this session
        currentSessionId = s.id;
        sessionMessagesEl.innerHTML = '';
        const config = SESSION_MODE_CONFIG[currentSessionMode];
        if (config) loadSessionHistory(currentSessionMode, config);
      });
      
      sessionHistoryList.appendChild(entry);
    }
  } catch (e) {
    console.error('Failed to load sessions:', e);
    sessionHistoryList.innerHTML = '<div class="session-history-empty">Failed to load sessions</div>';
  }
});

// Close history panel
document.getElementById('session-history-close')?.addEventListener('click', () => {
  sessionHistoryPanel?.classList.remove('show');
});

// ============================================================================
// SESSION MESSAGES — long-press context menu support
// ============================================================================

sessionMessagesEl?.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg');
  if (!msgEl || msgEl.classList.contains('system') || msgEl.classList.contains('thinking')) return;
  
  const touch = e.touches[0];
  longPressTimer = setTimeout(() => {
    e.preventDefault();
    showMsgMenu(msgEl, touch.clientX, touch.clientY);
  }, 500);
}, { passive: false });

sessionMessagesEl?.addEventListener('touchend', () => {
  clearTimeout(longPressTimer);
});

sessionMessagesEl?.addEventListener('touchmove', () => {
  clearTimeout(longPressTimer);
});

// Restore session state from localStorage on load
restoreSessionState();

// Check on load and every 10 seconds
checkActiveSubagentSessions();
let subagentPollInterval = setInterval(checkActiveSubagentSessions, 10000);

// (Active sessions bar removed — mode buttons handle session state directly)

// Pause polling when page is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (subagentPollInterval) {
      clearInterval(subagentPollInterval);
      subagentPollInterval = null;
    }
  } else {
    if (!subagentPollInterval) {
      checkActiveSubagentSessions();
      subagentPollInterval = setInterval(checkActiveSubagentSessions, 10000);
    }
  }
});

// ============================================================================
// BOTTOM SHEET SYSTEM
// ============================================================================

/**
 * Create and show a bottom sheet modal
 * @param {Object} config - Configuration object
 * @param {string} config.icon - Emoji icon
 * @param {string} config.title - Title text
 * @param {string} config.subtitle - One-line subtitle
 * @param {string} config.placeholder - Input placeholder
 * @param {string} config.submitText - Submit button text
 * @param {Function} config.onSubmit - Callback with input value
 * @param {Object} config.activeSession - Active session object (optional)
 * @param {Function} config.onViewSession - Callback to view active session (optional)
 * @returns {Object} - { close: Function } to programmatically close
 */
function createBottomSheet({ icon, title, subtitle, placeholder, submitText, onSubmit, activeSession, onViewSession }) {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'bottom-sheet-overlay';
  
  // Create sheet
  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  
  // Build active session button HTML if session exists
  const activeSessionHtml = activeSession ? `
    <button class="bottom-sheet-active-session">
      <span class="active-dot">●</span>
      View Active Session
    </button>
  ` : '';
  
  sheet.innerHTML = `
    <div class="bottom-sheet-handle"></div>
    <div class="bottom-sheet-header">
      <span class="bottom-sheet-icon">${icon}</span>
      <div class="bottom-sheet-titles">
        <h2 class="bottom-sheet-title">${title}</h2>
        <p class="bottom-sheet-subtitle">${subtitle}</p>
      </div>
    </div>
    ${activeSessionHtml}
    <textarea class="bottom-sheet-input" placeholder="${placeholder}" rows="1"></textarea>
    <button class="bottom-sheet-submit">${submitText}</button>
  `;
  
  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  
  const input = sheet.querySelector('.bottom-sheet-input');
  const submitBtn = sheet.querySelector('.bottom-sheet-submit');
  const handle = sheet.querySelector('.bottom-sheet-handle');
  const activeSessionBtn = sheet.querySelector('.bottom-sheet-active-session');
  
  // Close function with animation
  function close() {
    sheet.classList.add('closing');
    sheet.classList.remove('visible');
    overlay.classList.remove('visible');
    
    setTimeout(() => {
      overlay.remove();
      sheet.remove();
    }, 200);
  }
  
  // Animate in after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
      sheet.classList.add('visible');
      input.focus();
    });
  });
  
  // Close on overlay tap
  overlay.addEventListener('click', close);
  
  // Swipe to dismiss
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  
  function handleTouchStart(e) {
    // Only start drag from handle or if at top of scroll
    const target = e.target;
    if (target === handle || target === sheet && sheet.scrollTop === 0) {
      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      sheet.style.transition = 'none';
    }
  }
  
  function handleTouchMove(e) {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    
    // Only allow dragging down
    if (deltaY > 0) {
      const isDesktop = window.innerWidth >= 520;
      if (isDesktop) {
        sheet.style.transform = `translateX(-50%) translateY(${deltaY}px)`;
      } else {
        sheet.style.transform = `translateY(${deltaY}px)`;
      }
    }
  }
  
  function handleTouchEnd() {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = '';
    
    const deltaY = currentY - startY;
    
    // If dragged more than 100px or with velocity, close
    if (deltaY > 100) {
      close();
    } else {
      // Snap back
      const isDesktop = window.innerWidth >= 520;
      if (isDesktop) {
        sheet.style.transform = 'translateX(-50%) translateY(0)';
      } else {
        sheet.style.transform = 'translateY(0)';
      }
    }
  }
  
  sheet.addEventListener('touchstart', handleTouchStart, { passive: true });
  sheet.addEventListener('touchmove', handleTouchMove, { passive: true });
  sheet.addEventListener('touchend', handleTouchEnd);
  
  // ESC to close
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', handleKeydown);
    }
  }
  document.addEventListener('keydown', handleKeydown);
  
  // Submit handler
  function handleSubmit() {
    const value = input.value.trim();
    if (!value) {
      input.classList.add('error');
      setTimeout(() => input.classList.remove('error'), 300);
      return;
    }
    close();
    onSubmit(value);
  }
  
  submitBtn.addEventListener('click', handleSubmit);
  
  // Handle view active session button click
  if (activeSessionBtn && onViewSession) {
    activeSessionBtn.addEventListener('click', () => {
      close();
      onViewSession(activeSession);
    });
  }
  
  // Enter to submit (Cmd/Ctrl+Enter for multi-line)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  });
  
  // Auto-resize input
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  
  return { close };
}

// View active subagent session - shows messages from that session
function viewActiveSession(session) {
  if (!session) return;
  
  showChatFeedPage();
  
  // Show a system message indicating we're viewing a subagent session
  const systemMsg = document.createElement('div');
  systemMsg.className = 'msg system';
  systemMsg.innerHTML = `
    <strong>Viewing ${session.label || 'subagent'} session</strong><br>
    <small style="opacity: 0.7">Session key: ${session.key}</small>
  `;
  messagesEl.appendChild(systemMsg);
  
  // Send a command to get the session's recent activity
  send(`Show me the recent activity from the ${session.label || 'subagent'} session (key: ${session.key})`, 'chat');
}

// Dev Mode button - session-aware: go to session if exists, else open bottom sheet
document.getElementById('devteam-btn')?.addEventListener('click', async () => {
  // Check if there are any existing sessions for this mode
  let hasSessions = false;
  try {
    const res = await fetch('/api/modes/dev/sessions');
    const data = await res.json();
    hasSessions = data.sessions && data.sessions.length > 0;
  } catch { /* ignore */ }
  
  if (hasSessions) {
    showSessionPage('dev');
  } else {
    createBottomSheet({
      icon: '👨‍💻',
      title: 'Dev Mode',
      subtitle: 'Senior engineer — reads code, writes tests, commits',
      placeholder: 'Describe the task or issue to fix...',
      submitText: 'Start Dev Session',
      onSubmit: async (text) => {
        await showSessionPage('dev');
        if (ws && ws.readyState === WebSocket.OPEN) {
          addSessionMessage('user', text);
          showSessionThinking();
          sessionPageProcessing = true;
          ws.send(JSON.stringify({ type: 'mode_message', sparkMode: 'dev', sessionId: currentSessionId, text }));
        }
      }
    });
  }
});

// Research Mode button - session-aware: go to session if exists, else open bottom sheet
document.getElementById('researcher-btn')?.addEventListener('click', async () => {
  // Check if there are any existing sessions for this mode
  let hasSessions = false;
  try {
    const res = await fetch('/api/modes/research/sessions');
    const data = await res.json();
    hasSessions = data.sessions && data.sessions.length > 0;
  } catch { /* ignore */ }
  
  if (hasSessions) {
    showSessionPage('research');
  } else {
    createBottomSheet({
      icon: '🔬',
      title: 'Research Mode',
      subtitle: 'Deep research with sources and analysis',
      placeholder: 'What topic do you want to research?',
      submitText: 'Start Research',
      onSubmit: async (text) => {
        await showSessionPage('research');
        if (ws && ws.readyState === WebSocket.OPEN) {
          addSessionMessage('user', text);
          showSessionThinking();
          sessionPageProcessing = true;
          ws.send(JSON.stringify({ type: 'mode_message', sparkMode: 'research', sessionId: currentSessionId, text }));
        }
      }
    });
  }
});

// Plan Mode button - session-aware: go to session if exists, else open bottom sheet
document.getElementById('plan-btn')?.addEventListener('click', async () => {
  // Check if there are any existing sessions for this mode
  let hasSessions = false;
  try {
    const res = await fetch('/api/modes/plan/sessions');
    const data = await res.json();
    hasSessions = data.sessions && data.sessions.length > 0;
  } catch { /* ignore */ }
  
  if (hasSessions) {
    showSessionPage('plan');
  } else {
    createBottomSheet({
      icon: '📋',
      title: 'Plan Mode',
      subtitle: 'Technical specs with phases and risks',
      placeholder: 'What do you want to plan?',
      submitText: 'Start Planning',
      onSubmit: async (text) => {
        await showSessionPage('plan');
        if (ws && ws.readyState === WebSocket.OPEN) {
          addSessionMessage('user', text);
          showSessionThinking();
          sessionPageProcessing = true;
          ws.send(JSON.stringify({ type: 'mode_message', sparkMode: 'plan', sessionId: currentSessionId, text }));
        }
      }
    });
  }
});

// Video Gen button - show modal with 3 variants
document.getElementById('videogen-btn')?.addEventListener('click', () => {
  showVideoGenModal();
});

/**
 * Video Gen modal - custom bottom sheet with workflow selection
 * Supports: Text to Video, Image to Video, Face Swap
 */
function showVideoGenModal() {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'bottom-sheet-overlay';
  
  // Create sheet
  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  
  sheet.innerHTML = `
    <div class="bottom-sheet-handle"></div>
    <div class="bottom-sheet-header">
      <span class="bottom-sheet-icon">🎬</span>
      <div class="bottom-sheet-titles">
        <h2 class="bottom-sheet-title">Video Gen</h2>
        <p class="bottom-sheet-subtitle" id="videogen-subtitle">AI video generation</p>
      </div>
    </div>
    
    <div class="bottom-sheet-row">
      <label class="bottom-sheet-label">Workflow</label>
      <div class="option-selector" id="videogen-workflow">
        <button class="option-pill selected" data-value="text2video">Text → Video</button>
        <button class="option-pill" data-value="image2video">Image → Video</button>
        <button class="option-pill" data-value="faceswap">Face Swap</button>
      </div>
    </div>
    
    <div class="bottom-sheet-row" id="videogen-prompt-row">
      <label class="bottom-sheet-label">Prompt</label>
      <textarea class="bottom-sheet-input" id="videogen-prompt" placeholder="Describe the video you want to create..." rows="2"></textarea>
    </div>
    
    <div class="bottom-sheet-row" id="videogen-image-row" style="display:none;">
      <label class="bottom-sheet-label" id="videogen-image-label">Reference Image</label>
      <div class="image-upload-area" id="videogen-upload-area">
        <div class="upload-icon">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </div>
        <div class="upload-text">Tap to upload image</div>
        <div class="upload-hint" id="videogen-image-hint">For image-to-video generation</div>
      </div>
      <input type="file" id="videogen-file-input" accept="image/*" style="display:none">
    </div>
    
    <div class="bottom-sheet-row" id="videogen-video-row" style="display:none;">
      <label class="bottom-sheet-label">Target Video</label>
      <div class="image-upload-area" id="videogen-video-upload-area">
        <div class="upload-icon">
          <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        </div>
        <div class="upload-text">Tap to upload video or paste URL</div>
        <div class="upload-hint">YouTube/video URL or upload file</div>
      </div>
      <input type="file" id="videogen-video-file-input" accept="video/*" style="display:none">
      <input type="text" class="bottom-sheet-input" id="videogen-video-url" placeholder="Or paste YouTube/video URL..." style="margin-top:8px; display:none;">
    </div>
    
    <div class="bottom-sheet-row" id="videogen-aspect-row">
      <label class="bottom-sheet-label">Aspect Ratio</label>
      <div class="option-selector" id="videogen-aspect">
        <button class="option-pill selected" data-value="16:9">16:9</button>
        <button class="option-pill" data-value="9:16">9:16</button>
        <button class="option-pill" data-value="1:1">1:1</button>
      </div>
    </div>
    
    <div class="bottom-sheet-row" id="videogen-duration-row">
      <label class="bottom-sheet-label">Duration</label>
      <div class="option-selector" id="videogen-duration">
        <button class="option-pill selected" data-value="5">5 seconds</button>
        <button class="option-pill" data-value="10">10 seconds</button>
      </div>
    </div>
    
    <button class="bottom-sheet-submit" id="videogen-submit">Generate Video</button>
  `;
  
  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  
  const subtitleEl = sheet.querySelector('#videogen-subtitle');
  const workflowSelector = sheet.querySelector('#videogen-workflow');
  const promptRow = sheet.querySelector('#videogen-prompt-row');
  const promptInput = sheet.querySelector('#videogen-prompt');
  const imageRow = sheet.querySelector('#videogen-image-row');
  const imageLabel = sheet.querySelector('#videogen-image-label');
  const imageHint = sheet.querySelector('#videogen-image-hint');
  const uploadArea = sheet.querySelector('#videogen-upload-area');
  const fileInput = sheet.querySelector('#videogen-file-input');
  const videoRow = sheet.querySelector('#videogen-video-row');
  const videoUploadArea = sheet.querySelector('#videogen-video-upload-area');
  const videoFileInput = sheet.querySelector('#videogen-video-file-input');
  const videoUrlInput = sheet.querySelector('#videogen-video-url');
  const aspectRow = sheet.querySelector('#videogen-aspect-row');
  const aspectSelector = sheet.querySelector('#videogen-aspect');
  const durationRow = sheet.querySelector('#videogen-duration-row');
  const durationSelector = sheet.querySelector('#videogen-duration');
  const submitBtn = sheet.querySelector('#videogen-submit');
  const handle = sheet.querySelector('.bottom-sheet-handle');
  
  // State
  let selectedWorkflow = 'text2video';
  let selectedAspect = '16:9';
  let selectedDuration = '5';
  let selectedImage = null;
  let selectedImageData = null;
  let selectedVideo = null;
  let selectedVideoData = null;
  let selectedVideoUrl = null;
  
  // Close function with animation
  function close() {
    sheet.classList.add('closing');
    sheet.classList.remove('visible');
    overlay.classList.remove('visible');
    
    setTimeout(() => {
      overlay.remove();
      sheet.remove();
    }, 200);
  }
  
  // Animate in after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
      sheet.classList.add('visible');
      promptInput.focus();
    });
  });
  
  // Close on overlay tap
  overlay.addEventListener('click', close);
  
  // Swipe to dismiss
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  
  function handleTouchStart(e) {
    const target = e.target;
    if (target === handle || target === sheet && sheet.scrollTop === 0) {
      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      sheet.style.transition = 'none';
    }
  }
  
  function handleTouchMove(e) {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    
    if (deltaY > 0) {
      const isDesktop = window.innerWidth >= 520;
      if (isDesktop) {
        sheet.style.transform = `translateX(-50%) translateY(${deltaY}px)`;
      } else {
        sheet.style.transform = `translateY(${deltaY}px)`;
      }
    }
  }
  
  function handleTouchEnd() {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = '';
    
    const deltaY = currentY - startY;
    
    if (deltaY > 100) {
      close();
    } else {
      const isDesktop = window.innerWidth >= 520;
      if (isDesktop) {
        sheet.style.transform = 'translateX(-50%) translateY(0)';
      } else {
        sheet.style.transform = 'translateY(0)';
      }
    }
  }
  
  sheet.addEventListener('touchstart', handleTouchStart, { passive: true });
  sheet.addEventListener('touchmove', handleTouchMove, { passive: true });
  sheet.addEventListener('touchend', handleTouchEnd);
  
  // ESC to close
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', handleKeydown);
    }
  }
  document.addEventListener('keydown', handleKeydown);
  
  // formatFileSize imported from modules/ui.js
  
  // Update UI based on workflow
  function updateWorkflowUI() {
    // Reset visibility
    promptRow.style.display = 'block';
    imageRow.style.display = 'none';
    videoRow.style.display = 'none';
    aspectRow.style.display = 'block';
    durationRow.style.display = 'block';
    videoUrlInput.style.display = 'none';
    
    switch (selectedWorkflow) {
      case 'text2video':
        subtitleEl.textContent = 'Generate video from text prompt';
        promptInput.placeholder = 'Describe the video you want to create...';
        submitBtn.textContent = 'Generate Video';
        break;
      case 'image2video':
        subtitleEl.textContent = 'Animate an image into video';
        promptInput.placeholder = 'Describe the motion/action (optional)...';
        imageRow.style.display = 'block';
        imageLabel.textContent = 'Source Image';
        imageHint.textContent = 'Image to animate';
        submitBtn.textContent = 'Generate Video';
        break;
      case 'faceswap':
        subtitleEl.textContent = 'Swap face in a video';
        promptRow.style.display = 'none';
        imageRow.style.display = 'block';
        videoRow.style.display = 'block';
        aspectRow.style.display = 'none';
        durationRow.style.display = 'none';
        imageLabel.textContent = 'Face Image';
        imageHint.textContent = 'Photo with the face to use';
        videoUrlInput.style.display = 'block';
        submitBtn.textContent = 'Swap Face';
        break;
    }
  }
  
  // Workflow selection
  workflowSelector.addEventListener('click', (e) => {
    const pill = e.target.closest('.option-pill');
    if (!pill) return;
    
    workflowSelector.querySelectorAll('.option-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    selectedWorkflow = pill.dataset.value;
    updateWorkflowUI();
  });
  
  // Aspect ratio selection
  aspectSelector.addEventListener('click', (e) => {
    const pill = e.target.closest('.option-pill');
    if (!pill) return;
    
    aspectSelector.querySelectorAll('.option-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    selectedAspect = pill.dataset.value;
  });
  
  // Duration selection
  durationSelector.addEventListener('click', (e) => {
    const pill = e.target.closest('.option-pill');
    if (!pill) return;
    
    durationSelector.querySelectorAll('.option-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    selectedDuration = pill.dataset.value;
  });
  
  // Helper to reset image upload area
  function resetImageUpload() {
    selectedImage = null;
    selectedImageData = null;
    uploadArea.classList.remove('has-image');
    uploadArea.innerHTML = `
      <div class="upload-icon">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      </div>
      <div class="upload-text">Tap to upload image</div>
      <div class="upload-hint" id="videogen-image-hint">${selectedWorkflow === 'faceswap' ? 'Photo with the face to use' : 'Image to animate'}</div>
    `;
    fileInput.value = '';
  }
  
  // Helper to reset video upload area
  function resetVideoUpload() {
    selectedVideo = null;
    selectedVideoData = null;
    selectedVideoUrl = null;
    videoUploadArea.classList.remove('has-image');
    videoUploadArea.innerHTML = `
      <div class="upload-icon">
        <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
      </div>
      <div class="upload-text">Tap to upload video or paste URL</div>
      <div class="upload-hint">YouTube/video URL or upload file</div>
    `;
    videoFileInput.value = '';
    videoUrlInput.value = '';
  }
  
  // Image upload
  uploadArea.addEventListener('click', () => {
    if (!selectedImage) {
      fileInput.click();
    }
  });
  
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    selectedImage = file;
    
    // Read as data URL for preview and sending
    const reader = new FileReader();
    reader.onload = (ev) => {
      selectedImageData = ev.target.result;
      
      // Update upload area to show preview
      uploadArea.classList.add('has-image');
      uploadArea.innerHTML = `
        <div class="image-preview-container">
          <img class="image-preview-thumb" src="${selectedImageData}" alt="Preview">
          <div class="image-preview-info">
            <div class="image-preview-name">${file.name}</div>
            <div class="image-preview-size">${formatFileSize(file.size)}</div>
          </div>
          <button class="image-remove-btn" id="videogen-remove-image">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
      
      // Add remove handler
      sheet.querySelector('#videogen-remove-image')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        resetImageUpload();
      });
    };
    reader.readAsDataURL(file);
  });
  
  // Video upload
  videoUploadArea.addEventListener('click', () => {
    if (!selectedVideo && !selectedVideoUrl) {
      videoFileInput.click();
    }
  });
  
  videoFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    selectedVideo = file;
    selectedVideoUrl = null;
    
    // Read as data URL
    const reader = new FileReader();
    reader.onload = (ev) => {
      selectedVideoData = ev.target.result;
      
      // Update upload area to show preview
      videoUploadArea.classList.add('has-image');
      videoUploadArea.innerHTML = `
        <div class="image-preview-container">
          <div class="upload-icon" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:var(--msg-bot);border-radius:8px;">
            <svg viewBox="0 0 24 24" style="width:30px;height:30px;stroke:var(--text-secondary);fill:none;"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div class="image-preview-info">
            <div class="image-preview-name">${file.name}</div>
            <div class="image-preview-size">${formatFileSize(file.size)}</div>
          </div>
          <button class="image-remove-btn" id="videogen-remove-video">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
      
      // Add remove handler
      sheet.querySelector('#videogen-remove-video')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        resetVideoUpload();
      });
    };
    reader.readAsDataURL(file);
  });
  
  // Video URL input
  videoUrlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url && (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('http'))) {
      selectedVideoUrl = url;
      selectedVideo = null;
      selectedVideoData = null;
      
      // Show URL in upload area
      videoUploadArea.classList.add('has-image');
      videoUploadArea.innerHTML = `
        <div class="image-preview-container">
          <div class="upload-icon" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:var(--msg-bot);border-radius:8px;">
            <svg viewBox="0 0 24 24" style="width:30px;height:30px;stroke:var(--text-secondary);fill:none;"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div class="image-preview-info">
            <div class="image-preview-name" style="word-break:break-all;">${url.length > 40 ? url.substring(0, 40) + '...' : url}</div>
            <div class="image-preview-size">Video URL</div>
          </div>
          <button class="image-remove-btn" id="videogen-remove-video">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
      
      sheet.querySelector('#videogen-remove-video')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        resetVideoUpload();
      });
    }
  });
  
  // Submit handler
  submitBtn.addEventListener('click', () => {
    const prompt = promptInput.value.trim();
    
    // Validate based on workflow
    if (selectedWorkflow === 'text2video') {
      if (!prompt) {
        promptInput.classList.add('error');
        setTimeout(() => promptInput.classList.remove('error'), 300);
        return;
      }
    } else if (selectedWorkflow === 'image2video') {
      if (!selectedImageData) {
        uploadArea.style.borderColor = 'var(--red)';
        setTimeout(() => uploadArea.style.borderColor = '', 300);
        return;
      }
    } else if (selectedWorkflow === 'faceswap') {
      if (!selectedImageData) {
        uploadArea.style.borderColor = 'var(--red)';
        setTimeout(() => uploadArea.style.borderColor = '', 300);
        return;
      }
      if (!selectedVideoData && !selectedVideoUrl) {
        videoUploadArea.style.borderColor = 'var(--red)';
        setTimeout(() => videoUploadArea.style.borderColor = '', 300);
        return;
      }
    }
    
    close();
    showChatFeedPage();
    
    // Build and send command based on workflow
    if (selectedWorkflow === 'text2video') {
      let command = `/video --ratio ${selectedAspect} --duration ${selectedDuration}s ${prompt}`;
      send(command, 'chat');
    } else if (selectedWorkflow === 'image2video') {
      let command = `/video --ratio ${selectedAspect} --duration ${selectedDuration}s`;
      if (prompt) command += ` ${prompt}`;
      sendVideoGenWithImage(command, selectedImageData);
    } else if (selectedWorkflow === 'faceswap') {
      // Build face swap command
      let command = `/faceswap`;
      if (selectedVideoUrl) {
        command += ` --video-url ${selectedVideoUrl}`;
      }
      // Send with image (and optionally video data)
      sendFaceSwapRequest(command, selectedImageData, selectedVideoData, selectedVideoUrl);
    }
  });
  
  // Auto-resize prompt input
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  });
}

// Send video gen command with image attachment
function sendVideoGenWithImage(command, imageData) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }
  isProcessing = true;
  
  // Show user message with image indicator
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = command + ' 📷';
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  trackDisplayedMessage(command);
  showThinking();
  
  ws.send(JSON.stringify({ type: 'transcript', text: command, image: imageData, mode: 'chat' }));
}

// Send face swap request with image and video
function sendFaceSwapRequest(command, imageData, videoData, videoUrl) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }
  isProcessing = true;
  
  // Show user message
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = command + ' 🎭📷🎬';
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  trackDisplayedMessage(command);
  showThinking();
  
  // Send with both image and video data/url
  ws.send(JSON.stringify({ 
    type: 'transcript', 
    text: command, 
    image: imageData, 
    video: videoData,
    videoUrl: videoUrl,
    mode: 'chat' 
  }));
}

// Override send for articulations mode
const originalSend = send;
send = async function(text, sendMode) {
  if (articulationsMode) {
    await sendArticulation(text);
  } else {
    await originalSend(text, sendMode);
  }
};

async function sendArticulation(text) {
  if (!text.trim()) return;
  
  // Ensure we're in chat feed mode
  if (pageState === 'intro') {
    showChatFeedPage({ skipHistory: true });
  }
  
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

// NOTE: Articulations mode reset is now handled directly in showIntroPage()
// (removed monkey-patch pattern for cleaner code and to prevent state issues)

// Today's Reports button - opens daily reports session page and loads today's reports
document.getElementById('todays-reports-btn')?.addEventListener('click', async () => {
  showSessionPage('dailyreports');

  // After showing session page, load today's reports as initial content
  const loadingEl = document.createElement('div');
  loadingEl.className = 'msg system';
  loadingEl.textContent = 'Loading today\'s reports...';
  sessionMessagesEl.appendChild(loadingEl);

  try {
    const response = await fetch('/api/reports/today');
    const data = await response.json();

    loadingEl.remove();

    if (!data.reports?.length) {
      // If no reports, show empty state message
      addSessionMessage('bot', 'No reports found for today. Ask me to generate a market briefing!');
      return;
    }

    // Show header
    addSessionMessage('system', `📊 Today's Reports (${data.reports.length})`);

    // Display each report as a bot message
    data.reports.forEach(r => {
      addSessionMessage('bot', r.summary);
    });

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
  
  // Validate file size
  if (file.size > CONFIG.maxFileSize) {
    toast(`File too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(CONFIG.maxFileSize)}.`, true);
    fileInput.value = '';
    return;
  }
  
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

// formatFileSize is imported from modules/ui.js

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
  const userMsg = addMsg(text + ' 📷', 'user', { userInitiated: true });
  showThinking();
  
  ws.send(JSON.stringify({ type: 'transcript', text, image: imageData, mode: 'chat' }));
}
