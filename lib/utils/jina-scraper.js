/**
 * Jina.ai Website Scraper Utility
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const JINA_API_KEY = process.env.JINA_API_KEY;
const JINA_API_URL = 'https://r.jina.ai';

/**
 * Scrape website content using Jina.ai
 * @param {string} url - Website URL to scrape
 * @returns {Promise<string|null>} - Scraped text content or null if failed
 */
async function scrapeWebsiteWithJina(url) {
  try {
    const jinaUrl = `${JINA_API_URL}/${url}`;
    const response = await fetch(jinaUrl, {
      headers: {
        'Authorization': `Bearer ${JINA_API_KEY}`,
        'X-Return-Format': 'text'
      }
    });

    if (!response.ok) {
      console.warn(`⚠️ Failed to scrape ${url}: ${response.status}`);
      return null;
    }

    const text = await response.text();
    return text;
  } catch (error) {
    console.warn(`⚠️ Error scraping ${url}:`, error);
    return null;
  }
}

module.exports = {
  scrapeWebsiteWithJina
};
