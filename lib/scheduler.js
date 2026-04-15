/**
 * Blog Post Scheduler
 *
 * Runs every 2 days at 06:00 AM and generates one blog post
 * for each subscribed user that hasn't had a post generated
 * in the last 48 hours.
 *
 * Subscription field: users where `subscriptionActive === true`
 * Change SUBSCRIPTION_FIELD / SUBSCRIPTION_VALUE below if your
 * Firestore field name differs (e.g. "isPro", "plan", etc.)
 */

const cron = require('node-cron');
const { db } = require('../firebase');
const { generateBlogPost } = require('./content/generate-blog');

// ── Configuration ────────────────────────────────────────────
const SUBSCRIPTION_FIELD = 'subscriptionActive'; // Firestore field
const SUBSCRIPTION_VALUE = true;                 // Required value
const INTERVAL_HOURS = 48;                       // Minimum hours between posts per user
// ─────────────────────────────────────────────────────────────

/**
 * Fetch all subscribed users from Firestore.
 * @returns {Promise<Array<{uid: string, lastBlogGeneratedAt: string|null}>>}
 */
async function getSubscribedUsers() {
  const snapshot = await db
    .collection('users')
    .where(SUBSCRIPTION_FIELD, '==', SUBSCRIPTION_VALUE)
    .get();

  if (snapshot.empty) {
    console.log('📭 No subscribed users found.');
    return [];
  }

  return snapshot.docs.map((doc) => ({
    uid: doc.id,
    lastBlogGeneratedAt: doc.data().lastBlogGeneratedAt || null,
  }));
}

/**
 * Check whether a user is eligible for a new blog post.
 * A user is eligible if they have never had a post generated,
 * or if it has been at least INTERVAL_HOURS since the last one.
 * @param {string|null} lastBlogGeneratedAt - ISO timestamp or null
 * @returns {boolean}
 */
function isEligible(lastBlogGeneratedAt) {
  if (!lastBlogGeneratedAt) return true;

  const lastTime = new Date(lastBlogGeneratedAt).getTime();
  const now = Date.now();
  const hoursSinceLast = (now - lastTime) / (1000 * 60 * 60);

  return hoursSinceLast >= INTERVAL_HOURS;
}

/**
 * Core job: iterate subscribed users and generate a blog post for each eligible one.
 */
async function runBlogGenerationJob() {
  console.log('\n🕐 [Scheduler] Blog generation job started at', new Date().toISOString());

  let users;
  try {
    users = await getSubscribedUsers();
  } catch (err) {
    console.error('❌ [Scheduler] Failed to fetch subscribed users:', err.message);
    return;
  }

  const eligible = users.filter((u) => isEligible(u.lastBlogGeneratedAt));

  console.log(`👥 [Scheduler] Subscribed users: ${users.length} | Eligible: ${eligible.length}`);

  if (eligible.length === 0) {
    console.log('✅ [Scheduler] No users need a new post right now.');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // Process sequentially to avoid hammering external APIs
  for (const user of eligible) {
    console.log(`\n📝 [Scheduler] Generating blog for user: ${user.uid}`);
    try {
      await generateBlogPost(user.uid);

      // Update lastBlogGeneratedAt timestamp
      await db.collection('users').doc(user.uid).update({
        lastBlogGeneratedAt: new Date().toISOString(),
      });

      console.log(`✅ [Scheduler] Blog generated for user: ${user.uid}`);
      successCount++;
    } catch (err) {
      console.error(`❌ [Scheduler] Failed for user ${user.uid}:`, err.message);
      failCount++;
      // Continue with next user — do not abort the whole run
    }
  }

  console.log(
    `\n🏁 [Scheduler] Job complete — ✅ ${successCount} succeeded | ❌ ${failCount} failed\n`
  );
}

/**
 * Start the cron scheduler.
 * Runs at 06:00 AM every 2 days (cron: "0 6 every2days")
 */
function startScheduler() {
  console.log('🗓️  [Scheduler] Blog generation scheduler registered (every 2 days at 06:00 AM)');

  cron.schedule('0 6 */2 * *', async () => {
    await runBlogGenerationJob();
  });
}

module.exports = { startScheduler, runBlogGenerationJob };
