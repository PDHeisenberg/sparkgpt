/**
 * LLM Provider - Fast voice responses via Clawdbot Gateway
 */

import { readFileSync, existsSync } from 'fs';

const SYSTEM_PROMPT = `You are Spark, a voice assistant. Be concise and natural.
- Keep responses under 50 words
- No markdown, bullet points, or formatting
- Speak naturally like in conversation
- Be direct, skip filler phrases`;

export class LLMProvider {
  constructor(config) {
    this.gatewayUrl = config.gatewayUrl || 'http://localhost:18789';
    this.gatewayToken = config.gatewayToken || this.loadGatewayToken();
    // Use fast model - Haiku is quick
    this.model = 'claude-3-5-haiku-20241022';
    
    console.log(`🧠 LLM: ${this.model} via ${this.gatewayUrl}`);
  }

  loadGatewayToken() {
    const configPath = '/home/heisenberg/.clawdbot/clawdbot.json';
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        return config.gateway?.auth?.token;
      } catch {}
    }
    return null;
  }

  async chat(history) {
    const startTime = Date.now();
    
    // Build messages
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6) // Last 6 messages for context
    ];

    try {
      const response = await fetch(`${this.gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.gatewayToken}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: 150,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`Gateway error ${response.status}:`, error);
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || '';
      
      console.log(`🧠 Response in ${Date.now() - startTime}ms: "${reply.slice(0, 50)}..."`);
      return reply;
      
    } catch (error) {
      console.error('LLM error:', error.message);
      return "Sorry, I couldn't process that. Try again?";
    }
  }
}
