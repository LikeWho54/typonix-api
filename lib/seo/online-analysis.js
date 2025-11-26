/**
 * Online Business SEO Analysis Module
 *
 * Handles SEO analysis for online businesses (e-commerce, SaaS, etc.).
 * Uses DataForSEO API with location_code for country-level targeting.
 */

const { db } = require('../../firebase');
const { scrapeWebsiteWithJina } = require('../utils/jina-scraper');
const { getEmbedding, cosineSimilarity } = require('../utils/openai-embeddings');
const { callCompetitorsDomain, getLocationCode } = require('../utils/dataforseo-client');

/**
 * Check if domain should be excluded from competitor analysis
 */
function isExcludedDomain(domain) {
  const excludedDomains = [
    'wikipedia.org',
    'facebook.com',
    'yelp.com',
    'yellowpages.com',
    'tripadvisor.com',
    'amazon.com',
    'ebay.com',
    'linkedin.com',
    'youtube.com',
    'reddit.com',
    'quora.com',
    'medium.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'pinterest.com',
    'tiktok.com',
    'indeed.com',
    'glassdoor.com',
    'bbb.org',
  ];

  const domainLower = domain.toLowerCase();

  // Check specific excluded domains
  if (excludedDomains.some(excluded => domainLower.includes(excluded))) {
    return true;
  }

  // Check for .gov and .edu domains
  if (domainLower.endsWith('.gov') || domainLower.endsWith('.edu')) {
    return true;
  }

  return false;
}

/**
 * Process ONLINE business SEO analysis
 * Uses Competitors Domain API to discover competitors, then ranks by similarity
 */
