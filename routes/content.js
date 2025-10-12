/**
 * Content Generation Routes
 * 
 * Endpoints:
 * - POST /content/generate-titles - Generate 15 blog post titles
 * - POST /content/generate-blog - Generate complete blog post with images
 */

const express = require('express');
const router = express.Router();
const { generateContentTitles } = require('../lib/content/generate-titles');
const { generateBlogPost } = require('../lib/content/generate-blog');

/**
 * POST /content/generate-titles
 * Generate 15 SEO-optimized blog post titles
 * 
 * Body: { uid: string }
 */
router.post('/generate-titles', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        error: 'uid is required in request body'
      });
    }

    console.log(`🎯 Generating content titles for user: ${uid}`);

    const result = await generateContentTitles(uid);

    return res.json(result);

  } catch (error) {
    console.error('Error generating titles:', error);
    return res.status(500).json({
      error: 'Failed to generate titles',
      details: error.message
    });
  }
});

/**
 * POST /content/generate-blog
 * Generate a complete blog post with research, outline, content, and images
 * 
 * Body: { uid: string }
 */
router.post('/generate-blog', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        error: 'uid is required in request body'
      });
    }

    console.log(`📝 Generating blog post for user: ${uid}`);

    const result = await generateBlogPost(uid);

    return res.json(result);

  } catch (error) {
    console.error('Error generating blog:', error);
    return res.status(500).json({
      error: 'Failed to generate blog post',
      details: error.message
    });
  }
});

module.exports = router;
