/**
 * SEO Analysis Status Management
 */

const { db } = require('../firebase');

/**
 * Update SEO analysis status for a user
 * @param {string} uid - User ID
 * @param {string} status - Status: 'idle', 'pending', 'processing', 'completed', 'failed'
 * @param {string} error - Optional error message
 * @returns {Promise<void>}
 */
async function updateSEOAnalysisStatus(uid, status, error = null) {
  const userDocRef = db.collection('users').doc(uid);

  const update = {
    seoAnalysisStatus: status,
  };

  if (status === 'processing') {
    update.seoAnalysisStartedAt = new Date();
  }

  if (status === 'completed' || status === 'failed') {
    update.seoAnalysisCompletedAt = new Date();
  }

  if (error) {
    update.seoAnalysisError = error;
  }

  await userDocRef.update(update);
}

/**
 * Get current SEO analysis status for a user
 * @param {string} uid - User ID
 * @returns {Promise<Object|null>} - Status object or null if user not found
 */
async function getSEOAnalysisStatus(uid) {
  const userDocRef = db.collection('users').doc(uid);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    return null;
  }

  const data = userDoc.data();
  return {
    status: data.seoAnalysisStatus || 'idle',
    startedAt: data.seoAnalysisStartedAt,
    completedAt: data.seoAnalysisCompletedAt,
    error: data.seoAnalysisError,
  };
}

module.exports = {
  updateSEOAnalysisStatus,
  getSEOAnalysisStatus
};
