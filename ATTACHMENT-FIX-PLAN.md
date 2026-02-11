# SparkGPT Attachment & Upload Fix Plan

**Date:** 2026-02-10
**Status:** Ready for implementation

---

## Problem Summary

PDF and document uploads are broken in SparkGPT. There are **two distinct bugs** plus a missing feature (PaddleOCR integration):

### Bug 1: Frontend reads PDFs as text (CRITICAL)
**File:** `public/app.js` — lines ~3952 and ~2649
- Non-image files are read with `readAsText(file)` — this corrupts binary files like PDFs
- The text preview is inlined into the message text directly
- The file is **never sent to the backend** as `fileData` — the backend's `extractPdfText()` is never called
- Result: PDFs show garbled text, DOCX shows XML tags

### Bug 2: File data not sent via WebSocket
**File:** `public/app.js` — main `submitText` override (~line 3970) and `sendSessionMessage` (~line 2680)
- Images are sent as `msg.image` (data URL) ✅
- Files are NOT sent as `msg.file` — the frontend inlines a text preview instead
- The server expects `msg.file = { filename, dataUrl }` but never receives it
- The backend's PDF extraction (`pdf-parse`) and DOCX extraction (`mammoth`) are dead code

### Missing Feature: PaddleOCR for scanned PDFs
- Current `pdf-parse` only extracts embedded text — scanned/image PDFs return empty
- PaddleOCR skill is now installed and can parse scanned documents into structured markdown

---

## Fix Plan

### Phase 1: Frontend — Fix file reading & sending (app.js)

#### 1A. Read all files as DataURL (not text)
Both `submitText` and `sendSessionMessage` need the same fix:

```javascript
// BEFORE (broken):
} else {
  const content = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(file);
  });
  const preview = content.slice(0, 2000) + '...';
  messageText = `${text}\n\n[File: ${file.name}]\n${preview}`;
}

// AFTER (fixed):
} else {
  // Read as data URL for binary-safe transfer to backend
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  // Don't inline content — send as file attachment for server-side extraction
  fileAttachment = { filename: file.name, dataUrl };
  messageText = text || `Parse this file: ${file.name}`;
}
```

#### 1B. Send file data in WebSocket message
Both send paths need to include file data:

```javascript
// In submitText override — add file to ws.send():
ws.send(JSON.stringify({
  type: 'transcript',
  text: messageText,
  image: imageData,      // existing
  file: fileAttachment,  // NEW — { filename, dataUrl }
  mode: 'chat'
}));

// In sendSessionMessage — add file to mode_message:
const payload = {
  type: 'mode_message',
  sparkMode: currentSessionMode,
  sessionId: currentSessionId,
  text: messageText,
  file: fileAttachment   // NEW
};
```

#### 1C. Update UI feedback
- Show file name + size in the user message bubble (not garbled content)
- Add a document icon for PDFs/DOCX in the message

### Phase 2: Backend — Fix extraction pipeline (server.js)

#### 2A. Add PaddleOCR as fallback for scanned PDFs
The current `extractPdfText()` uses `pdf-parse` which fails on scanned docs.

```javascript
async function extractPdfText(dataUrl) {
  const base64Data = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');
  
  // Try text extraction first (fast, works for digital PDFs)
  const data = await pdf(buffer);
  
  if (data.text.trim().length > 50) {
    return data.text; // Digital PDF — text extracted successfully
  }
  
  // Fallback: scanned PDF — use PaddleOCR
  return await extractWithPaddleOCR(dataUrl, 'pdf');
}
```

#### 2B. Add PaddleOCR extraction function

```javascript
async function extractWithPaddleOCR(dataUrl, fileType) {
  const apiUrl = process.env.PADDLEOCR_API_URL;
  const token = process.env.PADDLEOCR_ACCESS_TOKEN;
  
  if (!apiUrl || !token) {
    return '[PaddleOCR not configured — cannot parse scanned document]';
  }
  
  const base64Data = dataUrl.split(',')[1];
  const payload = {
    file: base64Data,
    fileType: fileType === 'pdf' ? 0 : 1,
    useDocOrientationClassify: false,
    useDocUnwarping: false
  };
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000) // 2 min timeout
  });
  
  const result = await response.json();
  
  if (result.errorCode !== 0) {
    throw new Error(`PaddleOCR error: ${result.errorMsg}`);
  }
  
  // Extract markdown from all pages
  return result.result.layoutParsingResults
    .map(page => page.markdown.text)
    .join('\n\n---\n\n');
}
```

#### 2C. Add PaddleOCR for image attachments
When an image is attached, offer OCR extraction option:

```javascript
// In handleTranscript, after image save:
if (hasImage && text.toLowerCase().includes('parse') || text.toLowerCase().includes('ocr') || text.toLowerCase().includes('extract')) {
  const extracted = await extractWithPaddleOCR(imageDataUrl, 'image');
  fullText = `${text}\n\n[Extracted text from image:]\n${extracted}`;
}
```

### Phase 3: Environment & Config

#### 3A. Add PaddleOCR env vars to server startup
In `src/config.js` or `.env`:
```
PADDLEOCR_API_URL=https://l2gapcqfh79di1q4.aistudio-app.com/layout-parsing
PADDLEOCR_ACCESS_TOKEN=b0ebb04f2a38bd0f34973d23f94eea86867b3c5c
```

#### 3B. Update file size/type validation
- Frontend: Accept `.pdf`, `.docx`, `.doc`, `.jpg`, `.png`, `.bmp`, `.tiff`
- Increase max file size if needed (PDFs can be large)
- Add accepted types to the file input: `accept="image/*,.pdf,.docx,.doc"`

---

## Implementation Order

| Step | What | Where | Priority |
|------|------|-------|----------|
| 1 | Fix `readAsText` → `readAsDataURL` for non-image files | `public/app.js` (2 locations) | P0 — CRITICAL |
| 2 | Send `file` object in WebSocket messages | `public/app.js` (2 locations) | P0 — CRITICAL |
| 3 | Show file indicator in user message bubble | `public/app.js` | P1 |
| 4 | Add PaddleOCR extraction function | `src/server.js` | P1 |
| 5 | Wire PaddleOCR as fallback in `extractPdfText` | `src/server.js` | P1 |
| 6 | Add env vars to config/startup | `src/config.js` + `.env` | P1 |
| 7 | Add image OCR extraction path | `src/server.js` | P2 |
| 8 | Update file input accept types | `public/index.html` | P2 |

---

## Testing Plan

1. **Digital PDF** — Upload a normal PDF with selectable text → should extract via `pdf-parse`
2. **Scanned PDF** — Upload a scanned/image PDF → should fallback to PaddleOCR, return markdown
3. **Image with text** — Upload photo of a document → should OCR via PaddleOCR when asked
4. **DOCX** — Upload a Word doc → should extract via `mammoth`
5. **Large file** — Upload a 50+ page PDF → should truncate gracefully
6. **Session page** — Test upload from both main chat and session page views

---

## Notes

- PaddleOCR API is free (3,000 pages/day limit)
- Credentials stored at `~/.config/clawdbot/secrets/paddleocr-*`
- The PaddleOCR skill script (`paddleocr_parse.sh`) is available for CLI use too
- `pdf-parse` stays as primary (fast, no API call) — PaddleOCR only for scanned docs
