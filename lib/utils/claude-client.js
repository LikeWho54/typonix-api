/**
 * Claude (Anthropic) API Client Utility
 * Used for content generation (titles, outlines, blog posts)
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

/**
 * Call Claude API for content generation
 * @param {string} prompt - Generation prompt
 * @param {number} maxTokens - Maximum tokens to generate
 * @param {string|null} systemPrompt - Optional system prompt
 * @param {string|null} model - Optional model override
 * @returns {Promise<string>} - Generated content
 */
async function callClaude(prompt, maxTokens = 3000, systemPrompt = null, model = null) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  console.log(`📡 Calling Claude API (max tokens: ${maxTokens})...`);

  const body = {
    model: model || MODEL,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: prompt
    }]
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', errorText);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.content[0].text;

  console.log('✅ Claude generation completed');
  return content;
}

module.exports = {
  callClaude
};
