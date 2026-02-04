(() => {
  // public/src/config.js
  var CONFIG = {
    wsUrl: (() => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const base = `${protocol}//${location.host}`;
      const path = location.pathname.replace(/\/+$/, "");
      return path && path !== "/" ? `${base}${path}` : base;
    })(),
    silenceMs: 1500
  };
  var MODE_DEFAULTS = {
    dev: { name: "Dev Mode", icon: "\u{1F468}\u200D\u{1F4BB}", notifyWhatsApp: true },
    research: { name: "Research Mode", icon: "\u{1F52C}", notifyWhatsApp: true },
    plan: { name: "Plan Mode", icon: "\u{1F4CB}", notifyWhatsApp: true },
    articulate: { name: "Articulate Mode", icon: "\u270D\uFE0F", notifyWhatsApp: false },
    dailyreports: { name: "Daily Reports", icon: "\u{1F4CA}", notifyWhatsApp: true },
    videogen: { name: "Video Gen", icon: "\u{1F3AC}", notifyWhatsApp: true }
  };

  // public/src/app.js
  console.log("\u26A1 Spark Voice v2.0 (Step 1: CONFIG extracted)");
  var messagesEl = document.getElementById("messages");
  var welcomeEl = document.getElementById("welcome");
  var textInput = document.getElementById("text-input");
  var sendBtn = document.getElementById("send-btn");
  var voiceBtn = document.getElementById("voice-btn");
  var notesBtn = document.getElementById("notes-btn");
  var statusEl = document.getElementById("status");
  var timerEl = document.getElementById("timer");
  var toastEl = document.getElementById("toast");
  var uploadBtn = document.getElementById("upload-btn");
  var fileInput = document.getElementById("file-input");
  var bottomEl = document.getElementById("bottom");
  var sparkStatusEl = document.getElementById("spark-status");
  var activeSessionsData = { count: 0, thinking: false, sessions: [] };
  function updateSparkStatus(state) {
    if (!sparkStatusEl) return;
    sparkStatusEl.classList.remove("connected", "connecting");
    if (state === "connected") {
      sparkStatusEl.classList.add("connected");
      sparkStatusEl.title = "Clawdbot Gateway: Connected";
      fetchActiveSessions();
    } else if (state === "connecting") {
      sparkStatusEl.classList.add("connecting");
      sparkStatusEl.title = "Clawdbot Gateway: Connecting...";
    } else {
      sparkStatusEl.title = "Clawdbot Gateway: Disconnected";
    }
  }
  async function fetchActiveSessions() {
    try {
      const res = await fetch("/api/active-sessions");
      const data = await res.json();
      activeSessionsData = data;
      updateSparkPillText();
    } catch (e) {
      console.error("Failed to fetch active sessions:", e);
    }
  }
  function updateSparkPillText() {
    if (!sparkStatusEl) return;
    let countBadge = sparkStatusEl.querySelector(".session-count");
    if (!countBadge) {
      countBadge = document.createElement("span");
      countBadge.className = "session-count";
      sparkStatusEl.appendChild(countBadge);
    }
    const subAgentCount = (activeSessionsData.sessions || []).filter((s) => s.isSubagent).length;
    if (isProcessing || subAgentCount > 0) {
      sparkStatusEl.classList.add("active");
    } else {
      sparkStatusEl.classList.remove("active");
    }
    if (subAgentCount > 0) {
      countBadge.textContent = subAgentCount;
      countBadge.style.display = "flex";
    } else {
      countBadge.style.display = "none";
    }
  }
  sparkStatusEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    const existing = document.getElementById("sessions-popup");
    if (existing) {
      existing.remove();
    } else {
      showSessionsPopup();
      fetchActiveSessions().then(() => {
        const popup = document.getElementById("sessions-popup");
        if (popup) updateSessionsPopupContent(popup);
      });
    }
  });
  function getSessionDescription(s) {
    const label = (s.label || "").toLowerCase();
    if (label.includes("engineer")) return "Implementing fixes...";
    if (label.includes("qa")) return "Reviewing code...";
    if (label.includes("dev")) return "Running dev workflow...";
    if (label.includes("test")) return "Running test...";
    return "Working...";
  }
  function getSessionIcon(s) {
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
    const subAgents = sessions.filter((s) => s.isSubagent);
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
      ${subAgents.map((s) => `
        <div style="padding: 10px; background: var(--input-bg); 
          border-radius: 8px; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 10px;">
          <div style="opacity: 0.6; margin-top: 2px;">${getSessionIcon(s)}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; font-size: 13px; color: var(--text);">
              ${s.label || "Task"}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
              ${getSessionDescription(s)}
            </div>
          </div>
        </div>
      `).join("")}
    `;
    }
  }
  function showSessionsPopup() {
    document.getElementById("sessions-popup")?.remove();
    const popup = document.createElement("div");
    popup.id = "sessions-popup";
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
    const closePopup = (e) => {
      if (!popup.contains(e.target) && !sparkStatusEl.contains(e.target)) {
        popup.remove();
        document.removeEventListener("click", closePopup);
      }
    };
    setTimeout(() => document.addEventListener("click", closePopup), 10);
  }
  var voiceBar = document.getElementById("voice-bar");
  var closeVoiceBtn = document.getElementById("close-voice-btn");
  var waveformEl = document.getElementById("waveform");
  var voiceContent = document.getElementById("voice-content");
  var voiceStatus = document.getElementById("voice-status");
  var notesContent = document.getElementById("notes-content");
  var notesTimerEl = document.getElementById("notes-timer");
  var notesBar = document.getElementById("notes-bar");
  var closeNotesBtn = document.getElementById("close-notes-btn");
  var deleteNotesBtn = document.getElementById("delete-notes-btn");
  var closeBtn = document.getElementById("close-btn");
  var historyBtn = document.getElementById("history-btn");
  var themeBtn = document.getElementById("theme-btn");
  function initTheme() {
    const saved = localStorage.getItem("theme");
    if (saved) {
      document.documentElement.setAttribute("data-theme", saved);
    }
  }
  initTheme();
  themeBtn?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let newTheme;
    if (current === "dark") {
      newTheme = "light";
    } else if (current === "light") {
      newTheme = "dark";
    } else {
      newTheme = prefersDark ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
  });
  var modelBtn = document.getElementById("model-btn");
  var currentModel = localStorage.getItem("ai-model") || "claude";
  function updateModelButton() {
    const label = modelBtn?.querySelector(".model-label");
    if (label) {
      label.textContent = currentModel === "kimi" ? "Kimi" : "Claude";
    }
    modelBtn?.classList.toggle("kimi", currentModel === "kimi");
  }
  updateModelButton();
  modelBtn?.addEventListener("click", () => {
    currentModel = currentModel === "claude" ? "kimi" : "claude";
    localStorage.setItem("ai-model", currentModel);
    updateModelButton();
    showToast(`Switched to ${currentModel === "kimi" ? "Kimi K2.5" : "Claude"}`);
  });
  var ws = null;
  var mode = "chat";
  var pageState = "intro";
  var articulationsMode = false;
  var isListening = false;
  var realtimeReconnectAttempts = 0;
  var MAX_RECONNECT_ATTEMPTS = 5;
  var isProcessing = false;
  var audioContext = null;
  var currentAudio = null;
  var mediaRecorder = null;
  var audioChunks = [];
  var recordStart = null;
  var timerInterval = null;
  var mediaStream = null;
  var currentSparkMode = null;
  var modeHistory = {};
  var modeConfigs = {};
  async function loadModeConfigs() {
    try {
      const res = await fetch("/api/modes");
      const data = await res.json();
      modeConfigs = data.modes || {};
      console.log("\u{1F4E6} Loaded mode configs:", Object.keys(modeConfigs));
    } catch (e) {
      console.error("Failed to load mode configs:", e);
      modeConfigs = MODE_DEFAULTS;
    }
  }
  function getModeConfig(mode2) {
    return modeConfigs[mode2] || MODE_DEFAULTS[mode2] || { name: mode2, icon: "\u{1F4E6}" };
  }
  async function enterMode(modeName) {
    const config = getModeConfig(modeName);
    console.log(`\u{1F4E6} Entering ${config.name}...`);
    currentSparkMode = modeName;
    showChatFeedPage();
    updateModeIndicator();
    await loadModeHistory(modeName);
    renderModeHistory(modeName);
  }
  function updateModeIndicator() {
    let indicator = document.getElementById("mode-indicator");
    if (currentSparkMode) {
      const config = getModeConfig(currentSparkMode);
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "mode-indicator";
        indicator.className = "mode-indicator";
        document.querySelector(".top-bar")?.appendChild(indicator);
      }
      indicator.innerHTML = `
      <span class="mode-icon">${config.icon}</span>
      <span class="mode-name">${config.name}</span>
      <button class="mode-exit-btn" onclick="exitMode()">\u2715</button>
    `;
      indicator.style.display = "flex";
    } else {
      if (indicator) {
        indicator.style.display = "none";
      }
    }
  }
  async function loadModeHistory(modeName) {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "mode_history", sparkMode: modeName }));
      } else {
        const res = await fetch(`/api/modes/${modeName}/history`);
        const data = await res.json();
        modeHistory[modeName] = data.messages || [];
      }
    } catch (e) {
      console.error(`Failed to load ${modeName} history:`, e);
      modeHistory[modeName] = [];
    }
  }
  function renderModeHistory(modeName) {
    const messages = modeHistory[modeName] || [];
    messagesEl.querySelectorAll(".msg, .mode-empty-state").forEach((el) => el.remove());
    if (messages.length === 0) {
      const config = getModeConfig(modeName);
      const emptyEl = document.createElement("div");
      emptyEl.className = "mode-empty-state";
      emptyEl.innerHTML = `
      <div class="mode-empty-icon">${config.icon}</div>
      <div class="mode-empty-title">${config.name}</div>
      <div class="mode-empty-desc">Start a conversation in this mode.</div>
    `;
      messagesEl.appendChild(emptyEl);
    } else {
      for (const msg of messages) {
        const text = extractMessageText(msg);
        if (text) {
          addMessage(msg.role === "assistant" ? "bot" : "user", text);
        }
      }
    }
    scrollToBottom();
  }
  function extractMessageText(msg) {
    if (!msg?.content) return null;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const textPart = msg.content.find((c) => c.type === "text");
      return textPart?.text || null;
    }
    return null;
  }
  loadModeConfigs();
  var preloadedHistory = null;
  var historyLoadPromise = null;
  var historyRendered = false;
  function loadHistoryInBackground(forceRefresh = false) {
    if (historyLoadPromise && !forceRefresh) return historyLoadPromise;
    historyLoadPromise = fetch("/api/messages/all").then((res) => res.json()).then((data) => {
      preloadedHistory = data.messages || [];
      console.log(`\u{1F4DC} Pre-loaded ${preloadedHistory.length} messages`);
      if (preloadedHistory.length > 0) {
        const lastMsg = preloadedHistory[preloadedHistory.length - 1];
        if (lastMsg.timestamp && lastMsg.timestamp > lastMessageTimestamp) {
          lastMessageTimestamp = lastMsg.timestamp;
          console.log(`\u{1F4DC} Set lastMessageTimestamp to ${lastMessageTimestamp}`);
        }
      }
      return preloadedHistory;
    }).catch((e) => {
      console.error("Failed to preload history:", e);
      preloadedHistory = [];
      return [];
    });
    return historyLoadPromise;
  }
  function refreshHistoryCache() {
    historyLoadPromise = null;
    historyRendered = false;
    loadHistoryInBackground(true);
  }
  function renderPreloadedHistory() {
    if (historyRendered) return;
    if (!preloadedHistory || preloadedHistory.length === 0) return;
    historyRendered = true;
    preloadedHistory.forEach((m) => {
      const el = document.createElement("div");
      el.className = `msg ${m.role === "user" ? "user" : "bot"}`;
      if (m.role === "user") {
        el.textContent = m.text;
      } else {
        el.innerHTML = formatMessage(m.text);
      }
      messagesEl.appendChild(el);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  var isTransitioning = false;
  function showIntroPage() {
    if (isTransitioning) {
      console.log("showIntroPage blocked - transition in progress");
      return;
    }
    isTransitioning = true;
    console.log("showIntroPage called");
    requestAnimationFrame(() => {
      pageState = "intro";
      currentSparkMode = null;
      updateModeIndicator();
      articulationsMode = false;
      if (textInput) textInput.placeholder = "Talk to me";
      document.body.classList.remove("chatfeed-mode");
      if (welcomeEl) welcomeEl.style.display = "";
      messagesEl?.querySelectorAll(".msg").forEach((m) => m.remove());
      removeThinking();
      historyRendered = false;
      if (historyBtn) {
        historyBtn.classList.remove("hidden");
      }
      if (messagesEl) {
        messagesEl.scrollTop = 0;
        messagesEl.style.overflow = "hidden";
      }
      isTransitioning = false;
    });
  }
  function showChatFeedPage(options = {}) {
    if (isTransitioning) {
      console.log("showChatFeedPage blocked - transition in progress");
      return;
    }
    isTransitioning = true;
    console.log("showChatFeedPage called");
    requestAnimationFrame(() => {
      pageState = "chatfeed";
      document.body.classList.add("chatfeed-mode");
      if (welcomeEl) welcomeEl.style.display = "none";
      if (historyBtn) {
        historyBtn.classList.add("hidden");
      }
      if (messagesEl) {
        messagesEl.style.overflow = "auto";
      }
      if (!options.skipHistory && preloadedHistory && preloadedHistory.length > 0) {
        renderPreloadedHistory();
      }
      isTransitioning = false;
    });
  }
  historyBtn?.addEventListener("click", async () => {
    if (preloadedHistory === null && historyLoadPromise) {
      await historyLoadPromise;
    }
    showChatFeedPage();
    if (!preloadedHistory || preloadedHistory.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "msg system";
      emptyEl.textContent = "No chat history yet";
      messagesEl.appendChild(emptyEl);
    }
  });
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Close button clicked");
    showIntroPage();
  });
  var closeChatBtn = document.getElementById("close-chat-btn");
  closeChatBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add("slide-out");
    setTimeout(() => {
      document.body.classList.remove("slide-out");
      showIntroPage();
    }, 250);
  });
  var SCROLL_THRESHOLD = 50;
  var introTouchStartY = 0;
  var introScrollTriggered = false;
  messagesEl?.addEventListener("touchstart", (e) => {
    if (pageState !== "intro") return;
    introTouchStartY = e.touches[0].clientY;
    introScrollTriggered = false;
  }, { passive: true });
  messagesEl?.addEventListener("touchmove", (e) => {
    if (pageState !== "intro" || introScrollTriggered) return;
    const currentY = e.touches[0].clientY;
    const pullDistance = currentY - introTouchStartY;
    if (pullDistance >= SCROLL_THRESHOLD) {
      introScrollTriggered = true;
      openChatWithLoading();
    }
  }, { passive: true });
  messagesEl?.addEventListener("wheel", (e) => {
    if (pageState !== "intro") return;
    if (e.deltaY < -SCROLL_THRESHOLD) {
      openChatWithLoading();
    }
  }, { passive: true });
  async function openChatWithLoading() {
    showThinking();
    try {
      if (preloadedHistory === null && historyLoadPromise) {
        await Promise.race([
          historyLoadPromise,
          new Promise((_, reject) => setTimeout(() => reject("timeout"), 3e3))
        ]);
      } else if (preloadedHistory === null) {
        await Promise.race([
          loadHistoryInBackground(true),
          new Promise((_, reject) => setTimeout(() => reject("timeout"), 3e3))
        ]);
      }
    } catch (e) {
      console.log("History load timeout or error:", e);
    }
    removeThinking();
    document.body.classList.add("slide-in");
    showChatFeedPage();
    setTimeout(() => document.body.classList.remove("slide-in"), 400);
    if (!preloadedHistory || preloadedHistory.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "msg system";
      emptyEl.textContent = "No chat history yet";
      messagesEl.appendChild(emptyEl);
    }
  }
  var displayedMessageHashes = /* @__PURE__ */ new Set();
  var MAX_DISPLAYED_HASHES = 50;
  function hashMessageContent(text) {
    const str = (text || "").trim().slice(0, 200);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  function trackDisplayedMessage(text) {
    const hash = hashMessageContent(text);
    displayedMessageHashes.add(hash);
    if (displayedMessageHashes.size > MAX_DISPLAYED_HASHES) {
      const iter = displayedMessageHashes.values();
      for (let i = 0; i < 10; i++) displayedMessageHashes.delete(iter.next().value);
    }
  }
  function isMessageDisplayed(text) {
    return displayedMessageHashes.has(hashMessageContent(text));
  }
  function isNearBottom(threshold = 100) {
    if (!messagesEl) return true;
    const { scrollTop, scrollHeight, clientHeight } = messagesEl;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }
  function scrollToBottomIfNeeded() {
    if (isNearBottom()) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }
  function addMsg(text, type, options = {}) {
    if (pageState === "intro") {
      if (options.userInitiated) {
        if (preloadedHistory && preloadedHistory.length > 0 && !historyRendered) {
          renderPreloadedHistory();
        }
        showChatFeedPage({ skipHistory: true });
      } else {
        if (type === "bot") {
          toast("New message from Spark");
        }
        return null;
      }
    }
    trackDisplayedMessage(text);
    const el = document.createElement("div");
    el.className = `msg ${type}`;
    if (type === "bot") {
      el.innerHTML = formatMessage(text);
    } else if (type === "user") {
      el.textContent = text;
    } else {
      el.textContent = text;
    }
    messagesEl.appendChild(el);
    if (type === "user") {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      scrollToBottomIfNeeded();
    }
    return el;
  }
  function formatMessage(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>").replace(/^(.*)$/, "<p>$1</p>").replace(/<p><\/p>/g, "");
  }
  function showThinking() {
    if (pageState === "intro") return;
    removeThinking();
    const el = document.createElement("div");
    el.className = "msg bot thinking";
    el.id = "thinking-indicator";
    el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(el);
    scrollToBottomIfNeeded();
  }
  function removeThinking() {
    document.getElementById("thinking-indicator")?.remove();
  }
  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.classList.toggle("show", !!text);
    }
  }
  function toast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.className = isError ? "show error" : "show";
    setTimeout(() => toastEl.className = "", 3e3);
  }
  var realtimeWs = null;
  var realtimeAudioContext = null;
  var realtimeMediaStream = null;
  var realtimeScriptProcessor = null;
  var realtimePlaybackContext = null;
  var audioQueue = [];
  var isPlaying = false;
  var thinkingInterval = null;
  function createThinkingSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sampleRate = ctx.sampleRate;
    const duration = 0.3;
    const samples = duration * sampleRate;
    const buffer = ctx.createBuffer(1, samples, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const freq = 880;
      const env = Math.exp(-8 * t / duration);
      data[i] = env * 0.2 * Math.sin(2 * Math.PI * freq * t);
    }
    return { ctx, buffer };
  }
  function playWaitingSound() {
    if (thinkingInterval) return;
    console.log("\u{1F50A} Thinking sound started");
    playThinkingPulse();
    thinkingInterval = setInterval(playThinkingPulse, 2e3);
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
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        ctx.close().catch(() => {
        });
      };
    } catch (e) {
      console.error("Thinking sound error:", e);
      if (ctx && ctx.state !== "closed") {
        ctx.close().catch(() => {
        });
      }
    }
  }
  function stopWaitingSound() {
    if (thinkingInterval) {
      clearInterval(thinkingInterval);
      thinkingInterval = null;
      console.log("\u{1F507} Thinking sound stopped");
    }
  }
  var currentUserMsg = null;
  var currentAssistantMsg = null;
  function addVoiceMessage(role, text) {
    if (!voiceContent) return null;
    const msg = document.createElement("div");
    msg.className = `voice-msg ${role}`;
    msg.textContent = text;
    voiceContent.appendChild(msg);
    voiceContent.scrollTop = voiceContent.scrollHeight;
    return msg;
  }
  function updateVoiceStatus(text) {
    if (voiceStatus) {
      voiceStatus.textContent = text;
    }
  }
  function getRealtimeWsUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const base = `${protocol}//${location.host}`;
    const path = location.pathname.replace(/\/+$/, "");
    return path && path !== "/" ? `${base}${path}/realtime` : `${base}/realtime`;
  }
  function float32ToBase64PCM16(float32Array) {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 32768 : s * 32767;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  function base64PCM16ToFloat32(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / (pcm16[i] < 0 ? 32768 : 32767);
    }
    return float32;
  }
  async function playAudioQueue() {
    if (isPlaying || audioQueue.length === 0) return;
    isPlaying = true;
    while (audioQueue.length > 0) {
      const audioData = audioQueue.shift();
      try {
        if (!realtimePlaybackContext) {
          realtimePlaybackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24e3 });
        }
        const float32 = base64PCM16ToFloat32(audioData);
        const audioBuffer = realtimePlaybackContext.createBuffer(1, float32.length, 24e3);
        audioBuffer.getChannelData(0).set(float32);
        const source = realtimePlaybackContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(realtimePlaybackContext.destination);
        await new Promise((resolve) => {
          source.onended = resolve;
          source.start();
        });
      } catch (e) {
        console.error("Audio playback error:", e);
      }
    }
    await new Promise((r) => setTimeout(r, 100));
    isPlaying = false;
  }
  var ttsAudioBuffer = [];
  async function playAudioQueueTTS() {
    if (isPlaying) return;
    while (audioQueue.length > 0) {
      ttsAudioBuffer.push(audioQueue.shift());
    }
    if (ttsAudioBuffer.length > 0) {
      isPlaying = true;
      let ctx = null;
      try {
        const combinedBase64 = ttsAudioBuffer.join("");
        ttsAudioBuffer = [];
        const binary = atob(combinedBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / (pcm16[i] < 0 ? 32768 : 32767);
        }
        ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24e3 });
        const audioBuffer = ctx.createBuffer(1, float32.length, 24e3);
        audioBuffer.getChannelData(0).set(float32);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        await new Promise((resolve) => {
          source.onended = () => {
            ctx.close().catch(() => {
            });
            resolve();
          };
          source.start();
        });
        if (hybridWs && hybridWs.readyState === WebSocket.OPEN) {
          hybridWs.send(JSON.stringify({ type: "audio_playback_ended" }));
          console.log("\u{1F50A} Notified server: playback ended");
        }
      } catch (e) {
        console.error("TTS playback error:", e);
        if (ctx && ctx.state !== "closed") {
          ctx.close().catch(() => {
          });
        }
        if (hybridWs && hybridWs.readyState === WebSocket.OPEN) {
          hybridWs.send(JSON.stringify({ type: "audio_playback_ended" }));
        }
      }
      await new Promise((r) => setTimeout(r, 100));
      isPlaying = false;
    }
  }
  function stopAudioPlayback() {
    audioQueue = [];
    isPlaying = false;
    if (realtimePlaybackContext) {
      realtimePlaybackContext.close().catch(() => {
      });
      realtimePlaybackContext = null;
    }
  }
  var waveAnimationFrame = null;
  var analyserNode = null;
  function startWaveAnimation() {
    function checkSpeaking() {
      if (analyserNode) {
        const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const amplitude = sum / dataArray.length / 255;
        const isSpeaking = amplitude > 0.05;
        const voiceBar2 = document.getElementById("voice-bar");
        if (voiceBar2) {
          voiceBar2.classList.toggle("speaking", isSpeaking);
        }
      }
      waveAnimationFrame = requestAnimationFrame(checkSpeaking);
    }
    checkSpeaking();
  }
  function stopWaveAnimation() {
    if (waveAnimationFrame) {
      cancelAnimationFrame(waveAnimationFrame);
      waveAnimationFrame = null;
    }
    const voiceBar2 = document.getElementById("voice-bar");
    if (voiceBar2) {
      voiceBar2.classList.remove("speaking");
    }
  }
  async function startAudioCapture() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast("Microphone not supported in this browser", true);
        return false;
      }
      realtimeAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24e3 });
      try {
        realtimeMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24e3,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true
          }
        });
      } catch (micError) {
        if (micError.name === "NotAllowedError") {
          toast("Microphone permission denied. Please allow access.", true);
        } else if (micError.name === "NotFoundError") {
          toast("No microphone found", true);
        } else {
          toast("Microphone error: " + micError.message, true);
        }
        console.error("Microphone access error:", micError);
        if (realtimeAudioContext) {
          realtimeAudioContext.close().catch(() => {
          });
          realtimeAudioContext = null;
        }
        return false;
      }
      const source = realtimeAudioContext.createMediaStreamSource(realtimeMediaStream);
      analyserNode = realtimeAudioContext.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);
      startWaveAnimation();
      realtimeScriptProcessor = realtimeAudioContext.createScriptProcessor(4096, 1, 1);
      realtimeScriptProcessor.onaudioprocess = (e) => {
        if (realtimeWs && realtimeWs.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          if (isPlaying && rms < 0.04) return;
          const base64Audio = float32ToBase64PCM16(inputData);
          realtimeWs.send(JSON.stringify({ type: "audio", data: base64Audio }));
        }
      };
      source.connect(realtimeScriptProcessor);
      realtimeScriptProcessor.connect(realtimeAudioContext.destination);
      console.log("\u{1F3A4} Audio capture started");
      return true;
    } catch (e) {
      console.error("Audio capture error:", e);
      toast("Audio initialization failed: " + e.message, true);
      if (realtimeAudioContext) {
        realtimeAudioContext.close().catch(() => {
        });
        realtimeAudioContext = null;
      }
      return false;
    }
  }
  function stopAudioCapture() {
    stopWaveAnimation();
    analyserNode = null;
    if (realtimeScriptProcessor) {
      realtimeScriptProcessor.disconnect();
      realtimeScriptProcessor = null;
    }
    if (realtimeMediaStream) {
      realtimeMediaStream.getTracks().forEach((t) => t.stop());
      realtimeMediaStream = null;
    }
    if (realtimeAudioContext) {
      realtimeAudioContext.close().catch(() => {
      });
      realtimeAudioContext = null;
    }
    console.log("\u{1F3A4} Audio capture stopped");
  }
  function connectRealtime() {
    const url = getRealtimeWsUrl();
    console.log("\u{1F517} Connecting to realtime:", url);
    realtimeWs = new WebSocket(url);
    realtimeWs.onopen = async () => {
      realtimeReconnectAttempts = 0;
      console.log("\u2705 Realtime connected");
      setStatus("");
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
        console.error("Failed to parse realtime message:", err);
      }
    };
    realtimeWs.onclose = () => {
      console.log("\u{1F50C} Realtime disconnected");
      if (isListening && realtimeReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(2e3 * Math.pow(2, realtimeReconnectAttempts), 3e4);
        realtimeReconnectAttempts++;
        setStatus(`Reconnecting (${realtimeReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(connectRealtime, delay);
      } else if (realtimeReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        toast("Voice connection failed. Please try again.", true);
        stopVoice();
      }
    };
    realtimeWs.onerror = (e) => {
      console.error("Realtime WebSocket error:", e);
    };
  }
  function handleRealtimeMessage(msg) {
    switch (msg.type) {
      case "ready":
        const modeLabel = msg.mode === "hybrid" ? "Hybrid (Claude)" : "Direct";
        console.log(`\u{1F399}\uFE0F Realtime session ready - Mode: ${modeLabel}`);
        updateVoiceStatus("Listening");
        break;
      case "user_speaking":
        setVoiceActive(true);
        updateVoiceStatus("Hearing you...");
        stopAudioPlayback();
        stopWaitingSound();
        currentUserMsg = null;
        currentAssistantMsg = null;
        break;
      case "user_stopped":
        setVoiceActive(false);
        updateVoiceStatus("Processing...");
        playWaitingSound();
        break;
      case "interim":
      case "transcript":
        stopWaitingSound();
        if (msg.text && voiceContent) {
          if (!currentUserMsg) {
            const userMsg = document.createElement("div");
            userMsg.className = "voice-msg user";
            userMsg.textContent = msg.text;
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
      case "processing":
        const engineName = msg.engine || "Spark Opus";
        const statusMsg = msg.message || `Checking with ${engineName}...`;
        console.log(`\u{1F9E0} ${statusMsg}`);
        updateVoiceStatus(statusMsg);
        playWaitingSound();
        if (!currentAssistantMsg) {
          currentAssistantMsg = addVoiceMessage("assistant", statusMsg);
          currentAssistantMsg.classList.add("thinking");
        } else {
          currentAssistantMsg.textContent = statusMsg;
          currentAssistantMsg.classList.add("thinking");
        }
        break;
      case "text_delta":
        stopWaitingSound();
        updateVoiceStatus("Speaking...");
        if (msg.delta) {
          if (!currentAssistantMsg) {
            currentAssistantMsg = addVoiceMessage("assistant", msg.delta);
          } else {
            currentAssistantMsg.textContent += msg.delta;
            currentAssistantMsg.classList.remove("thinking");
          }
          if (voiceContent) voiceContent.scrollTop = voiceContent.scrollHeight;
        }
        break;
      case "text":
        stopWaitingSound();
        if (msg.content) {
          if (!currentAssistantMsg) {
            currentAssistantMsg = addVoiceMessage("assistant", msg.content);
          } else {
            currentAssistantMsg.textContent = msg.content;
            currentAssistantMsg.classList.remove("thinking");
          }
        }
        break;
      case "tts_start":
        console.log("\u{1F50A} Generating speech...");
        updateVoiceStatus("Speaking...");
        stopWaitingSound();
        break;
      case "audio_chunk":
        stopWaitingSound();
        updateVoiceStatus("Speaking...");
        if (msg.data) {
          audioQueue.push(msg.data);
          playAudioQueueTTS();
        }
        break;
      case "audio_delta":
        stopWaitingSound();
        updateVoiceStatus("Speaking...");
        if (msg.data) {
          audioQueue.push(msg.data);
          playAudioQueue();
        }
        break;
      case "audio_done":
        console.log("\u{1F50A} Audio complete");
        break;
      case "tool_call":
        console.log("\u{1F527} Tool call:", msg.name);
        const toolName = msg.name?.replace("get_", "").replace("ask_", "").replace("_", " ") || "info";
        updateVoiceStatus(`Checking ${toolName}...`);
        if (!currentAssistantMsg) {
          currentAssistantMsg = addVoiceMessage("assistant", `Checking ${toolName}...`);
          currentAssistantMsg.classList.add("thinking");
        }
        playWaitingSound();
        break;
      case "done":
        stopWaitingSound();
        currentUserMsg = null;
        currentAssistantMsg = null;
        updateVoiceStatus("Listening");
        break;
      case "error":
        stopWaitingSound();
        console.error("Realtime error:", msg.message);
        toast(msg.message || "Voice error", true);
        updateVoiceStatus("Error");
        break;
      case "disconnected":
        stopWaitingSound();
        if (isListening) {
          toast("Disconnected", true);
        }
        break;
    }
  }
  function startVoice() {
    mode = "voice";
    isListening = true;
    document.body.classList.add("voice-mode");
    bottomEl?.classList.add("voice-active");
    currentUserMsg = null;
    currentAssistantMsg = null;
    updateVoiceStatus("Connecting...");
    setStatus("Connecting...");
    connectRealtime();
  }
  function stopVoice() {
    isListening = false;
    document.body.classList.remove("voice-mode");
    bottomEl?.classList.remove("voice-active");
    voiceBar?.classList.remove("speaking");
    currentUserMsg = null;
    currentAssistantMsg = null;
    stopAudioCapture();
    stopAudioPlayback();
    if (realtimeWs) {
      realtimeWs.send(JSON.stringify({ type: "stop" }));
      realtimeWs.close();
      realtimeWs = null;
    }
    mode = "chat";
  }
  function setVoiceActive(active) {
    voiceBar?.classList.toggle("speaking", active);
  }
  voiceBtn?.addEventListener("click", startVoice);
  closeVoiceBtn?.addEventListener("click", stopVoice);
  textInput?.addEventListener("input", () => {
    const hasText = textInput.value.trim().length > 0 || pendingAttachment;
    sendBtn?.classList.toggle("show", hasText);
    voiceBtn?.classList.toggle("hidden", hasText);
    if (textInput) {
      textInput.style.height = "auto";
      textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
    }
  });
  textInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitText();
    }
  });
  textInput?.addEventListener("focus", () => {
    if (isListening) stopVoice();
    mode = "chat";
    bottomEl?.classList.add("focused");
  });
  textInput?.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement !== textInput) {
        bottomEl?.classList.remove("focused");
      }
    }, 100);
  });
  sendBtn?.addEventListener("click", submitText);
  async function submitText() {
    const text = textInput?.value.trim();
    if (!text || isProcessing) return;
    textInput.value = "";
    textInput.style.height = "auto";
    sendBtn?.classList.remove("show");
    voiceBtn?.classList.remove("hidden");
    await send(text, "chat");
  }
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
      toast("Mic access denied", true);
      return false;
    }
  }
  function releaseMicrophone() {
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    mediaRecorder = null;
  }
  function startRecording() {
    if (!mediaRecorder) {
      initRecorder().then((ok) => ok && startRecording());
      return;
    }
    audioChunks = [];
    mediaRecorder.start();
    recordStart = Date.now();
    mode = "notes";
    document.body.classList.add("notes-mode");
    bottomEl?.classList.add("notes-active");
    timerInterval = setInterval(updateTimer, 1e3);
    updateTimer();
  }
  function stopRecording() {
    if (mediaRecorder?.state !== "recording") return;
    mediaRecorder.stop();
    clearInterval(timerInterval);
    document.body.classList.remove("notes-mode");
    bottomEl?.classList.remove("notes-active");
    mode = "chat";
  }
  function discardRecording() {
    if (mediaRecorder?.state !== "recording") return;
    mediaRecorder.onstop = () => {
      toast("Recording discarded");
      releaseMicrophone();
    };
    mediaRecorder.stop();
    clearInterval(timerInterval);
    audioChunks = [];
    document.body.classList.remove("notes-mode");
    bottomEl?.classList.remove("notes-active");
    mode = "chat";
  }
  function updateTimer() {
    const s = Math.floor((Date.now() - recordStart) / 1e3);
    if (notesTimerEl) notesTimerEl.textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  }
  async function finishRecording() {
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    const duration = Math.floor((Date.now() - recordStart) / 1e3);
    releaseMicrophone();
    addMsg(`\u{1F399}\uFE0F Voice note (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")})`, "system");
    const reader = new FileReader();
    reader.onload = () => sendNote(reader.result.split(",")[1], duration);
    reader.readAsDataURL(blob);
  }
  function sendNote(audio, duration) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast("Not connected", true);
      return;
    }
    isProcessing = true;
    addMsg("Transcribing...", "system");
    ws.send(JSON.stringify({ type: "voice_note", audio, duration }));
  }
  notesBtn?.addEventListener("click", () => {
    if (isListening) stopVoice();
    startRecording();
  });
  closeNotesBtn?.addEventListener("click", stopRecording);
  deleteNotesBtn?.addEventListener("click", discardRecording);
  var chatSessionId = localStorage.getItem("spark_session_id");
  var lastMessageTimestamp = 0;
  var isReconnecting = false;
  async function catchUpMissedMessages() {
    if (pageState !== "chatfeed") return;
    try {
      console.log("\u{1F504} Catching up on missed messages since:", lastMessageTimestamp);
      const res = await fetch(`/api/messages/recent?since=${lastMessageTimestamp}`);
      if (!res.ok) return;
      const data = await res.json();
      const messages = data.messages || [];
      if (messages.length === 0) {
        console.log("\u{1F504} No missed messages");
        return;
      }
      console.log(`\u{1F504} Found ${messages.length} missed message(s)`);
      for (const msg of messages) {
        if (isMessageDisplayed(msg.text)) continue;
        trackDisplayedMessage(msg.text);
        const el = document.createElement("div");
        el.className = `msg ${msg.role === "user" ? "user" : "bot"}`;
        if (msg.role === "user") {
          el.textContent = msg.text;
        } else {
          el.innerHTML = formatMessage(msg.text);
        }
        messagesEl.appendChild(el);
        if (msg.timestamp > lastMessageTimestamp) {
          lastMessageTimestamp = msg.timestamp;
        }
      }
      scrollToBottomIfNeeded();
    } catch (e) {
      console.error("Catch-up failed:", e);
    }
  }
  function connect() {
    let wsUrl = CONFIG.wsUrl;
    if (chatSessionId) {
      wsUrl += (wsUrl.includes("?") ? "&" : "?") + `session=${chatSessionId}`;
    }
    console.log("\u{1F50C} Connecting to:", wsUrl);
    updateSparkStatus("connecting");
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        console.log("\u2705 Chat WebSocket connected");
        updateSparkStatus("connected");
        if (isReconnecting) {
          catchUpMissedMessages();
        }
        isReconnecting = false;
      };
      ws.onclose = (e) => {
        console.log("\u{1F50C} Chat WebSocket closed:", e.code, e.reason);
        updateSparkStatus("disconnected");
        isReconnecting = true;
        setTimeout(connect, 2e3);
      };
      ws.onerror = (e) => {
        console.error("\u274C Chat WebSocket error:", e);
        updateSparkStatus("disconnected");
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          console.log("\u{1F441}\uFE0F Page visible, checking WebSocket...");
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log("\u{1F504} WebSocket stale, reconnecting...");
            connect();
          } else {
            catchUpMissedMessages();
          }
        }
      });
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          console.log("\u{1F4E8} WS received:", data.type, data.content?.slice?.(0, 50) || "");
          handle(data);
        } catch (err) {
          console.error("\u274C WS message error:", err, e.data?.slice?.(0, 100));
        }
      };
    } catch (e) {
      console.error("\u274C Failed to create WebSocket:", e);
      updateSparkStatus("disconnected");
    }
  }
  async function send(text, sendMode) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast("Not connected", true);
      return;
    }
    if (pageState === "intro") {
      if (historyLoadPromise) {
        try {
          await historyLoadPromise;
          console.log("\u{1F4DC} History ready, preloaded:", preloadedHistory?.length || 0, "messages");
        } catch (e) {
          console.log("History load failed, continuing anyway");
        }
      }
      if (!currentSparkMode && preloadedHistory && preloadedHistory.length > 0 && !historyRendered) {
        console.log("\u{1F4DC} Rendering history before first message");
        renderPreloadedHistory();
      }
      showChatFeedPage({ skipHistory: true });
    }
    isProcessing = true;
    updateSparkPillText();
    const el = document.createElement("div");
    el.className = "msg user";
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    trackDisplayedMessage(text);
    showThinking();
    if (currentSparkMode) {
      console.log(`\u{1F4E6} Sending to ${currentSparkMode} mode session`);
      ws.send(JSON.stringify({ type: "mode_message", sparkMode: currentSparkMode, text }));
    } else {
      ws.send(JSON.stringify({ type: "transcript", text, mode: sendMode, model: currentModel }));
    }
  }
  function handle(data) {
    switch (data.type) {
      case "ready":
        if (data.sessionId) {
          chatSessionId = data.sessionId;
          localStorage.setItem("spark_session_id", data.sessionId);
          console.log("\u{1F4CB} Session:", data.sessionId);
        }
        if (data.pending) {
          console.log("\u23F3 Pending request detected - showing loading");
          showThinking();
        }
        console.log("\u2705 Chat ready");
        break;
      case "sync":
        console.log("\u{1F4E1} Sync message:", data.message?.source, data.message?.text?.slice(0, 50));
        refreshHistoryCache();
        if (data.message && data.message.text) {
          if (data.message.timestamp && data.message.timestamp > lastMessageTimestamp) {
            lastMessageTimestamp = data.message.timestamp;
          }
          if (isMessageDisplayed(data.message.text)) {
            console.log("\u{1F4E1} Skipping duplicate sync message (hash match)");
            break;
          }
          if (pageState === "chatfeed") {
            trackDisplayedMessage(data.message.text);
            const el = document.createElement("div");
            el.className = `msg ${data.message.role === "user" ? "user" : "bot"}`;
            if (data.message.role === "user") {
              el.textContent = data.message.text;
            } else {
              el.innerHTML = formatMessage(data.message.text);
            }
            if (data.message.source === "whatsapp") {
              el.title = "From WhatsApp";
            }
            messagesEl.appendChild(el);
            scrollToBottomIfNeeded();
            if (data.message.role === "bot") {
              removeThinking();
            }
          } else if (pageState === "intro") {
            if (data.message.role === "bot") {
              toast("New message from Spark");
            }
          }
        }
        break;
      case "thinking":
        console.log("\u{1F914} Server thinking...");
        if (currentSessionMode && sessionPage.classList.contains("show")) {
          showSessionThinking();
        } else {
          showThinking();
        }
        break;
      case "text":
        console.log("\u2705 Text message received:", data.content?.slice?.(0, 100));
        if (currentSessionMode && sessionPage.classList.contains("show")) {
          removeSessionThinking();
          if (data.content) {
            addSessionMessage("bot", data.content);
            sessionStatus.textContent = "\u25CF Active";
            sessionStatus.classList.add("active");
          }
        } else {
          removeThinking();
          setStatus("");
          const lastSys = messagesEl?.querySelector(".msg.system:last-child");
          if (lastSys?.textContent === "Transcribing...") lastSys.remove();
          if (data.content) {
            addMsg(data.content, "bot");
            console.log("\u2705 Bot message added to DOM");
          } else {
            console.warn("\u26A0\uFE0F Empty text content received");
          }
        }
        break;
      case "transcription":
        const transSys = messagesEl?.querySelector(".msg.system:last-child");
        if (transSys?.textContent === "Transcribing...") transSys.remove();
        addMsg("\u{1F4DD} " + data.text, "bot");
        break;
      case "audio":
        playAudio(data.data);
        break;
      case "done":
        isProcessing = false;
        sessionPageProcessing = false;
        setStatus("");
        updateSparkPillText();
        fetchActiveSessions();
        checkActiveSubagentSessions();
        refreshHistoryCache();
        if (mode === "voice" && !isListening) startVoice();
        break;
      case "error":
        if (currentSessionMode && sessionPage.classList.contains("show")) {
          removeSessionThinking();
          addSessionMessage("bot", `Error: ${data.message || "Something went wrong"}`);
          sessionPageProcessing = false;
        } else {
          removeThinking();
        }
        toast(data.message || "Error", true);
        isProcessing = false;
        setStatus("");
        updateSparkPillText();
        fetchActiveSessions();
        break;
      case "mode_history":
        console.log(`\u{1F4E6} Mode history received for ${data.mode}:`, data.messages?.length || 0, "messages");
        if (data.mode && data.messages) {
          modeHistory[data.mode] = data.messages;
          if (currentSparkMode === data.mode) {
            renderModeHistory(data.mode);
          }
        }
        break;
    }
  }
  async function playAudio(base64) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
      if (currentAudio) try {
        currentAudio.stop();
      } catch {
      }
      currentAudio = audioContext.createBufferSource();
      currentAudio.buffer = buffer;
      currentAudio.connect(audioContext.destination);
      currentAudio.start(0);
    } catch (e) {
      console.error("Audio error:", e);
    }
  }
  var msgMenu = document.getElementById("msg-menu");
  var menuCopy = document.getElementById("menu-copy");
  var menuEdit = document.getElementById("menu-edit");
  var menuDelete = document.getElementById("menu-delete");
  var selectedMsg = null;
  var longPressTimer = null;
  function showMsgMenu(msgEl, x, y) {
    selectedMsg = msgEl;
    msgEl.classList.add("selected");
    const menuWidth = 148;
    const menuHeight = 60;
    const finalX = Math.min(x, window.innerWidth - menuWidth - 10);
    const finalY = Math.max(y - menuHeight - 10, 10);
    msgMenu.style.left = finalX + "px";
    msgMenu.style.top = finalY + "px";
    msgMenu.classList.add("show");
  }
  function hideMsgMenu() {
    msgMenu?.classList.remove("show");
    selectedMsg?.classList.remove("selected");
    selectedMsg = null;
  }
  messagesEl?.addEventListener("touchstart", (e) => {
    const msgEl = e.target.closest(".msg");
    if (!msgEl || msgEl.classList.contains("system") || msgEl.classList.contains("thinking")) return;
    const touch = e.touches[0];
    longPressTimer = setTimeout(() => {
      e.preventDefault();
      showMsgMenu(msgEl, touch.clientX, touch.clientY);
    }, 500);
  }, { passive: false });
  messagesEl?.addEventListener("touchend", () => {
    clearTimeout(longPressTimer);
  });
  messagesEl?.addEventListener("touchmove", () => {
    clearTimeout(longPressTimer);
  });
  document.addEventListener("touchstart", (e) => {
    if (!e.target.closest("#msg-menu") && !e.target.closest(".msg")) {
      hideMsgMenu();
    }
  });
  menuCopy?.addEventListener("click", () => {
    if (!selectedMsg) return;
    const text = selectedMsg.textContent || selectedMsg.innerText;
    navigator.clipboard.writeText(text).then(() => {
      toast("Copied!");
    }).catch(() => {
      toast("Failed to copy", true);
    });
    hideMsgMenu();
  });
  menuEdit?.addEventListener("click", () => {
    if (!selectedMsg) return;
    const text = selectedMsg.textContent || selectedMsg.innerText;
    if (textInput) {
      textInput.value = text;
      textInput.style.height = "auto";
      textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
      sendBtn?.classList.add("show");
      textInput.focus();
    }
    hideMsgMenu();
  });
  menuDelete?.addEventListener("click", () => {
    if (!selectedMsg) return;
    selectedMsg.remove();
    toast("Deleted");
    hideMsgMenu();
  });
  connect();
  loadHistoryInBackground();
  var lastTouchEnd = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
  var pcStatusEl = document.getElementById("pc-status");
  async function checkPcStatus() {
    try {
      const response = await fetch("/api/nodes/status");
      const data = await response.json();
      if (pcStatusEl) {
        pcStatusEl.classList.toggle("connected", data.connected);
        pcStatusEl.title = data.connected ? `${data.nodeName || "PC"} connected` : "PC disconnected";
      }
    } catch (e) {
      console.error("PC status check failed:", e);
      if (pcStatusEl) {
        pcStatusEl.classList.remove("connected");
      }
    }
  }
  checkPcStatus();
  var statusInterval = setInterval(checkPcStatus, 3e4);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
      }
    } else {
      if (!statusInterval) {
        checkPcStatus();
        statusInterval = setInterval(checkPcStatus, 3e4);
      }
    }
  });
  var fastPoll = null;
  pcStatusEl?.addEventListener("click", async () => {
    if (fastPoll) {
      clearInterval(fastPoll);
      fastPoll = null;
    }
    if (pcStatusEl.classList.contains("connected")) {
      toast("PC is already connected");
      return;
    }
    toast("Waking PC...");
    try {
      const response = await fetch("/api/nodes/wake", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        toast("Wake signal sent! Waiting for PC...");
        clearInterval(statusInterval);
        let attempts = 0;
        fastPoll = setInterval(async () => {
          attempts++;
          await checkPcStatus();
          if (pcStatusEl.classList.contains("connected")) {
            toast("PC connected! \u2705");
            clearInterval(fastPoll);
            statusInterval = setInterval(checkPcStatus, 3e4);
          } else if (attempts >= 24) {
            toast("PC did not respond", true);
            clearInterval(fastPoll);
            statusInterval = setInterval(checkPcStatus, 3e4);
          }
        }, 5e3);
      } else {
        toast("Wake failed: " + (data.error || "Unknown error"), true);
      }
    } catch (e) {
      toast("Wake request failed", true);
      console.error("WoL error:", e);
    }
  });
  if (window.visualViewport) {
    let initialHeight = window.visualViewport.height;
    window.visualViewport.addEventListener("resize", () => {
      const diff = initialHeight - window.visualViewport.height;
      document.body.classList.toggle("keyboard-open", diff > 150);
    });
  }
  document.querySelectorAll(".shortcut").forEach((btn) => {
    btn.addEventListener("click", () => {
      const msg = btn.dataset.msg;
      if (msg) send(msg, "chat");
    });
  });
  document.getElementById("articulations-btn")?.addEventListener("click", async () => {
    await enterMode("articulate");
    if (textInput) textInput.placeholder = "Type text to refine...";
    textInput?.focus();
  });
  var activeSubagentSessions = {
    "spark-dev-mode": null,
    "spark-research-mode": null,
    "spark-plan-mode": null,
    "spark-videogen-mode": null
  };
  var buttonToSessionLabel = {
    "devteam-btn": "spark-dev-mode",
    "researcher-btn": "spark-research-mode",
    "plan-btn": "spark-plan-mode",
    "videogen-btn": "spark-videogen-mode"
  };
  var modeToSessionLabel = {
    "dev": "spark-dev-mode",
    "research": "spark-research-mode",
    "plan": "spark-plan-mode",
    "videogen": "spark-videogen-mode"
  };
  async function checkActiveSubagentSessions() {
    try {
      const response = await fetch("/api/active-sessions");
      const data = await response.json();
      activeSubagentSessions["spark-dev-mode"] = null;
      activeSubagentSessions["spark-research-mode"] = null;
      activeSubagentSessions["spark-plan-mode"] = null;
      activeSubagentSessions["spark-videogen-mode"] = null;
      for (const session of data.sessions || []) {
        const label = session.label || "";
        if (label.includes("dev-mode") || session.key?.includes("dev-mode")) {
          activeSubagentSessions["spark-dev-mode"] = session;
        } else if (label.includes("research-mode") || session.key?.includes("research-mode")) {
          activeSubagentSessions["spark-research-mode"] = session;
        } else if (label.includes("plan-mode") || session.key?.includes("plan-mode")) {
          activeSubagentSessions["spark-plan-mode"] = session;
        } else if (label.includes("videogen-mode") || session.key?.includes("videogen-mode")) {
          activeSubagentSessions["spark-videogen-mode"] = session;
        }
      }
      updateSubagentButtonStates();
    } catch (e) {
      console.error("Failed to check active sessions:", e);
    }
  }
  function updateSubagentButtonStates() {
    for (const [btnId, label] of Object.entries(buttonToSessionLabel)) {
      const btn = document.getElementById(btnId);
      if (btn) {
        const isActive = activeSubagentSessions[label] !== null;
        btn.classList.toggle("session-active", isActive);
        const subEl = btn.querySelector(".shortcut-sub");
        if (subEl) {
          if (isActive) {
            const originalText = subEl.dataset.originalText || subEl.textContent;
            subEl.dataset.originalText = originalText;
            subEl.textContent = "\u25CF Session active";
          } else if (subEl.dataset.originalText) {
            subEl.textContent = subEl.dataset.originalText;
          }
        }
      }
    }
  }
  function getActiveSession(mode2) {
    const label = modeToSessionLabel[mode2] || mode2;
    return activeSubagentSessions[label];
  }
  var sessionPage = document.getElementById("session-page");
  var sessionMessagesEl = document.getElementById("session-messages");
  var sessionInput = document.getElementById("session-input");
  var sessionSendBtn = document.getElementById("session-send-btn");
  var sessionBackBtn = document.getElementById("session-back-btn");
  var sessionIcon = document.getElementById("session-icon");
  var sessionTitle = document.getElementById("session-title");
  var sessionStatus = document.getElementById("session-status");
  var currentSessionMode = null;
  var sessionPageProcessing = false;
  function hideSessionPage() {
    sessionPage.classList.remove("show");
    currentSessionMode = null;
    sessionPageProcessing = false;
  }
  function addSessionMessage(type, text) {
    const emptyState = sessionMessagesEl.querySelector(".session-empty-state");
    if (emptyState) emptyState.remove();
    const el = document.createElement("div");
    el.className = `msg ${type}`;
    if (type === "bot") {
      el.innerHTML = formatMessage(text);
    } else {
      el.textContent = text;
    }
    sessionMessagesEl.appendChild(el);
    sessionMessagesEl.scrollTop = sessionMessagesEl.scrollHeight;
    return el;
  }
  function showSessionThinking() {
    removeSessionThinking();
    const el = document.createElement("div");
    el.className = "msg bot thinking";
    el.id = "session-thinking-indicator";
    el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    sessionMessagesEl.appendChild(el);
    sessionMessagesEl.scrollTop = sessionMessagesEl.scrollHeight;
  }
  function removeSessionThinking() {
    document.getElementById("session-thinking-indicator")?.remove();
  }
  async function sendSessionMessage() {
    const text = sessionInput.value.trim();
    if (!text || sessionPageProcessing) return;
    sessionInput.value = "";
    sessionInput.style.height = "auto";
    sessionSendBtn.classList.remove("active");
    sessionPageProcessing = true;
    addSessionMessage("user", text);
    showSessionThinking();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "mode_message",
        sparkMode: currentSessionMode,
        text
      }));
    } else {
      removeSessionThinking();
      addSessionMessage("bot", "Not connected. Please try again.");
      sessionPageProcessing = false;
    }
  }
  sessionInput?.addEventListener("input", () => {
    const hasText = sessionInput.value.trim().length > 0;
    sessionSendBtn?.classList.toggle("active", hasText);
    sessionInput.style.height = "auto";
    sessionInput.style.height = Math.min(sessionInput.scrollHeight, 120) + "px";
  });
  sessionInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendSessionMessage();
    }
  });
  sessionSendBtn?.addEventListener("click", sendSessionMessage);
  sessionBackBtn?.addEventListener("click", hideSessionPage);
  checkActiveSubagentSessions();
  var subagentPollInterval = setInterval(checkActiveSubagentSessions, 1e4);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (subagentPollInterval) {
        clearInterval(subagentPollInterval);
        subagentPollInterval = null;
      }
    } else {
      if (!subagentPollInterval) {
        checkActiveSubagentSessions();
        subagentPollInterval = setInterval(checkActiveSubagentSessions, 1e4);
      }
    }
  });
  function createBottomSheet({ icon, title, subtitle, placeholder, submitText: submitText2, onSubmit, activeSession, onViewSession }) {
    const overlay = document.createElement("div");
    overlay.className = "bottom-sheet-overlay";
    const sheet = document.createElement("div");
    sheet.className = "bottom-sheet";
    const activeSessionHtml = activeSession ? `
    <button class="bottom-sheet-active-session">
      <span class="active-dot">\u25CF</span>
      View Active Session
    </button>
  ` : "";
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
    <button class="bottom-sheet-submit">${submitText2}</button>
  `;
    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
    const input = sheet.querySelector(".bottom-sheet-input");
    const submitBtn = sheet.querySelector(".bottom-sheet-submit");
    const handle2 = sheet.querySelector(".bottom-sheet-handle");
    const activeSessionBtn = sheet.querySelector(".bottom-sheet-active-session");
    function close() {
      sheet.classList.add("closing");
      sheet.classList.remove("visible");
      overlay.classList.remove("visible");
      setTimeout(() => {
        overlay.remove();
        sheet.remove();
      }, 200);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add("visible");
        sheet.classList.add("visible");
        input.focus();
      });
    });
    overlay.addEventListener("click", close);
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    function handleTouchStart(e) {
      const target = e.target;
      if (target === handle2 || target === sheet && sheet.scrollTop === 0) {
        startY = e.touches[0].clientY;
        currentY = startY;
        isDragging = true;
        sheet.style.transition = "none";
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
      sheet.style.transition = "";
      const deltaY = currentY - startY;
      if (deltaY > 100) {
        close();
      } else {
        const isDesktop = window.innerWidth >= 520;
        if (isDesktop) {
          sheet.style.transform = "translateX(-50%) translateY(0)";
        } else {
          sheet.style.transform = "translateY(0)";
        }
      }
    }
    sheet.addEventListener("touchstart", handleTouchStart, { passive: true });
    sheet.addEventListener("touchmove", handleTouchMove, { passive: true });
    sheet.addEventListener("touchend", handleTouchEnd);
    function handleKeydown(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", handleKeydown);
      }
    }
    document.addEventListener("keydown", handleKeydown);
    function handleSubmit() {
      const value = input.value.trim();
      if (!value) {
        input.classList.add("error");
        setTimeout(() => input.classList.remove("error"), 300);
        return;
      }
      close();
      onSubmit(value);
    }
    submitBtn.addEventListener("click", handleSubmit);
    if (activeSessionBtn && onViewSession) {
      activeSessionBtn.addEventListener("click", () => {
        close();
        onViewSession(activeSession);
      });
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
    return { close };
  }
  function viewActiveSession(session) {
    if (!session) return;
    showChatFeedPage();
    const systemMsg = document.createElement("div");
    systemMsg.className = "msg system";
    systemMsg.innerHTML = `
    <strong>Viewing ${session.label || "subagent"} session</strong><br>
    <small style="opacity: 0.7">Session key: ${session.key}</small>
  `;
    messagesEl.appendChild(systemMsg);
    send(`Show me the recent activity from the ${session.label || "subagent"} session (key: ${session.key})`, "chat");
  }
  document.getElementById("devteam-btn")?.addEventListener("click", () => {
    const activeSession = getActiveSession("spark-dev-mode");
    createBottomSheet({
      icon: "\u{1F468}\u200D\u{1F4BB}",
      title: "Dev Mode",
      subtitle: activeSession ? "\u25CF Session active" : "Isolated coding session",
      placeholder: "Describe the task or issue to fix...",
      submitText: "Start Dev Session",
      activeSession,
      onViewSession: viewActiveSession,
      onSubmit: (text) => send(`/dev ${text}`, "chat")
    });
  });
  document.getElementById("researcher-btn")?.addEventListener("click", () => {
    const activeSession = getActiveSession("spark-research-mode");
    createBottomSheet({
      icon: "\u{1F52C}",
      title: "Research Mode",
      subtitle: activeSession ? "\u25CF Session active" : "Deep dive research",
      placeholder: "What topic do you want to research?",
      submitText: "Start Research",
      activeSession,
      onViewSession: viewActiveSession,
      onSubmit: (text) => send(`/research ${text}`, "chat")
    });
  });
  document.getElementById("plan-btn")?.addEventListener("click", () => {
    const activeSession = getActiveSession("spark-plan-mode");
    createBottomSheet({
      icon: "\u{1F4CB}",
      title: "Plan Mode",
      subtitle: activeSession ? "\u25CF Session active" : "Create detailed specs",
      placeholder: "What do you want to plan?",
      submitText: "Start Planning",
      activeSession,
      onViewSession: viewActiveSession,
      onSubmit: (text) => send(`/plan ${text}`, "chat")
    });
  });
  document.getElementById("videogen-btn")?.addEventListener("click", () => {
    showVideoGenModal();
  });
  function showVideoGenModal() {
    const overlay = document.createElement("div");
    overlay.className = "bottom-sheet-overlay";
    const sheet = document.createElement("div");
    sheet.className = "bottom-sheet";
    sheet.innerHTML = `
    <div class="bottom-sheet-handle"></div>
    <div class="bottom-sheet-header">
      <span class="bottom-sheet-icon">\u{1F3AC}</span>
      <div class="bottom-sheet-titles">
        <h2 class="bottom-sheet-title">Video Gen</h2>
        <p class="bottom-sheet-subtitle" id="videogen-subtitle">AI video generation</p>
      </div>
    </div>
    
    <div class="bottom-sheet-row">
      <label class="bottom-sheet-label">Workflow</label>
      <div class="option-selector" id="videogen-workflow">
        <button class="option-pill selected" data-value="text2video">Text \u2192 Video</button>
        <button class="option-pill" data-value="image2video">Image \u2192 Video</button>
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
    const subtitleEl = sheet.querySelector("#videogen-subtitle");
    const workflowSelector = sheet.querySelector("#videogen-workflow");
    const promptRow = sheet.querySelector("#videogen-prompt-row");
    const promptInput = sheet.querySelector("#videogen-prompt");
    const imageRow = sheet.querySelector("#videogen-image-row");
    const imageLabel = sheet.querySelector("#videogen-image-label");
    const imageHint = sheet.querySelector("#videogen-image-hint");
    const uploadArea = sheet.querySelector("#videogen-upload-area");
    const fileInput2 = sheet.querySelector("#videogen-file-input");
    const videoRow = sheet.querySelector("#videogen-video-row");
    const videoUploadArea = sheet.querySelector("#videogen-video-upload-area");
    const videoFileInput = sheet.querySelector("#videogen-video-file-input");
    const videoUrlInput = sheet.querySelector("#videogen-video-url");
    const aspectRow = sheet.querySelector("#videogen-aspect-row");
    const aspectSelector = sheet.querySelector("#videogen-aspect");
    const durationRow = sheet.querySelector("#videogen-duration-row");
    const durationSelector = sheet.querySelector("#videogen-duration");
    const submitBtn = sheet.querySelector("#videogen-submit");
    const handle2 = sheet.querySelector(".bottom-sheet-handle");
    let selectedWorkflow = "text2video";
    let selectedAspect = "16:9";
    let selectedDuration = "5";
    let selectedImage = null;
    let selectedImageData = null;
    let selectedVideo = null;
    let selectedVideoData = null;
    let selectedVideoUrl = null;
    function close() {
      sheet.classList.add("closing");
      sheet.classList.remove("visible");
      overlay.classList.remove("visible");
      setTimeout(() => {
        overlay.remove();
        sheet.remove();
      }, 200);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add("visible");
        sheet.classList.add("visible");
        promptInput.focus();
      });
    });
    overlay.addEventListener("click", close);
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    function handleTouchStart(e) {
      const target = e.target;
      if (target === handle2 || target === sheet && sheet.scrollTop === 0) {
        startY = e.touches[0].clientY;
        currentY = startY;
        isDragging = true;
        sheet.style.transition = "none";
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
      sheet.style.transition = "";
      const deltaY = currentY - startY;
      if (deltaY > 100) {
        close();
      } else {
        const isDesktop = window.innerWidth >= 520;
        if (isDesktop) {
          sheet.style.transform = "translateX(-50%) translateY(0)";
        } else {
          sheet.style.transform = "translateY(0)";
        }
      }
    }
    sheet.addEventListener("touchstart", handleTouchStart, { passive: true });
    sheet.addEventListener("touchmove", handleTouchMove, { passive: true });
    sheet.addEventListener("touchend", handleTouchEnd);
    function handleKeydown(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", handleKeydown);
      }
    }
    document.addEventListener("keydown", handleKeydown);
    function formatFileSizeLocal(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }
    function updateWorkflowUI() {
      promptRow.style.display = "block";
      imageRow.style.display = "none";
      videoRow.style.display = "none";
      aspectRow.style.display = "block";
      durationRow.style.display = "block";
      videoUrlInput.style.display = "none";
      switch (selectedWorkflow) {
        case "text2video":
          subtitleEl.textContent = "Generate video from text prompt";
          promptInput.placeholder = "Describe the video you want to create...";
          submitBtn.textContent = "Generate Video";
          break;
        case "image2video":
          subtitleEl.textContent = "Animate an image into video";
          promptInput.placeholder = "Describe the motion/action (optional)...";
          imageRow.style.display = "block";
          imageLabel.textContent = "Source Image";
          imageHint.textContent = "Image to animate";
          submitBtn.textContent = "Generate Video";
          break;
        case "faceswap":
          subtitleEl.textContent = "Swap face in a video";
          promptRow.style.display = "none";
          imageRow.style.display = "block";
          videoRow.style.display = "block";
          aspectRow.style.display = "none";
          durationRow.style.display = "none";
          imageLabel.textContent = "Face Image";
          imageHint.textContent = "Photo with the face to use";
          videoUrlInput.style.display = "block";
          submitBtn.textContent = "Swap Face";
          break;
      }
    }
    workflowSelector.addEventListener("click", (e) => {
      const pill = e.target.closest(".option-pill");
      if (!pill) return;
      workflowSelector.querySelectorAll(".option-pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      selectedWorkflow = pill.dataset.value;
      updateWorkflowUI();
    });
    aspectSelector.addEventListener("click", (e) => {
      const pill = e.target.closest(".option-pill");
      if (!pill) return;
      aspectSelector.querySelectorAll(".option-pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      selectedAspect = pill.dataset.value;
    });
    durationSelector.addEventListener("click", (e) => {
      const pill = e.target.closest(".option-pill");
      if (!pill) return;
      durationSelector.querySelectorAll(".option-pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      selectedDuration = pill.dataset.value;
    });
    function resetImageUpload() {
      selectedImage = null;
      selectedImageData = null;
      uploadArea.classList.remove("has-image");
      uploadArea.innerHTML = `
      <div class="upload-icon">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      </div>
      <div class="upload-text">Tap to upload image</div>
      <div class="upload-hint" id="videogen-image-hint">${selectedWorkflow === "faceswap" ? "Photo with the face to use" : "Image to animate"}</div>
    `;
      fileInput2.value = "";
    }
    function resetVideoUpload() {
      selectedVideo = null;
      selectedVideoData = null;
      selectedVideoUrl = null;
      videoUploadArea.classList.remove("has-image");
      videoUploadArea.innerHTML = `
      <div class="upload-icon">
        <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
      </div>
      <div class="upload-text">Tap to upload video or paste URL</div>
      <div class="upload-hint">YouTube/video URL or upload file</div>
    `;
      videoFileInput.value = "";
      videoUrlInput.value = "";
    }
    uploadArea.addEventListener("click", () => {
      if (!selectedImage) {
        fileInput2.click();
      }
    });
    fileInput2.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      selectedImage = file;
      const reader = new FileReader();
      reader.onload = (ev) => {
        selectedImageData = ev.target.result;
        uploadArea.classList.add("has-image");
        uploadArea.innerHTML = `
        <div class="image-preview-container">
          <img class="image-preview-thumb" src="${selectedImageData}" alt="Preview">
          <div class="image-preview-info">
            <div class="image-preview-name">${file.name}</div>
            <div class="image-preview-size">${formatFileSizeLocal(file.size)}</div>
          </div>
          <button class="image-remove-btn" id="videogen-remove-image">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
        sheet.querySelector("#videogen-remove-image")?.addEventListener("click", (ev2) => {
          ev2.stopPropagation();
          resetImageUpload();
        });
      };
      reader.readAsDataURL(file);
    });
    videoUploadArea.addEventListener("click", () => {
      if (!selectedVideo && !selectedVideoUrl) {
        videoFileInput.click();
      }
    });
    videoFileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      selectedVideo = file;
      selectedVideoUrl = null;
      const reader = new FileReader();
      reader.onload = (ev) => {
        selectedVideoData = ev.target.result;
        videoUploadArea.classList.add("has-image");
        videoUploadArea.innerHTML = `
        <div class="image-preview-container">
          <div class="upload-icon" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:var(--msg-bot);border-radius:8px;">
            <svg viewBox="0 0 24 24" style="width:30px;height:30px;stroke:var(--text-secondary);fill:none;"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div class="image-preview-info">
            <div class="image-preview-name">${file.name}</div>
            <div class="image-preview-size">${formatFileSizeLocal(file.size)}</div>
          </div>
          <button class="image-remove-btn" id="videogen-remove-video">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
        sheet.querySelector("#videogen-remove-video")?.addEventListener("click", (ev2) => {
          ev2.stopPropagation();
          resetVideoUpload();
        });
      };
      reader.readAsDataURL(file);
    });
    videoUrlInput.addEventListener("input", (e) => {
      const url = e.target.value.trim();
      if (url && (url.includes("youtube.com") || url.includes("youtu.be") || url.includes("http"))) {
        selectedVideoUrl = url;
        selectedVideo = null;
        selectedVideoData = null;
        videoUploadArea.classList.add("has-image");
        videoUploadArea.innerHTML = `
        <div class="image-preview-container">
          <div class="upload-icon" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:var(--msg-bot);border-radius:8px;">
            <svg viewBox="0 0 24 24" style="width:30px;height:30px;stroke:var(--text-secondary);fill:none;"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div class="image-preview-info">
            <div class="image-preview-name" style="word-break:break-all;">${url.length > 40 ? url.substring(0, 40) + "..." : url}</div>
            <div class="image-preview-size">Video URL</div>
          </div>
          <button class="image-remove-btn" id="videogen-remove-video">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
        sheet.querySelector("#videogen-remove-video")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          resetVideoUpload();
        });
      }
    });
    submitBtn.addEventListener("click", () => {
      const prompt = promptInput.value.trim();
      if (selectedWorkflow === "text2video") {
        if (!prompt) {
          promptInput.classList.add("error");
          setTimeout(() => promptInput.classList.remove("error"), 300);
          return;
        }
      } else if (selectedWorkflow === "image2video") {
        if (!selectedImageData) {
          uploadArea.style.borderColor = "var(--red)";
          setTimeout(() => uploadArea.style.borderColor = "", 300);
          return;
        }
      } else if (selectedWorkflow === "faceswap") {
        if (!selectedImageData) {
          uploadArea.style.borderColor = "var(--red)";
          setTimeout(() => uploadArea.style.borderColor = "", 300);
          return;
        }
        if (!selectedVideoData && !selectedVideoUrl) {
          videoUploadArea.style.borderColor = "var(--red)";
          setTimeout(() => videoUploadArea.style.borderColor = "", 300);
          return;
        }
      }
      close();
      showChatFeedPage();
      if (selectedWorkflow === "text2video") {
        let command = `/video --ratio ${selectedAspect} --duration ${selectedDuration}s ${prompt}`;
        send(command, "chat");
      } else if (selectedWorkflow === "image2video") {
        let command = `/video --ratio ${selectedAspect} --duration ${selectedDuration}s`;
        if (prompt) command += ` ${prompt}`;
        sendVideoGenWithImage(command, selectedImageData);
      } else if (selectedWorkflow === "faceswap") {
        let command = `/faceswap`;
        if (selectedVideoUrl) {
          command += ` --video-url ${selectedVideoUrl}`;
        }
        sendFaceSwapRequest(command, selectedImageData, selectedVideoData, selectedVideoUrl);
      }
    });
    promptInput.addEventListener("input", () => {
      promptInput.style.height = "auto";
      promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + "px";
    });
  }
  function sendVideoGenWithImage(command, imageData) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast("Not connected", true);
      return;
    }
    isProcessing = true;
    updateSparkPillText();
    const el = document.createElement("div");
    el.className = "msg user";
    el.textContent = command + " \u{1F4F7}";
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    trackDisplayedMessage(command);
    showThinking();
    ws.send(JSON.stringify({ type: "transcript", text: command, image: imageData, mode: "chat", model: currentModel }));
  }
  function sendFaceSwapRequest(command, imageData, videoData, videoUrl) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast("Not connected", true);
      return;
    }
    isProcessing = true;
    updateSparkPillText();
    const el = document.createElement("div");
    el.className = "msg user";
    el.textContent = command + " \u{1F3AD}\u{1F4F7}\u{1F3AC}";
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    trackDisplayedMessage(command);
    showThinking();
    ws.send(JSON.stringify({
      type: "transcript",
      text: command,
      image: imageData,
      video: videoData,
      videoUrl,
      mode: "chat",
      model: currentModel
    }));
  }
  var originalSend = send;
  send = async function(text, sendMode) {
    if (articulationsMode) {
      await sendArticulation(text);
    } else {
      await originalSend(text, sendMode);
    }
  };
  async function sendArticulation(text) {
    if (!text.trim()) return;
    if (pageState === "intro") {
      showChatFeedPage({ skipHistory: true });
    }
    const userEl = document.createElement("div");
    userEl.className = "msg user";
    userEl.textContent = text;
    messagesEl.appendChild(userEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    showThinking();
    try {
      const response = await fetch("/api/articulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      removeThinking();
      if (data.result) {
        const botEl = document.createElement("div");
        botEl.className = "msg bot";
        botEl.textContent = data.result;
        messagesEl.appendChild(botEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } catch (e) {
      removeThinking();
      toast("Failed to refine text", true);
    }
  }
  document.getElementById("todays-reports-btn")?.addEventListener("click", async () => {
    await enterMode("dailyreports");
    const loadingEl = document.createElement("div");
    loadingEl.className = "msg system";
    loadingEl.textContent = "Loading today's reports...";
    messagesEl.appendChild(loadingEl);
    try {
      const response = await fetch("/api/reports/today");
      const data = await response.json();
      loadingEl.remove();
      if (!data.reports?.length) {
        send("Show me today's reports or generate a new briefing if none exist.", "chat");
        return;
      }
      const headerEl = document.createElement("div");
      headerEl.className = "msg system";
      headerEl.textContent = `\u{1F4CA} Today's Reports (${data.reports.length})`;
      messagesEl.appendChild(headerEl);
      data.reports.forEach((r) => {
        const el = document.createElement("div");
        el.className = "msg bot";
        el.innerHTML = formatMessage(r.summary);
        messagesEl.appendChild(el);
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (e) {
      loadingEl.textContent = "Failed to load reports";
      console.error("Failed to load reports:", e);
    }
  });
  var attachmentPreview = document.getElementById("attachment-preview");
  var attachmentIcon = document.getElementById("attachment-icon");
  var attachmentName = document.getElementById("attachment-name");
  var attachmentSize = document.getElementById("attachment-size");
  var removeAttachmentBtn = document.getElementById("remove-attachment-btn");
  var pendingAttachment = null;
  uploadBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    pendingAttachment = file;
    attachmentName.textContent = file.name;
    attachmentSize.textContent = formatFileSize(file.size);
    if (file.type.startsWith("image/")) {
      attachmentIcon.classList.add("image");
      attachmentIcon.innerHTML = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
    } else {
      attachmentIcon.classList.remove("image");
      attachmentIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
    }
    attachmentPreview?.classList.add("show");
    sendBtn?.classList.add("show");
    voiceBtn?.classList.add("hidden");
    textInput?.focus();
    fileInput.value = "";
  });
  removeAttachmentBtn?.addEventListener("click", () => {
    pendingAttachment = null;
    attachmentPreview?.classList.remove("show");
    if (!textInput?.value.trim()) {
      sendBtn?.classList.remove("show");
      voiceBtn?.classList.remove("hidden");
    }
  });
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }
  submitText = async function() {
    const text = textInput?.value.trim() || "";
    if (!text && !pendingAttachment) return;
    if (isProcessing) return;
    let messageText = text;
    let imageData = null;
    if (pendingAttachment) {
      const file = pendingAttachment;
      try {
        if (file.type.startsWith("image/")) {
          imageData = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(file);
          });
          messageText = text || "What is this image?";
        } else {
          const content = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsText(file);
          });
          const preview = content.slice(0, 2e3) + (content.length > 2e3 ? "..." : "");
          messageText = text ? `${text}

[File: ${file.name}]
${preview}` : `[File: ${file.name}]
${preview}`;
        }
      } catch {
        toast("Failed to read file", true);
        return;
      }
      pendingAttachment = null;
      attachmentPreview?.classList.remove("show");
    }
    if (!messageText) return;
    textInput.value = "";
    textInput.style.height = "auto";
    sendBtn?.classList.remove("show");
    voiceBtn?.classList.remove("hidden");
    if (imageData) {
      sendWithImage(messageText, imageData);
    } else {
      send(messageText, "chat");
    }
  };
  function sendWithImage(text, imageData) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast("Not connected", true);
      return;
    }
    isProcessing = true;
    const userMsg = addMsg(text + " \u{1F4F7}", "user", { userInitiated: true });
    showThinking();
    ws.send(JSON.stringify({ type: "transcript", text, image: imageData, mode: "chat", model: currentModel }));
  }
})();
//# sourceMappingURL=app.bundle.js.map