async function processOnlineBusinessSEO(userData, uid = null) {
  console.log('🌐 Processing ONLINE business SEO analysis...');

  const { targetCountryCode, language, businessName, websiteUrl, competitors } = userData;

  // Validate required fields
  if (!targetCountryCode) {
    throw new Error('Target country code is required for online business analysis');
  }

  if (!websiteUrl) {
    throw new Error('Website URL is required for online business competitor discovery');
  }

  const locationCode = getLocationCode(targetCountryCode);

  console.log(`🌍 Analyzing for: ${businessName}`);
  console.log(`🌍 Target Country: ${targetCountryCode} (Location Code: ${locationCode})`);
  console.log(`🌍 Website: ${websiteUrl}`);

  // Extract domain from URL
  const userDomain = new URL(websiteUrl).hostname.replace('www.', '');
  console.log(`🔍 Discovering competitors for: ${userDomain}`);

  // Step 1: Call Competitors Domain API to discover competitors
  let competitorsData = await callCompetitorsDomain(
    userDomain,
    locationCode,
    language || 'en',
    100 // Get up to 100 competitors
  );

  let taskResult = competitorsData.tasks[0];
  let result = taskResult.result?.[0];
  let competitorItems = result?.items || [];

  console.log(`📊 Found ${competitorItems.length} potential competitors from main domain`);

  // FALLBACK: If no competitors found from main domain, try user-inputted competitors
  if (competitorItems.length === 0 && competitors && competitors.length > 0) {
    console.log(`⚠️ No competitors found from main domain, trying user-inputted competitors...`);
    console.log(`📋 User has ${competitors.length} inputted competitor(s)`);

    // Try each user-inputted competitor
    for (const competitorUrl of competitors) {
      try {
        // Normalize URL - add https:// if missing
        let normalizedUrl = competitorUrl.trim();
        if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
          normalizedUrl = `https://${normalizedUrl}`;
        }

        const competitorDomain = new URL(normalizedUrl).hostname.replace('www.', '');
        console.log(`🔍 Trying competitor: ${competitorDomain}`);

        const fallbackData = await callCompetitorsDomain(
          competitorDomain,
          locationCode,
          language || 'en',
          100
        );

        const fallbackResult = fallbackData.tasks[0].result?.[0];
        const fallbackItems = fallbackResult?.items || [];

        if (fallbackItems.length > 0) {
          console.log(`✅ Found ${fallbackItems.length} competitors from ${competitorDomain}`);
          competitorsData = fallbackData;
          taskResult = fallbackData.tasks[0];
          result = fallbackResult;
          competitorItems = fallbackItems;
          break; // Stop after finding the first successful competitor
        } else {
          console.log(`⚠️ No competitors found from ${competitorDomain}, trying next...`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to get competitors from ${competitorUrl}:`, error);
      }
    }

    if (competitorItems.length === 0) {
      console.log(`⚠️ No competitors found from any user-inputted competitors`);
    }
  }

  console.log(`📊 Total potential competitors: ${competitorItems.length}`);

  // Step 2: Filter out excluded domains and filter by traffic/keywords
  const filteredCompetitors = competitorItems
    .filter((item) => {
      if (!item.domain) return false;

      // Exclude common platforms
      if (isExcludedDomain(item.domain)) return false;

      // Filter out domains with excessive traffic or keywords (likely course platforms, social media, etc.)
      const metrics = item.metrics?.organic || {};
      const etv = metrics.etv || 0; // Estimated traffic value
      const count = metrics.count || 0; // Number of ranked keywords

      // Exclude if ETV > $100k or ranking for > 50k keywords
      if (etv > 100000 || count > 50000) {
        console.log(`🚫 Filtering out ${item.domain} (ETV: $${etv}, Keywords: ${count})`);
        return false;
      }

      return true;
    })
    .map((item) => ({
      domain: item.domain,
      metrics: item.metrics
    }));

  console.log(`✅ Filtered to ${filteredCompetitors.length} competitors (excluded big sites and high-traffic platforms)`);

  // Step 3: If user has uid, fetch services and perform similarity analysis
  let topCompetitors;

  if (uid) {
    console.log('🔍 Fetching user services for similarity analysis...');

    try {
      // Fetch user document to get services array
      const userDocRef = db.collection('users').doc(uid);
      const userDoc = await userDocRef.get();

      if (!userDoc.exists) {
        throw new Error('User document not found');
      }

      const userDocData = userDoc.data();
      const servicesArray = userDocData.services || [];
      const userSelectedCompetitors = userDocData.competitors || [];

      console.log(`📋 Found ${servicesArray.length} services in user document`);
      console.log(`👤 Found ${userSelectedCompetitors.length} user-selected competitors`);

      // Extract services text
      const services = [];
      servicesArray.forEach((service) => {
        if (service.name) services.push(service.name);
        if (service.serviceName) services.push(service.serviceName);
        if (service.title) services.push(service.title);
        if (service.description) services.push(service.description);
        if (typeof service === 'string') services.push(service);
      });

      console.log(`📝 Extracted ${services.length} service texts from ${servicesArray.length} services`);

      if (services.length === 0) {
        console.log('⚠️ No services found, skipping similarity analysis');
        topCompetitors = filteredCompetitors.slice(0, 10).map((item) => ({
          domain: item.domain,
          metrics: item.metrics
        }));
      } else {
        // Mash all services into one text
        const servicesText = services.join(' ');
        console.log(`📋 Combined ${services.length} services (${servicesText.length} characters)`);

        console.log('🔍 Performing similarity analysis based on services...');

        // Get embedding for user's services
        const userEmbedding = await getEmbedding(servicesText);

        // Scrape all competitor websites in parallel
        console.log(`📍 Scraping ${filteredCompetitors.length} competitor websites...`);

        const scrapeResults = await Promise.all(
          filteredCompetitors.map(async (item) => {
            const fullUrl = `https://${item.domain}`;
            const scrapedText = await scrapeWebsiteWithJina(fullUrl);
            return {
              item,
              scrapedText,
              scraped: !!scrapedText && scrapedText.trim().length > 0
            };
          })
        );

        console.log(`✅ Completed scraping ${scrapeResults.length} websites`);

        // Filter out failed scrapes and prepare for batch embedding
        const validScrapes = scrapeResults.filter(r => r.scraped);
        console.log(`📊 ${validScrapes.length} websites successfully scraped`);

        let competitorAnalysis = [];

        if (validScrapes.length > 0) {
          // Batch process embeddings for all scraped texts
          const scrapedTexts = validScrapes.map(r => r.scrapedText);

          console.log(`🔄 Batch processing embeddings for ${scrapedTexts.length} competitor websites...`);
          const competitorEmbeddings = await getEmbedding(scrapedTexts);

          // Calculate similarities
          competitorAnalysis = validScrapes.map((result, index) => {
            const similarity = cosineSimilarity(userEmbedding, competitorEmbeddings[index]);
            return {
              ...result.item,
              similarity,
              scraped: true,
              scrapedTextLength: result.scrapedText.length
            };
          });

          // Add failed scrapes with 0 similarity
          scrapeResults.forEach(result => {
            if (!result.scraped) {
              competitorAnalysis.push({
                ...result.item,
                similarity: 0,
                scraped: false
              });
            }
          });
        } else {
          // All scrapes failed
          competitorAnalysis = scrapeResults.map(r => ({
            ...r.item,
            similarity: 0,
            scraped: false
          }));
        }

        console.log(`✅ Completed similarity analysis for ${competitorAnalysis.length} competitors`);

        // Sort by similarity
        let sortedBySimilarity = competitorAnalysis
          .filter((c) => c.scraped)
          .sort((a, b) => b.similarity - a.similarity);

        console.log(`✅ Ranked ${sortedBySimilarity.length} competitors by similarity to services`);

        // GUARANTEE user-selected competitors are included
        // Normalize user-selected URLs to domain format
        const userSelectedDomains = new Set(
          userSelectedCompetitors.map(url => {
            try {
              // Handle URLs with or without protocol
              let normalizedUrl = url.trim();
              if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
                normalizedUrl = `https://${normalizedUrl}`;
              }
              return new URL(normalizedUrl).hostname.replace('www.', '').toLowerCase();
            } catch (e) {
              return url.toLowerCase();
            }
          })
        );

        const guaranteedCompetitors = [];
        const discoveredCompetitors = [];

        sortedBySimilarity.forEach(item => {
          const itemDomain = (item.domain || '').toLowerCase();
          if (userSelectedDomains.has(itemDomain)) {
            guaranteedCompetitors.push({
              ...item,
              userSelected: true  // Mark as user-selected
            });
          } else {
            discoveredCompetitors.push(item);
          }
        });

        console.log(`✅ Guaranteed ${guaranteedCompetitors.length} user-selected competitors`);
        console.log(`📊 Available ${discoveredCompetitors.length} discovered competitors`);

        // Combine: user-selected first, then fill with discovered up to 10 total
        const remainingSlots = Math.max(0, 10 - guaranteedCompetitors.length);
        const finalCompetitors = [
          ...guaranteedCompetitors,
          ...discoveredCompetitors.slice(0, remainingSlots)
        ];

        console.log(`✅ Final list: ${guaranteedCompetitors.length} user-selected + ${Math.min(remainingSlots, discoveredCompetitors.length)} discovered = ${finalCompetitors.length} total`);

        topCompetitors = finalCompetitors.map((item) => ({
          domain: item.domain,
          similarity: item.similarity,
          scrapedTextLength: item.scrapedTextLength,
          metrics: item.metrics,
          userSelected: item.userSelected || false
        }));
      }
    } catch (error) {
      console.error('⚠️ Error fetching services or performing similarity analysis:', error);

      // Fallback to top 10 competitors
      topCompetitors = filteredCompetitors.slice(0, 10).map((item) => ({
        domain: item.domain,
        metrics: item.metrics
      }));
    }
  } else {
    // No uid provided, just use top 10 filtered competitors
    console.log('⚠️ No uid provided, using top 10 filtered competitors');

    topCompetitors = filteredCompetitors.slice(0, 10).map((item) => ({
      domain: item.domain,
      metrics: item.metrics
    }));
  }

  const analysisResult = {
    processedAt: new Date().toISOString(),
    businessType: 'online',
    location: {
      locationCode,
      targetCountryCode,
    },
    keywordAnalysis: [{
      userDomain,
      totalCompetitorsFound: competitorItems.length,
      filteredCompetitorsCount: filteredCompetitors.length,
      topCompetitors
    }],
    totalCost: competitorsData.cost,
    summary: {
      totalKeywords: 0,
      totalCompetitors: topCompetitors.length,
      totalCompetitorsDiscovered: competitorItems.length
    },
  };

  console.log('✅ Online business SEO analysis completed');
  return analysisResult;
}

module.exports = {
  processOnlineBusinessSEO
};
