/**
 * Generate Content Titles Module
 * 
 * Generates 15 SEO-optimized blog post titles using:
 * 1. Perplexity for market research
 * 2. Claude for title generation
 */

const { db } = require('../../firebase');
const { callPerplexity } = require('../utils/perplexity-client');
const { callClaude } = require('../utils/claude-client');

/**
 * Generate 15 content titles for a user
 * @param {string} uid - User ID
 * @returns {Promise<Object>} - Generated titles and metadata
 */
async function generateContentTitles(uid) {
  console.log(`🎯 Generating content titles for user ${uid}...`);

  // Step 1: Fetch user data from Firestore
  const userDocRef = db.collection('users').doc(uid);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    throw new Error('User not found');
  }

  const userData = userDoc.data();
  const {
    businessName,
    businessType, // 'local' or 'online'
    businessTypeIdentifier, // 'Nutrition Practice', 'Dentist', 'Plumber', etc.
    city,
    targetCountry,
    targetKeywords = []
  } = userData;

  // Validate required fields
  if (!businessName || !businessType || !businessTypeIdentifier) {
    throw new Error('Missing required business information (businessName, businessType, businessTypeIdentifier)');
  }

  // Determine location for content generation
  const isLocalBusiness = businessType === 'local';
  const location = isLocalBusiness ? city : targetCountry;

  if (!location) {
    throw new Error(`Missing location: ${isLocalBusiness ? 'city' : 'targetCountry'} is required`);
  }

  if (targetKeywords.length < 15) {
    throw new Error(`Not enough target keywords. Found ${targetKeywords.length}, need at least 15`);
  }

  // Pick first 15 target keywords
  const selectedKeywords = targetKeywords.slice(0, 15);

  console.log(`📋 Business: ${businessName} (${businessType}) in ${location}`);
  console.log(`🎯 Business model: ${isLocalBusiness ? 'Local' : 'Online'}`);
  console.log(`🎯 Using ${selectedKeywords.length} target keywords`);

  // Step 2: Research with Perplexity
  console.log('🔍 Researching market with Perplexity...');

  const perplexityPrompt = isLocalBusiness
    ? `Research current information for local SEO content planning:

Business Type: ${businessTypeIdentifier}
Location: ${location}

Provide:
1. Current local trends or news related to ${businessTypeIdentifier} in ${location}
2. Common pain points customers have with ${businessTypeIdentifier} services
3. Seasonal or timely considerations (current month/season)
4. Popular benefits or features customers look for
5. Local regulations or certifications that matter

Keep it concise and actionable for content titles.`
    : `Research current information for SEO content planning:

Business Type: ${businessTypeIdentifier}
Target Market: ${location}

Provide:
1. Current industry trends related to ${businessTypeIdentifier} in ${location}
2. Common pain points customers have with ${businessTypeIdentifier} services
3. Seasonal or timely considerations (current month/season)
4. Popular benefits or features customers look for
5. Industry standards or certifications that matter globally

Keep it concise and actionable for content titles.`;

  const marketResearch = await callPerplexity(perplexityPrompt);

  console.log('✅ Market research completed');
  console.log(`📊 Research insights: ${marketResearch.substring(0, 200)}...`);

  // Step 3: Generate titles with Claude
  console.log('✍️ Generating titles with Claude...');

  const keywordsList = selectedKeywords.map((kw, i) => `${i + 1}. "${kw}"`).join('\n');

  const claudePrompt = isLocalBusiness
    ? `You are a local SEO expert creating a content calendar.

BUSINESS INFO:
- Business Name: ${businessName}
- Business Type: ${businessTypeIdentifier}
- Location: ${location}

MARKET RESEARCH (current local insights):
${marketResearch}

TARGET KEYWORDS (generate EXACTLY 1 title per keyword):
${keywordsList}

Generate EXACTLY 15 titles (one per keyword) using these 4 formats. Mix them up:

FORMAT 1: "[Service] in [City]: [Benefit from research]"
Example: "Emergency Plumber in Brooklyn: 24/7 Same-Day Service"

FORMAT 2: "Looking for [Service] in [City]? [Hook from research]"
Example: "Looking for a Family Dentist in Seattle? Here's What You Need to Know"

FORMAT 3: "[City]'s Top/Best [Service]: [Insight from research]"
Example: "Brooklyn's Top 10 Plumbers: How to Choose the Right One"

FORMAT 4: "[Problem from research] in [City]? Why ${businessName} [Solution]"
Example: "Leaky Pipes in Brooklyn? Why Joe's Plumbing is Your Best Call"

IMPORTANT RULES:
- Generate exactly 15 titles (one per keyword above, in order)
- Incorporate insights from the market research
- Use current year (2025) where relevant
- Include timely/seasonal angles from research
- Each title must include "${location}"
- Mix all 4 formats (approximately 3-4 of each format)
- Keep titles between 50-70 characters

OUTPUT JSON (respond with ONLY valid JSON, no markdown):
{
  "titles": [
    {
      "title": "...",
      "format": "location_benefit",
      "targetKeyword": "keyword here",
      "researchInsight": "which research insight was used",
      "length": 58
    }
  ]
}`
    : `You are an SEO expert creating a content calendar for an online business.

BUSINESS INFO:
- Business Name: ${businessName}
- Business Type: ${businessTypeIdentifier}
- Target Market: ${location}

MARKET RESEARCH (industry insights):
${marketResearch}

TARGET KEYWORDS (generate EXACTLY 1 title per keyword):
${keywordsList}

Generate EXACTLY 15 titles (one per keyword) using these 4 formats. Mix them up:

FORMAT 1: "[Benefit from research]: [Service/Product]"
Example: "24/7 Customer Support: Cloud CRM Built for Growing Teams"

FORMAT 2: "How [Service] Helps [Target Audience] [Benefit]"
Example: "How AI Analytics Help Marketers Boost ROI by 300%"

FORMAT 3: "The Ultimate Guide to [Keyword]: [Current Year]"
Example: "The Ultimate Guide to E-commerce SEO: 2025 Edition"

FORMAT 4: "[Problem from research]? Here's Why ${businessName} [Solution]"
Example: "Struggling with Email Deliverability? Here's Why SendGrid Works"

IMPORTANT RULES:
- Generate exactly 15 titles (one per keyword above, in order)
- Incorporate insights from the market research
- Use current year (2025) where relevant
- Include timely/seasonal angles from research
- DO NOT force location into titles (online business targets ${location} broadly)
- Mix all 4 formats (approximately 3-4 of each format)
- Keep titles between 50-70 characters

OUTPUT JSON (respond with ONLY valid JSON, no markdown):
{
  "titles": [
    {
      "title": "...",
      "format": "benefit_service",
      "targetKeyword": "keyword here",
      "researchInsight": "which research insight was used",
      "length": 58
    }
  ]
}`;

  const claudeContent = await callClaude(claudePrompt, 3000);

  console.log('✅ Titles generated');
  console.log(`📝 Raw response: ${claudeContent.substring(0, 200)}...`);

  // Parse JSON from Claude response
  let generatedTitles;
  try {
    // Remove markdown code blocks if present
    const jsonContent = claudeContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    generatedTitles = JSON.parse(jsonContent);
  } catch (parseError) {
    console.error('Failed to parse Claude response:', claudeContent);
    throw new Error('Failed to parse Claude response as JSON');
  }

  // Validate we got exactly 15 titles
  if (!generatedTitles.titles || generatedTitles.titles.length !== 15) {
    console.error(`Expected 15 titles, got ${generatedTitles.titles?.length || 0}`);
    throw new Error(`Expected 15 titles, got ${generatedTitles.titles?.length || 0}`);
  }

  console.log(`✅ Validated ${generatedTitles.titles.length} titles`);

  // Step 4: Save to Firestore
  const contentPlanId = Date.now().toString();
  const contentPlanRef = db.collection('users').doc(uid).collection('content_plans').doc(contentPlanId);

  const contentPlan = {
    titles: generatedTitles.titles,
    marketResearch,
    businessName,
    businessType, // 'local' or 'online'
    businessTypeIdentifier, // 'Nutrition Practice', 'Dentist', etc.
    city: isLocalBusiness ? location : '',
    targetCountry: isLocalBusiness ? targetCountry : location,
    location,
    createdAt: new Date().toISOString(),
    status: 'draft'
  };

  await contentPlanRef.set(contentPlan);

  console.log(`✅ Content plan saved with ID: ${contentPlanId}`);

  return {
    success: true,
    contentPlanId,
    titles: generatedTitles.titles,
    marketResearch
  };
}

module.exports = {
  generateContentTitles
};
