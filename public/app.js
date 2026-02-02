/**
 * Spark - Minimal Voice + Chat + Notes
 */

const CONFIG = {
  // Build WebSocket URL - include pathname for subpath routing (e.g., /voice)
  wsUrl: (() => {
    // Use wss:// for HTTPS, ws:// for HTTP
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = `${protocol}//${location.host}`;
    // If we're on a subpath like /voice, include it
    const path = location.pathname.replace(/\/+$/, ''); // remove trailing slashes
    return path && path !== '/' ? `${base}${path}` : base;
  })(),
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
const sparkStatusEl = document.getElementById('spark-status');
let activeSessionsData = { count: 0, thinking: false, sessions: [] };

// Update Spark gateway connection status pill
function updateSparkStatus(state) {
  if (!sparkStatusEl) return;
  sparkStatusEl.classList.remove('connected', 'connecting');
  if (state === 'connected') {
    sparkStatusEl.classList.add('connected');
    sparkStatusEl.title = 'Clawdbot Gateway: Connected';
    // Fetch sessions on connect
    fetchActiveSessions();
  } else if (state === 'connecting') {
    sparkStatusEl.classList.add('connecting');
    sparkStatusEl.title = 'Clawdbot Gateway: Connecting...';
  } else {
    // disconnected - no class, shows red
    sparkStatusEl.title = 'Clawdbot Gateway: Disconnected';
  }
}

// Fetch active sessions from gateway
async function fetchActiveSessions() {
  try {
    const res = await fetch('/api/active-sessions');
    const data = await res.json();
    activeSessionsData = data;
    updateSparkPillText();
  } catch (e) {
    console.error('Failed to fetch active sessions:', e);
  }
}

// Update pill to show session status
function updateSparkPillText() {
  if (!sparkStatusEl) return;
  
  // Find or create count badge
  let countBadge = sparkStatusEl.querySelector('.session-count');
  if (!countBadge) {
    countBadge = document.createElement('span');
    countBadge.className = 'session-count';
    sparkStatusEl.appendChild(countBadge);
  }
  
  // Count sub-agents (sessions that aren't main)
  const subAgentCount = (activeSessionsData.sessions || []).filter(s => s.isSubagent).length;
  
  // Green outline ONLY when processing OR sub-agents running
  if (isProcessing || subAgentCount > 0) {
    sparkStatusEl.classList.add('active');
  } else {
    sparkStatusEl.classList.remove('active');
  }
  
  // Show count only when sub-agents are running
  if (subAgentCount > 0) {
    countBadge.textContent = subAgentCount;
    countBadge.style.display = 'flex';
  } else {
    countBadge.style.display = 'none';
  }
}

// Toggle sessions popup on click
sparkStatusEl?.addEventListener('click', (e) => {
  e.stopPropagation(); // Prevent immediate re-close from document click listener
  const existing = document.getElementById('sessions-popup');
  if (existing) {
    // Popup is open, close it
    existing.remove();
  } else {
    // Popup is closed, open it
    showSessionsPopup();
    // Refresh in background
    fetchActiveSessions().then(() => {
      const popup = document.getElementById('sessions-popup');
      if (popup) updateSessionsPopupContent(popup);
    });
  }
});

function getSessionDescription(s) {
  // Extract task type from label
  const label = (s.label || '').toLowerCase();
  if (label.includes('engineer')) return 'Implementing fixes...';
  if (label.includes('qa')) return 'Reviewing code...';
  if (label.includes('dev')) return 'Running dev workflow...';
  if (label.includes('test')) return 'Running test...';
  return 'Working...';
}

function getSessionIcon(s) {
  // SVG icons instead of emojis
  if (s.isMain) {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3L4 14h7v7l9-11h-7V3z"/></svg>`;
  }
  if (s.isSubagent) {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>`;
}

function updateSessionsPopupContent(popup) {
  const sessions = activeSessionsData.sessions || [];
  // Only show sub-agents (background tasks), not main session
  const subAgents = sessions.filter(s => s.isSubagent);
  
  if (subAgents.length === 0) {
    popup.innerHTML = `
      <div style="color: var(--text-secondary); font-size: 14px;">
        No background tasks running
      </div>
    `;
  } else {
    popup.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px; color: var(--text);">
        Background Tasks (${subAgents.length})
      </div>
      ${subAgents.map(s => `
        <div style="padding: 10px; background: var(--input-bg); 
          border-radius: 8px; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 10px;">
          <div style="opacity: 0.6; margin-top: 2px;">${getSessionIcon(s)}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; font-size: 13px; color: var(--text);">
              ${s.label || 'Task'}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
              ${getSessionDescription(s)}
            </div>
          </div>
        </div>
      `).join('')}
    `;
  }
}

function showSessionsPopup() {
  // Remove existing popup
  document.getElementById('sessions-popup')?.remove();
  
  const popup = document.createElement('div');
  popup.id = 'sessions-popup';
  popup.style.cssText = `
    position: fixed; top: 70px; left: 16px;
    background: var(--bg); border-radius: 12px;
    padding: 16px; min-width: 260px; max-width: 320px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    border: 1px solid var(--input-border);
    z-index: 1000;
  `;
  
  updateSessionsPopupContent(popup);
  document.body.appendChild(popup);
  
  // Close on click outside
  const closePopup = (e) => {
    if (!popup.contains(e.target) && !sparkStatusEl.contains(e.target)) {
      popup.remove();
      document.removeEventListener('click', closePopup);
    }
  };
  setTimeout(() => document.addEventListener('click', closePopup), 10);
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

// Track recently displayed messages to prevent duplicates (by content hash)
const displayedMessageHashes = new Set();
const MAX_DISPLAYED_HASHES = 50;

function hashMessageContent(text) {
  // Simple hash for deduplication
  const str = (text || '').trim().slice(0, 200);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

function trackDisplayedMessage(text) {
  const hash = hashMessageContent(text);
  displayedMessageHashes.add(hash);
  // Clean old entries
  if (displayedMessageHashes.size > MAX_DISPLAYED_HASHES) {
    const iter = displayedMessageHashes.values();
    for (let i = 0; i < 10; i++) displayedMessageHashes.delete(iter.next().value);
  }
}

function isMessageDisplayed(text) {
  return displayedMessageHashes.has(hashMessageContent(text));
}

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

function addMsg(text, type) {
  // If on intro page, switch to chat feed
  // NOTE: For user messages from send(), history is already rendered before this is called
  // This fallback handles bot messages and other cases
  if (pageState === 'intro') {
    // Render preloaded history if not already done
    if (preloadedHistory && preloadedHistory.length > 0 && !historyRendered) {
      renderPreloadedHistory();
    }
    showChatFeedPage({ skipHistory: true });
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

// Build realtime WebSocket URL
function getRealtimeWsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${location.host}`;
  const path = location.pathname.replace(/\/+$/, '');
  return path && path !== '/' ? `${base}${path}/realtime` : `${base}/realtime`;
}

// Convert Float32Array to base64 PCM16
function float32ToBase64PCM16(float32Array) {
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

// Convert base64 PCM16 to Float32Array
function base64PCM16ToFloat32(base64) {
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
    if (preloadedHistory && preloadedHistory.length > 0 && !historyRendered) {
      console.log('📜 Rendering history before first message');
      renderPreloadedHistory();
    }
    
    // Now switch to chat feed (history already rendered)
    showChatFeedPage({ skipHistory: true });
  }
  
  isProcessing = true;
  updateSparkPillText();
  
  // Add user message (history should already be rendered above if on intro)
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  // Track message to prevent duplicate from sync
  trackDisplayedMessage(text);
  
  showThinking();
  ws.send(JSON.stringify({ type: 'transcript', text, mode: sendMode }));
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
      showThinking();
      break;
    case 'text':
      console.log('✅ Text message received:', data.content?.slice?.(0, 100));
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
      updateSparkPillText();
      fetchActiveSessions(); // Refresh sessions after response
      refreshHistoryCache(); // Keep history cache up to date
      if (mode === 'voice' && !isListening) startVoice();
      break;
    case 'error':
      removeThinking();
      toast(data.message || 'Error', true);
      isProcessing = false;
      setStatus('');
      updateSparkPillText();
      fetchActiveSessions();
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

// Edit action (puts text in input)
menuEdit?.addEventListener('click', () => {
  if (!selectedMsg) return;
  const text = selectedMsg.textContent || selectedMsg.innerText;
  if (textInput) {
    textInput.value = text;
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
    sendBtn?.classList.add('show');
    textInput.focus();
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

// Articulations mode button handler
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
 * @returns {Object} - { close: Function } to programmatically close
 */
function createBottomSheet({ icon, title, subtitle, placeholder, submitText, onSubmit }) {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'bottom-sheet-overlay';
  
  // Create sheet
  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  
  sheet.innerHTML = `
    <div class="bottom-sheet-handle"></div>
    <div class="bottom-sheet-header">
      <span class="bottom-sheet-icon">${icon}</span>
      <div class="bottom-sheet-titles">
        <h2 class="bottom-sheet-title">${title}</h2>
        <p class="bottom-sheet-subtitle">${subtitle}</p>
      </div>
    </div>
    <textarea class="bottom-sheet-input" placeholder="${placeholder}" rows="1"></textarea>
    <button class="bottom-sheet-submit">${submitText}</button>
  `;
  
  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  
  const input = sheet.querySelector('.bottom-sheet-input');
  const submitBtn = sheet.querySelector('.bottom-sheet-submit');
  const handle = sheet.querySelector('.bottom-sheet-handle');
  
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

// Dev Mode button (spawns isolated dev subagent)
document.getElementById('devteam-btn')?.addEventListener('click', () => {
  showDevModeModal();
});

function showDevModeModal() {
  createBottomSheet({
    icon: '👨‍💻',
    title: 'Dev Mode',
    subtitle: 'Isolated coding session',
    placeholder: 'Describe the task or issues to fix...',
    submitText: 'Start Dev Mode',
    onSubmit: (task) => {
      showChatFeedPage();
      send(`/dev ${task}`, 'chat');
    }
  });
}

// Research Mode button (spawns isolated research subagent)
document.getElementById('researcher-btn')?.addEventListener('click', () => {
  showResearchModeModal();
});

function showResearchModeModal() {
  createBottomSheet({
    icon: '🔬',
    title: 'Research Mode',
    subtitle: 'Deep research subagent',
    placeholder: 'What would you like me to research?',
    submitText: 'Start Research',
    onSubmit: (topic) => {
      showChatFeedPage();
      send(`/research ${topic}`, 'chat');
    }
  });
}

// Plan Mode button (Feature spec generation)
document.getElementById('plan-btn')?.addEventListener('click', () => {
  showPlanModeModal();
});

function showPlanModeModal() {
  createBottomSheet({
    icon: '📋',
    title: 'Plan Mode',
    subtitle: 'Create detailed specs',
    placeholder: 'What do you want to build?',
    submitText: 'Start Planning',
    onSubmit: (topic) => {
      const planRequest = `/plan ${topic}`;
      showChatFeedPage();
      send(planRequest, 'chat');
    }
  });
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
