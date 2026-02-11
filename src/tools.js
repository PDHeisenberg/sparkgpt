/**
 * Tools for ClawChat Voice Realtime
 * 
 * Provides calendar, time, and Clawdbot integration
 */

import { readFileSync, existsSync } from 'fs';
import { getGatewayToken } from './services/shared.js';

// Google Calendar setup
const GOOGLE_CREDS_PATH = '/home/heisenberg/.clawdbot/google/credentials.json';
const CALENDAR_ID = 'primary';

// Gateway for Claude queries
const GATEWAY_URL = 'http://localhost:18789';

// Load and refresh Google credentials
async function getGoogleAccessToken() {
  if (!existsSync(GOOGLE_CREDS_PATH)) {
    throw new Error('Google credentials not found');
  }
  
  const creds = JSON.parse(readFileSync(GOOGLE_CREDS_PATH, 'utf8'));
  
  // Check if token is expired (tokens last ~1 hour)
  // For simplicity, always refresh
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token refresh failed: ${err}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

/**
 * Get calendar events for today or a date range
 */
export async function getCalendar(args = {}) {
  try {
    const accessToken = await getGoogleAccessToken();
    
    // Default to today in Singapore timezone
    const now = new Date();
    const sgNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
    
    // If no specific date, get today's events
    let timeMin, timeMax;
    
    if (args.date === 'tomorrow') {
      const tomorrow = new Date(sgNow);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      timeMin = tomorrow.toISOString();
      const endOfTomorrow = new Date(tomorrow);
      endOfTomorrow.setHours(23, 59, 59, 999);
      timeMax = endOfTomorrow.toISOString();
    } else if (args.date === 'week') {
      // This week
      const startOfWeek = new Date(sgNow);
      startOfWeek.setHours(0, 0, 0, 0);
      timeMin = startOfWeek.toISOString();
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 7);
      timeMax = endOfWeek.toISOString();
    } else {
      // Today
      const startOfDay = new Date(sgNow);
      startOfDay.setHours(0, 0, 0, 0);
      timeMin = startOfDay.toISOString();
      const endOfDay = new Date(sgNow);
      endOfDay.setHours(23, 59, 59, 999);
      timeMax = endOfDay.toISOString();
    }
    
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events`);
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '10');
    
    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Calendar API error: ${err}`);
    }
    
    const data = await response.json();
    const events = data.items || [];
    
    if (events.length === 0) {
      const dateLabel = args.date === 'tomorrow' ? 'tomorrow' : args.date === 'week' ? 'this week' : 'today';
      return `No events scheduled for ${dateLabel}.`;
    }
    
    // Format events for voice
    const formatted = events.map(event => {
      const start = event.start.dateTime || event.start.date;
      const time = new Date(start).toLocaleTimeString('en-SG', {
        timeZone: 'Asia/Singapore',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      const title = event.summary || 'Untitled event';
      return `${time}: ${title}`;
    });
    
    const dateLabel = args.date === 'tomorrow' ? 'Tomorrow' : args.date === 'week' ? 'This week' : 'Today';
    return `${dateLabel}'s events:\n${formatted.join('\n')}`;
    
  } catch (e) {
    console.error('Calendar error:', e.message);
    return `Sorry, I couldn't access the calendar: ${e.message}`;
  }
}

/**
 * Get current time in Singapore
 */
export function getTime() {
  const now = new Date();
  const sgTime = now.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `It's ${sgTime} in Singapore.`;
}

/**
 * Ask Clawdbot/Claude for complex queries
 */
export async function askClawdbot(args) {
  const { question } = args;
  if (!question) return 'No question provided.';
  
  const gatewayToken = getGatewayToken();
  if (!gatewayToken) return 'Gateway not available.';
  
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [
          { 
            role: 'system', 
            content: 'You are answering a voice query. Be concise (1-2 sentences). Current timezone: Asia/Singapore.' 
          },
          { role: 'user', content: question }
        ],
        max_tokens: 200,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Gateway error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response from Clawdbot.';
    
  } catch (e) {
    console.error('Clawdbot error:', e.message);
    return `Sorry, I couldn't reach Clawdbot: ${e.message}`;
  }
}

/**
 * Tool definitions for OpenAI Realtime API
 */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'get_calendar',
    description: 'Get calendar events. Use for questions about schedule, meetings, appointments, or "what\'s on my calendar".',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          enum: ['today', 'tomorrow', 'week'],
          description: 'Which day to check. Defaults to today.'
        }
      },
      required: []
    }
  },
  {
    type: 'function',
    name: 'get_time',
    description: 'Get the current time in Singapore. Use for questions about what time it is.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    type: 'function',
    name: 'ask_clawdbot',
    description: 'Ask Clawdbot (Claude) for complex questions that need deep knowledge, analysis, or information you don\'t have. Use sparingly - only for things you genuinely can\'t answer.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask Clawdbot'
        }
      },
      required: ['question']
    }
  }
];

/**
 * Execute a tool by name
 */
export async function executeTool(name, args) {
  console.log(`🔧 Executing tool: ${name}`, args);
  
  switch (name) {
    case 'get_calendar':
      return await getCalendar(args);
    case 'get_time':
      return getTime();
    case 'ask_clawdbot':
      return await askClawdbot(args);
    default:
      return `Unknown tool: ${name}`;
  }
}
