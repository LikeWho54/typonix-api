/**
 * Keyword Ideas Module
 * 
 * Uses DataForSEO Keyword Ideas API to generate up to 150 related keyword suggestions
 * based on seed keywords. Calculates opportunity scores and categorizes keywords.
 */

// Dynamic import for node-fetch (ES Module)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { db } = require('../../firebase');

/**
 * Generate keyword ideas from seed keywords using DataForSEO API
 * @param {string} uid - User ID
 * @returns {Promise<Object>} Keyword ideas result with categorized opportunities
 */
async function generateKeywordIdeas(uid) {
  try {
    console.log('🔍 Fetching keyword ideas for user:', uid);

    // Get user data from Firestore
    const userDocRef = db.collection('users').doc(uid);
    const userDocSnap = await userDocRef.get();

    if (!userDocSnap.exists) {
      throw new Error('User not found');
    }

    const userData = userDocSnap.data();

    // Extract required data
    const seedKeywords = userData.seedKeywords || [];
    const targetCountryCode = userData.targetCountryCode || 2840; // Default to US
    const language = userData.language || 'en';
    const websiteUrl = userData.websiteUrl || '';

    if (seedKeywords.length === 0) {
      throw new Error('No seed keywords found for this user');
    }

    console.log(`📊 Requesting keyword ideas for ${seedKeywords.length} seed keywords`);

    // Call DataForSEO Keyword Ideas API
    const credentials = Buffer.from(
      `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`
    ).toString('base64');

    const dataForSeoResponse = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live',
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            keywords: seedKeywords,
            location_code: targetCountryCode,
            language_code: language,
            include_serp_info: false,
            include_seed_keyword: false,
            limit: 150,
            filters: [
              ['keyword_info.search_volume', '>', 0]
            ],
            order_by: ['keyword_info.search_volume,desc']
          }
        ]),
      }
    );

    if (!dataForSeoResponse.ok) {
      const errorData = await dataForSeoResponse.json();
      console.error('❌ DataForSEO API error:', errorData);
      throw new Error(`Failed to fetch keyword ideas from DataForSEO: ${errorData}`);
    }

    const dataForSeoData = await dataForSeoResponse.json();

    if (!dataForSeoData.tasks || dataForSeoData.tasks.length === 0) {
      throw new Error('No results from DataForSEO');
    }

    const task = dataForSeoData.tasks[0];

    if (task.status_code !== 20000) {
      console.error('❌ DataForSEO task failed:', task.status_message);
      throw new Error(task.status_message || 'DataForSEO task failed');
    }

    const items = task.result?.[0]?.items || [];

    console.log(`✅ Retrieved ${items.length} keyword ideas`);

    // Transform the data to a cleaner format
    const keywordIdeas = items.map((item) => ({
      keyword: item.keyword,
      search_volume: item.keyword_info?.search_volume || 0,
      competition: item.keyword_info?.competition || 'N/A',
      competition_level: item.keyword_info?.competition_level || 'UNKNOWN',
      cpc: item.keyword_info?.cpc || 0,
      monthly_searches: item.keyword_info?.monthly_searches || [],
      search_intent: item.search_intent_info?.main_intent || 'unknown',
      difficulty: item.keyword_properties?.keyword_difficulty || 50,
      keyword_difficulty: item.keyword_properties?.keyword_difficulty || null,
      impressions_info: item.impressions_info || null,
      opportunity_score: 0, // Will be calculated below
      targeted: false,
    }));

    // Calculate opportunity scores based on volume, difficulty, and CPC
    keywordIdeas.forEach((kw) => {
      let score = 0;

      // Volume score (0-40 points)
      if (kw.search_volume >= 10000) score += 40;
      else if (kw.search_volume >= 5000) score += 30;
      else if (kw.search_volume >= 1000) score += 20;
      else if (kw.search_volume >= 500) score += 10;
      else score += 5;

      // Difficulty score (0-30 points, lower difficulty = higher score)
      const difficulty = kw.difficulty || 50;
      if (difficulty < 30) score += 30;
      else if (difficulty < 50) score += 20;
      else if (difficulty < 70) score += 10;
      else score += 5;

      // CPC score (0-20 points, higher CPC = more valuable)
      if (kw.cpc >= 5) score += 20;
      else if (kw.cpc >= 2) score += 15;
      else if (kw.cpc >= 1) score += 10;
      else if (kw.cpc >= 0.5) score += 5;

      // Intent score (0-10 points)
      if (kw.search_intent === 'transactional') score += 10;
      else if (kw.search_intent === 'commercial') score += 8;
      else if (kw.search_intent === 'navigational') score += 5;
      else score += 3; // informational

      kw.opportunity_score = score;
    });

    // Categorize keywords into opportunity types
    const topOpportunities = categorizeKeywords(keywordIdeas);

    // Calculate analysis summary
    const analysisSummary = {
      total_opportunities: keywordIdeas.length,
      high_priority_opportunities: topOpportunities.high_priority_opportunities.length,
      high_volume_opportunities: topOpportunities.high_volume_opportunities.length,
      commercial_opportunities: topOpportunities.commercial_opportunities.length,
      low_competition_opportunities: topOpportunities.low_competition_opportunities.length,
      high_value_opportunities: topOpportunities.high_value_opportunities.length,
      content_opportunities: topOpportunities.content_opportunities.length,
      quick_win_opportunities: topOpportunities.quick_win_opportunities.length,
      long_tail_opportunities: topOpportunities.long_tail_opportunities.length,
      average_search_volume: keywordIdeas.reduce((sum, k) => sum + k.search_volume, 0) / keywordIdeas.length,
      average_opportunity_score: keywordIdeas.reduce((sum, k) => sum + k.opportunity_score, 0) / keywordIdeas.length,
    };

    // Store keyword ideas in Firestore with proper structure
    const keywordIdeasData = {
      seed_keywords: seedKeywords,
      location_code: targetCountryCode,
      language_code: language,
      website_url: websiteUrl,
      total_opportunities_found: keywordIdeas.length,
      processed_opportunities: keywordIdeas.length,
      analysis_summary: analysisSummary,
      top_opportunities: topOpportunities,
      cost: task.cost || 0,
      created_at: new Date().toISOString(),
    };

    // Save to users/{uid}/keyword_ideas (subcollection)
    const timestamp = Date.now();
    const keywordIdeasDocRef = db.collection('users').doc(uid)
      .collection('keyword_ideas').doc(timestamp.toString());
    await keywordIdeasDocRef.set(keywordIdeasData);

    // Also save to history for archival purposes
    const keywordIdeasHistoryDocRef = db.collection('users').doc(uid)
      .collection('keyword_ideas_history').doc(timestamp.toString());
    await keywordIdeasHistoryDocRef.set({
      seed_keywords: seedKeywords,
      location_code: targetCountryCode,
      language_code: language,
      website_url: websiteUrl,
      total_ideas: keywordIdeas.length,
      keyword_ideas: keywordIdeas,
      cost: task.cost || 0,
      created_at: new Date().toISOString(),
    });

    console.log(`💾 Stored ${keywordIdeas.length} keyword ideas in Firestore for user ${uid}`);

    return {
      success: true,
      seed_keywords: seedKeywords,
      location_code: targetCountryCode,
      language_code: language,
      website_url: websiteUrl,
      total_opportunities_found: keywordIdeas.length,
      processed_opportunities: keywordIdeas.length,
      analysis_summary: analysisSummary,
      top_opportunities: topOpportunities,
      cost: task.cost || 0,
      stored_at: keywordIdeasData.created_at,
    };

  } catch (error) {
    console.error('❌ Error generating keyword ideas:', error);
    throw error;
  }
}

