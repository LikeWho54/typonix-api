/**
 * OpenAI Embeddings Utility
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Get OpenAI embedding for text (single or batch)
 * @param {string|string[]} input - Text or array of texts
 * @returns {Promise<number[]|number[][]>} - Embedding vector(s)
 */
async function getEmbedding(input) {
  const isBatch = Array.isArray(input);
  const processedInput = isBatch
    ? input.map(t => t.slice(0, 8000)) // Limit each text to ~8k chars
    : input.slice(0, 8000);

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: processedInput
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid response format from OpenAI API');
  }

  if (isBatch) {
    // Return array of embeddings in correct order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);
  } else {
    // Return single embedding
    return data.data[0].embedding;
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} - Similarity score between 0 and 1
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  getEmbedding,
  cosineSimilarity
};
