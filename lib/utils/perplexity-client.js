/**
 * Perplexity API Client Utility
 * Used for real-time market research and content research
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

/**
 * Call Perplexity API for research
 * @param {string} prompt - Research prompt
 * @returns {Promise<string>} - Research response
 */
async function callPerplexity(prompt) {
  if (!PERPLEXITY_API_KEY) {
    throw new Error('PERPLEXITY_API_KEY is not set');
  }

  console.log('📡 Calling Perplexity API...');

  const response = await fetch(PERPLEXITY_API_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Perplexity API error:', errorText);
    throw new Error(`Perplexity API error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices[0].message.content;

  console.log('✅ Perplexity research completed');
  return content;
}

module.exports = {
  callPerplexity
};
