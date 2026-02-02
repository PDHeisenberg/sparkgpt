# UI Modal Improvements Plan

**Created:** 2026-02-02
**Status:** Planning
**Priority:** High

## Problem Statement

Current modals (Plan Mode, Research Mode, Dev Team) have poor mobile UX:
- Centered dialogs are hard to interact with when keyboard opens
- Too much descriptive text clutters the interface  
- Not consistent with the rest of the UI (chat input bar style)
- Hard to navigate on phone with keyboard up

## Design Goals

1. **Full-width input bar** — Match the chat input bar design
2. **Bottom-anchored** — Slide up from bottom, keyboard-friendly
3. **Minimal copy** — Short, clear description (1 line)
4. **Smooth animations** — Native iOS/Android feel
5. **Easy dismissal** — Tap outside, swipe down, or X button

## Current vs Proposed

### Current (Centered Modal)
```
┌─────────────────────────────────────┐
│                                     │
│     ╔═══════════════════════╗       │
│     ║  📋 Plan Mode         ║       │
│     ║                       ║       │
│     ║  Long description...  ║       │
│     ║  - bullet             ║       │
│     ║  - bullet             ║       │
│     ║  - bullet             ║       │
│     ║                       ║       │
│     ║  ┌───────────────────┐║       │
│     ║  │ Textarea          │║       │
│     ║  │                   │║       │
│     ║  └───────────────────┘║       │
│     ║                       ║       │
│     ║  [Cancel]  [Start]    ║       │
│     ╚═══════════════════════╝       │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  Chat input bar               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Proposed (Bottom Sheet)
```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│         (tap to dismiss)            │
│                                     │
│                                     │
├─────────────────────────────────────┤
│  📋 Plan Mode    Create a tech spec │
│  ────────────────────────────────── │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ What do you want to build?      ││
│  └─────────────────────────────────┘│
│                                     │
│  [Cancel]           [Start Planning]│
└─────────────────────────────────────┘
         (keyboard pushes this up)
```

## Implementation Details

### 1. CSS Changes

```css
/* Bottom sheet base */
.mode-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg);
  border-radius: 16px 16px 0 0;
  padding: 20px;
  padding-bottom: calc(20px + env(safe-area-inset-bottom));
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  z-index: 1000;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
}

.mode-sheet.show {
  transform: translateY(0);
}

/* Backdrop */
.mode-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 999;
}

.mode-backdrop.show {
  opacity: 1;
}

/* Header row */
.mode-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.mode-icon {
  font-size: 20px;
}

.mode-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}

.mode-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin-left: auto;
}

/* Input */
.mode-input {
  width: 100%;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  font-size: 16px;
  resize: none;
  min-height: 80px;
  max-height: 150px;
}

/* Actions */
.mode-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.mode-btn {
  flex: 1;
  padding: 14px;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.1s;
}

.mode-btn:active {
  transform: scale(0.98);
  opacity: 0.9;
}

.mode-btn-cancel {
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
}

