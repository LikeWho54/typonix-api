/**
 * SEO Analysis Routes
 * 
 * Endpoints:
 * - GET /seo/status - Check analysis status
 * - GET /seo/debug-env - Debug environment variables
 * - POST /seo/start-analysis - Start SEO analysis
 * - POST /seo/process-analysis - Process SEO analysis (alternative endpoint)
 */

const express = require('express');
const router = express.Router();
const { getSEOAnalysisStatus, updateSEOAnalysisStatus } = require('../lib/seo-analysis-status');
const { processSEOAnalysis } = require('../lib/seo/process-seo-analysis');
const { db } = require('../firebase');

/**
 * GET /seo/status
 * Check SEO analysis status for a user
 */
router.get('/status', async (req, res) => {
  try {
    const { uid } = req.query;

    if (!uid) {
      return res.status(400).json({
        error: 'uid query parameter is required'
      });
    }

    const status = await getSEOAnalysisStatus(uid);

    if (!status) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    return res.json({
      status: status.status,
      startedAt: status.startedAt,
      completedAt: status.completedAt,
      error: status.error
    });

  } catch (error) {
    console.error('Error checking SEO analysis status:', error);
    return res.status(500).json({
      error: 'Failed to check SEO analysis status',
      message: error.message
    });
  }
});

/**
 * GET /seo/debug-env
 * Debug endpoint to check environment variables
 * WARNING: Remove or protect this in production!
 */
router.get('/debug-env', (req, res) => {
  const envVars = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN ? '✅ Set' : '❌ Not set',
    DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD ? '✅ Set' : '❌ Not set',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set',
    JINA_API_KEY: process.env.JINA_API_KEY ? '✅ Set' : '❌ Not set',
    FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL ? '✅ Set' : '❌ Not set',
  };

  return res.json({
    message: '⚠️ This endpoint should be removed or protected in production!',
    environment: envVars,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /seo/start-analysis
 * Start SEO analysis for a user
 * 
 * Body: { uid: string }
 */
router.post('/start-analysis', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        error: 'uid is required in request body'
      });
    }

    console.log(`🚀 Starting SEO analysis for user: ${uid}`);

    // Check if user exists and onboarding is completed
    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const userData = userDoc.data();
    if (!userData.onboardingCompleted) {
      return res.status(400).json({
        error: 'Onboarding not completed. Please complete onboarding first.'
      });
    }

    // Update status to processing
    await updateSEOAnalysisStatus(uid, 'processing');

    // Run the analysis asynchronously (don't await - let it run in background)
    processSEOAnalysis(uid)
      .then(() => {
        console.log(`✅ SEO analysis completed for user: ${uid}`);
      })
      .catch((error) => {
        console.error(`❌ SEO analysis failed for user ${uid}:`, error);
      });

    return res.json({
      success: true,
      message: 'SEO analysis started successfully',
      uid,
      status: 'processing'
    });

  } catch (error) {
    console.error('Error starting SEO analysis:', error);
    return res.status(500).json({
      error: 'Failed to start SEO analysis',
      message: error.message
    });
  }
});

/**
 * POST /seo/process-analysis
 * Alternative endpoint to process SEO analysis
 * Same as start-analysis but different name for compatibility
 * 
 * Body: { uid: string }
 */
router.post('/process-analysis', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        error: 'uid is required in request body'
      });
    }

    console.log(`🚀 Processing SEO analysis for user: ${uid}`);

    // Check if user exists and onboarding is completed
    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const userData = userDoc.data();
    if (!userData.onboardingCompleted) {
      return res.status(400).json({
        error: 'Onboarding not completed. Please complete onboarding first.'
      });
    }

    // Update status to processing
    await updateSEOAnalysisStatus(uid, 'processing');

    // Run the analysis asynchronously (don't await - let it run in background)
    processSEOAnalysis(uid)
      .then(() => {
        console.log(`✅ SEO analysis completed for user: ${uid}`);
      })
      .catch((error) => {
        console.error(`❌ SEO analysis failed for user ${uid}:`, error);
      });

    return res.json({
      success: true,
      message: 'SEO analysis processing started',
      uid,
      status: 'processing'
    });

  } catch (error) {
    console.error('Error processing SEO analysis:', error);
    return res.status(500).json({
      error: 'Failed to process SEO analysis',
      message: error.message
    });
  }
});

module.exports = router;
