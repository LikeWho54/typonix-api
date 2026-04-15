/**
 * Content Generation Routes
 * 
 * Endpoints:
 * - POST /content/generate-titles    - Generate 15 blog post titles
 * - POST /content/generate-blog      - Generate complete blog post with images
 * - POST /content/run-scheduled-blogs - Manually trigger the 2-day scheduler job
 */

const express = require('express');
const router = express.Router();
const { generateContentTitles } = require('../lib/content/generate-titles');
const { generateBlogPost } = require('../lib/content/generate-blog');
const { runBlogGenerationJob } = require('../lib/scheduler');

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

/**
 * POST /content/run-scheduled-blogs
 * Manually trigger the 2-day scheduler job for all eligible subscribed users.
 * Useful for testing — no need to wait for the cron to fire.
 */
router.post('/run-scheduled-blogs', async (req, res) => {
  try {
    console.log('🔧 Manual trigger: running blog generation job now...');
    // Run async — respond immediately so the HTTP request doesn't time out
    res.json({
      success: true,
      message: 'Blog generation job triggered. Check server logs for progress.'
    });
    await runBlogGenerationJob();
  } catch (error) {
    console.error('Error running scheduled blog job:', error);
    // Response already sent above; just log
  }
});

module.exports = router;