.mode-btn-primary {
  background: var(--accent);
  border: none;
  color: white;
  flex: 2;
}
```

### 2. Simplified Copy

| Mode | Current | Proposed |
|------|---------|----------|
| **Plan** | "I'll ask 2-3 clarifying questions, then create a detailed technical spec your dev team can execute: • Problem statement & proposed solution • Architecture & implementation breakdown • Security considerations • Edge cases & acceptance criteria" | "Create a tech spec for your dev team" |
| **Research** | "I'll ask you some clarifying questions, then spawn a research agent that will: • Search multiple sources (web, Reddit, Twitter/X, academic) • Apply deep analysis (conjecture + criticism) • Publish a comprehensive HTML report..." | "Deep research with multi-source analysis" |
| **Dev Team** | "Engineer + QA working together. Engineer implements fixes one by one, QA reviews each commit. If QA rejects, Engineer fixes and resubmits. Continues until all tasks are approved." | "Engineer + QA collaborative workflow" |

### 3. JavaScript Changes

Create reusable `showModeSheet(config)` function:

```javascript
function showModeSheet({ 
  id, 
  icon, 
  title, 
  subtitle, 
  placeholder, 
  buttonText, 
  onSubmit 
}) {
  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'mode-backdrop';
  backdrop.id = `${id}-backdrop`;
  
  // Create sheet
  const sheet = document.createElement('div');
  sheet.className = 'mode-sheet';
  sheet.id = `${id}-sheet`;
  
  sheet.innerHTML = `
    <div class="mode-header">
      <span class="mode-icon">${icon}</span>
      <span class="mode-title">${title}</span>
      <span class="mode-subtitle">${subtitle}</span>
    </div>
    <textarea class="mode-input" placeholder="${placeholder}"></textarea>
    <div class="mode-actions">
      <button class="mode-btn mode-btn-cancel">Cancel</button>
      <button class="mode-btn mode-btn-primary">${buttonText}</button>
    </div>
  `;
  
  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  
  // Animate in
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    sheet.classList.add('show');
  });
  
  const input = sheet.querySelector('.mode-input');
  const cancelBtn = sheet.querySelector('.mode-btn-cancel');
  const primaryBtn = sheet.querySelector('.mode-btn-primary');
  
  // Focus input after animation
  setTimeout(() => input.focus(), 300);
  
  // Close function
  const close = () => {
    backdrop.classList.remove('show');
    sheet.classList.remove('show');
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
    }, 300);
  };
  
  // Event handlers
  backdrop.onclick = close;
  cancelBtn.onclick = close;
  
  primaryBtn.onclick = () => {
    const value = input.value.trim();
    if (!value) {
      input.style.borderColor = 'var(--red)';
      input.focus();
      return;
    }
    close();
    onSubmit(value);
  };
  
  // Cmd+Enter to submit
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      primaryBtn.click();
    }
  };
}
```

### 4. Usage

```javascript
// Plan Mode
document.getElementById('plan-btn')?.addEventListener('click', () => {
  showModeSheet({
    id: 'plan',
    icon: '📋',
    title: 'Plan Mode',
    subtitle: 'Create a tech spec',
    placeholder: 'What do you want to build?',
    buttonText: 'Start Planning',
    onSubmit: (topic) => {
      showChatFeedPage();
      send(`/plan ${topic}`, 'chat');
    }
  });
});

// Research Mode
document.getElementById('researcher-btn')?.addEventListener('click', () => {
  showModeSheet({
    id: 'research',
    icon: '🔬',
    title: 'Researcher',
    subtitle: 'Multi-source analysis',
    placeholder: 'What would you like me to research?',
    buttonText: 'Start Research',
    onSubmit: (topic) => {
      showChatFeedPage();
      send(`RESEARCH REQUEST\n\nTOPIC: ${topic}\n\nPlease ask me 2 clarifying questions...`, 'chat');
    }
  });
});

// Dev Team
document.getElementById('devteam-btn')?.addEventListener('click', () => {
  showModeSheet({
    id: 'devteam',
    icon: '⚡',
    title: 'Dev Team',
    subtitle: 'Engineer + QA workflow',
    placeholder: 'Describe the task or issues to fix...',
    buttonText: 'Start Dev Team',
    onSubmit: (task) => {
      showChatFeedPage();
      send(`[Dev Team prompt with task: ${task}]`, 'chat');
    }
  });
});
```

## Testing Checklist

- [ ] Sheet slides up smoothly from bottom
- [ ] Keyboard doesn't obscure input (iOS)
- [ ] Keyboard doesn't obscure input (Android)
- [ ] Tap backdrop dismisses
- [ ] Cancel button dismisses
- [ ] Cmd/Ctrl+Enter submits
- [ ] Empty input shows error state
- [ ] Focus moves to input on open
- [ ] Sheet respects safe-area-inset-bottom
- [ ] Dark mode looks correct
- [ ] Light mode looks correct

## Files to Modify

1. `/home/heisenberg/clawd/spark-voice/public/index.html` — Add CSS
2. `/home/heisenberg/clawd/spark-voice/public/app.js` — Replace modal functions

## Rollout

1. Implement CSS in `<style>` block
2. Create `showModeSheet()` utility function
3. Replace `showPlanModeModal()`, `showResearcherModal()`, `showDevTeamModal()`
4. Test on mobile Safari & Chrome
5. Deploy

---

*Plan created by Spark • Ready for implementation*
