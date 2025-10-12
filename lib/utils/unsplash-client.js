/**
 * Unsplash API Client Utility
 * Used for fetching royalty-free images for blog posts
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const UNSPLASH_API_URL = 'https://api.unsplash.com/search/photos';

/**
 * Search for images on Unsplash
 * @param {string} query - Search query
 * @param {number} perPage - Number of results per query (default: 1)
 * @returns {Promise<Object|null>} - Image data or null if not found
 */
async function searchUnsplash(query, perPage = 1) {
  if (!UNSPLASH_ACCESS_KEY) {
    console.warn('⚠️ UNSPLASH_ACCESS_KEY is not set, skipping image search');
    return null;
  }

  try {
    const url = `${UNSPLASH_API_URL}?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`
      }
    });

    if (!response.ok) {
      console.warn(`⚠️ Unsplash API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      const image = data.results[0];
      return {
        url: image.urls.regular,
        alt: image.alt_description || query,
        photographer: image.user.name,
        photographerUrl: image.user.links.html,
        query: query
      };
    }

    return null;
  } catch (error) {
    console.warn(`⚠️ Failed to fetch image for query: ${query}`, error);
    return null;
  }
}

/**
 * Fetch multiple images based on an array of queries
 * @param {string[]} queries - Array of search queries
 * @returns {Promise<Object[]>} - Array of image data objects
 */
async function searchMultiple(queries) {
  const images = [];
  
  for (const query of queries) {
    const image = await searchUnsplash(query);
    if (image) {
      images.push(image);
      console.log(`✅ Found image for: ${query}`);
    }
  }
  
  console.log(`✅ Retrieved ${images.length} images from Unsplash`);
  return images;
}

module.exports = {
  searchUnsplash,
  searchMultiple
};
