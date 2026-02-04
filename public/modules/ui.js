/**
 * SparkGPT - UI Utilities
 * 
 * Message rendering, toasts, status indicators
 */

// Track recently displayed messages to prevent duplicates (by content hash)
const displayedMessageHashes = new Set();
const MAX_DISPLAYED_HASHES = 50;

export function hashMessageContent(text) {
  // Simple hash for deduplication
  const str = (text || '').trim().slice(0, 200);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

export function trackDisplayedMessage(text) {
  const hash = hashMessageContent(text);
  displayedMessageHashes.add(hash);
  // Clean old entries
  if (displayedMessageHashes.size > MAX_DISPLAYED_HASHES) {
    const iter = displayedMessageHashes.values();
    for (let i = 0; i < 10; i++) displayedMessageHashes.delete(iter.next().value);
  }
}

export function isMessageDisplayed(text) {
  return displayedMessageHashes.has(hashMessageContent(text));
}

export function formatMessage(text) {
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

/**
 * Show toast notification
 * @param {HTMLElement} toastEl - Toast element
 * @param {string} msg - Message to show
 * @param {boolean} isError - Whether it's an error
 */
export function showToast(toastEl, msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = isError ? 'show error' : 'show';
  setTimeout(() => toastEl.className = '', 3000);
}

/**
 * Set status text
 * @param {HTMLElement} statusEl - Status element
 * @param {string} text - Status text
 */
export function setStatusText(statusEl, text) {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.classList.toggle('show', !!text);
  }
}

/**
 * Check if user is scrolled near the bottom
 * @param {HTMLElement} container - Scroll container
 * @param {number} threshold - Pixels from bottom
 */
export function isNearBottom(container, threshold = 100) {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * Auto-scroll only if user is near bottom
 * @param {HTMLElement} container - Scroll container
 */
export function scrollToBottomIfNeeded(container) {
  if (isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Remove thinking indicator
 */
export function removeThinking() {
  document.getElementById('thinking-indicator')?.remove();
}

/**
 * Show thinking indicator
 * @param {HTMLElement} container - Messages container
 */
export function showThinkingIndicator(container) {
  removeThinking();
  const el = document.createElement('div');
  el.className = 'msg bot thinking';
  el.id = 'thinking-indicator';
  el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  container.appendChild(el);
  scrollToBottomIfNeeded(container);
}

/**
 * Create a message element
 * @param {string} text - Message text
 * @param {string} type - 'user' | 'bot' | 'system'
 * @returns {HTMLElement}
 */
export function createMessageElement(text, type) {
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  
  if (type === 'bot') {
    el.innerHTML = formatMessage(text);
  } else {
    el.textContent = text;
  }
  
  return el;
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