/**
 * Categorize keywords into different opportunity types
 * @param {Array} keywords - Array of keyword objects with scores
 * @returns {Object} Categorized keyword opportunities
 */
function categorizeKeywords(keywords) {
  return {
    high_priority_opportunities: keywords
      .filter(k => k.opportunity_score >= 70 && k.search_volume >= 1000)
      .sort((a, b) => b.opportunity_score - a.opportunity_score)
      .slice(0, 50),

    high_volume_opportunities: keywords
      .filter(k => k.search_volume >= 5000)
      .sort((a, b) => b.search_volume - a.search_volume)
      .slice(0, 50),

    commercial_opportunities: keywords
      .filter(k => k.search_intent === 'commercial' || k.search_intent === 'transactional')
      .sort((a, b) => b.opportunity_score - a.opportunity_score)
      .slice(0, 50),

    low_competition_opportunities: keywords
      .filter(k => (k.difficulty || 50) < 30 && k.search_volume >= 500)
      .sort((a, b) => b.search_volume - a.search_volume)
      .slice(0, 50),

    high_value_opportunities: keywords
      .filter(k => k.cpc >= 1 && k.search_volume >= 500)
      .sort((a, b) => (b.cpc * b.search_volume) - (a.cpc * a.search_volume))
      .slice(0, 50),

    content_opportunities: keywords
      .filter(k => k.search_intent === 'informational' && k.search_volume >= 500)
      .sort((a, b) => b.search_volume - a.search_volume)
      .slice(0, 50),

    quick_win_opportunities: keywords
      .filter(k => (k.difficulty || 50) < 40 && k.search_volume >= 1000 && k.search_volume < 5000)
      .sort((a, b) => b.opportunity_score - a.opportunity_score)
      .slice(0, 50),

    long_tail_opportunities: keywords
      .filter(k => k.keyword.split(' ').length >= 4 && k.search_volume >= 100 && k.search_volume < 1000)
      .sort((a, b) => b.search_volume - a.search_volume)
      .slice(0, 50),
  };
}

module.exports = {
  generateKeywordIdeas,
};
