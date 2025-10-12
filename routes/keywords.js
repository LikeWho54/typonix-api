/**
 * Keywords Routes
 * 
 * Express routes for keyword-related operations
 */

const express = require('express');
const { generateKeywordIdeas } = require('../lib/seo/keyword-ideas');

const router = express.Router();

/**
 * POST /keywords/ideas
 * Generate keyword ideas from seed keywords using DataForSEO API
 * 
 * Request body: { uid: string }
 * 
 * Response: {
 *   success: true,
 *   seed_keywords: string[],
 *   total_opportunities_found: number,
 *   analysis_summary: Object,
 *   top_opportunities: Object,
 *   cost: number
 * }
 */
router.post('/ideas', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    console.log(`📊 Starting keyword ideas generation for user ${uid}`);

    const result = await generateKeywordIdeas(uid);

    res.json(result);

  } catch (error) {
    console.error('❌ Error in /keywords/ideas route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate keyword ideas',
      details: error.message
    });
  }
});

module.exports = router;
