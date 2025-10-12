/**
 * Local Business SEO Analysis Module
 *
 * Handles SEO analysis for brick-and-mortar businesses using location coordinates.
 * Uses DataForSEO API with latitude/longitude for precise local targeting.
 */

const { db } = require('../../firebase');
const { scrapeWebsiteWithJina } = require('../utils/jina-scraper');
const { getEmbedding, cosineSimilarity } = require('../utils/openai-embeddings');
const { callDataForSEOMaps, callDomainIntersection } = require('../utils/dataforseo-client');

/**
 * Helper function to remove undefined values from object
 * Firestore Admin SDK doesn't allow undefined values
 */
function removeUndefined(obj) {
  const cleaned = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      cleaned[key] = obj[key];
    }
  }
  return cleaned;
}

/**
 * Check if domain should be excluded from competitor analysis
 */
function isExcludedDomain(domain) {
  const excludedDomains = [
    'wikipedia.org', 'facebook.com', 'yelp.com', 'yellowpages.com',
    'tripadvisor.com', 'foursquare.com', 'mapquest.com', 'thumbtack.com',
    'angieslist.com', 'bbb.org', 'indeed.com', 'glassdoor.com',
    'linkedin.com', 'youtube.com', 'amazon.com', 'ebay.com',
  ];

  const domainLower = domain.toLowerCase();

  if (excludedDomains.some(excluded => domainLower.includes(excluded))) {
    return true;
  }

  if (domainLower.endsWith('.gov') || domainLower.endsWith('.edu')) {
    return true;
  }

  return false;
}

/**
 * Process LOCAL business SEO analysis
 */
async function processLocalBusinessSEO(userData, uid = null) {
  console.log('🏪 Processing LOCAL business SEO analysis...');

  const { latitude, longitude, language, businessTypeIdentifier, businessName } = userData;

  // Validate required fields
  if (!latitude || !longitude) {
    throw new Error('Latitude and longitude are required for local business analysis');
  }

  if (!businessTypeIdentifier) {
    throw new Error('Business type identifier is required');
  }

  console.log(`📍 Analyzing for: ${businessName}`);
  console.log(`📍 Location: ${latitude}, ${longitude}`);
  console.log(`📍 Business Type: ${businessTypeIdentifier}`);

  // Build DataForSEO Google Maps task
  const task = {
    language_code: language || 'en',
    location_coordinate: `${latitude},${longitude},12z`,
    keyword: businessTypeIdentifier,
    depth: 30,
    search_this_area: false
  };

  // Call DataForSEO Maps API
  const response = await callDataForSEOMaps([task]);

  // Process results
  const taskResult = response.tasks[0];
  const result = taskResult.result?.[0];

  const businessResults = result?.items?.filter(item => item.type === 'maps_search') || [];
  console.log(`📊 Found ${businessResults.length} local businesses`);

  // Filter businesses
  const excludedDomains = [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
    'linkedin.com', 'youtube.com', 'tiktok.com', 'pinterest.com', 'snapchat.com'
  ];

  const filteredBusinesses = businessResults.filter(item => {
    if (!item.url) return false;
    const urlLower = item.url.toLowerCase();
    return !excludedDomains.some(excluded => urlLower.includes(excluded));
  });

  // Remove duplicates
  const seenUrls = new Set();
  const uniqueBusinesses = filteredBusinesses.filter(item => {
    const url = item.url.toLowerCase();
    if (seenUrls.has(url)) return false;
    seenUrls.add(url);
    return true;
  });

  console.log(`✅ Filtered to ${uniqueBusinesses.length} businesses with unique real websites`);

  // Perform similarity analysis if uid provided
  let topCompetitors;

  if (uid) {
    console.log('🔍 Fetching user services for similarity analysis...');

    try {
      const userDocRef = db.collection('users').doc(uid);
      const userDoc = await userDocRef.get();

      if (!userDoc.exists) {
        throw new Error('User document not found');
      }

      const userDocData = userDoc.data();
      const servicesArray = userDocData.services || [];

      console.log(`📋 Found ${servicesArray.length} services in user document`);

      // Extract services text
      const services = [];
      servicesArray.forEach(service => {
        if (service.name) services.push(service.name);
        if (service.serviceName) services.push(service.serviceName);
        if (service.title) services.push(service.title);
        if (service.description) services.push(service.description);
        if (typeof service === 'string') services.push(service);
      });

      console.log(`📝 Extracted ${services.length} service texts`);

      if (services.length === 0) {
        console.log('⚠️ No services found, skipping similarity analysis');
        topCompetitors = uniqueBusinesses.slice(0, 20).map(item => removeUndefined({
          title: item.title || 'Unknown',
          placeId: item.place_id || null,
          address: item.address,
          url: item.url,
          phone: item.phone,
          rating: item.rating?.value,
          reviewsCount: item.rating?.votes_count,
          category: item.category,
          latitude: item.latitude,
          longitude: item.longitude
        }));
      } else {
        // Perform similarity analysis
        const servicesText = services.join(' ');
        console.log(`📋 Combined ${services.length} services (${servicesText.length} characters)`);

        const userEmbedding = await getEmbedding(servicesText);

        console.log(`📍 Scraping ${uniqueBusinesses.length} competitor websites...`);

        const competitorAnalysis = [];
        const batchSize = 20;

        for (let i = 0; i < uniqueBusinesses.length; i += batchSize) {
          const batch = uniqueBusinesses.slice(i, i + batchSize);

          const batchResults = await Promise.all(
            batch.map(async (item) => {
              const scrapedText = await scrapeWebsiteWithJina(item.url);

              if (!scrapedText || scrapedText.trim().length === 0) {
                return { ...item, similarity: 0, scraped: false };
              }

              const competitorEmbedding = await getEmbedding(scrapedText);
              const similarity = cosineSimilarity(userEmbedding, competitorEmbedding);

              return {
                ...item,
                similarity,
                scraped: true,
                scrapedTextLength: scrapedText.length
              };
            })
          );

          competitorAnalysis.push(...batchResults);
          console.log(`✅ Processed ${Math.min(i + batchSize, uniqueBusinesses.length)} / ${uniqueBusinesses.length} websites`);
        }

        // Sort by similarity
        const sortedBySimilarity = competitorAnalysis
          .filter(c => c.scraped)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 20);

        console.log(`✅ Ranked ${sortedBySimilarity.length} competitors by similarity`);

        topCompetitors = sortedBySimilarity.map(item => removeUndefined({
          title: item.title || 'Unknown',
          placeId: item.place_id || null,
          similarity: item.similarity,
          scrapedTextLength: item.scrapedTextLength,
          address: item.address,
          url: item.url,
          phone: item.phone,
          rating: item.rating?.value,
          reviewsCount: item.rating?.votes_count,
          category: item.category,
          latitude: item.latitude,
          longitude: item.longitude
        }));
      }
    } catch (error) {
      console.error('⚠️ Error in similarity analysis:', error);

      topCompetitors = uniqueBusinesses.slice(0, 20).map(item => removeUndefined({
        title: item.title || 'Unknown',
        placeId: item.place_id || null,
        address: item.address,
        url: item.url,
        phone: item.phone,
        rating: item.rating?.value,
        reviewsCount: item.rating?.votes_count,
        category: item.category,
        latitude: item.latitude,
        longitude: item.longitude
      }));
    }
  } else {
    topCompetitors = uniqueBusinesses.slice(0, 20).map(item => removeUndefined({
      title: item.title || 'Unknown',
      placeId: item.place_id || null,
      address: item.address,
      url: item.url,
      phone: item.phone,
      rating: item.rating?.value,
      reviewsCount: item.rating?.votes_count,
      category: item.category,
      latitude: item.latitude,
      longitude: item.longitude
    }));
  }

  const keywordAnalysis = {
    keyword: businessTypeIdentifier,
    totalResults: result?.se_results_count || 0,
    topCompetitors,
    checkUrl: result?.check_url
  };

  const analysisResult = {
    processedAt: new Date().toISOString(),
    businessType: 'local',
    location: {
      latitude,
      longitude,
      radius: 10000
    },
    keywordAnalysis: [keywordAnalysis],
    totalCost: response.cost,
    summary: {
      totalKeywords: 1,
      totalCompetitors: keywordAnalysis.topCompetitors.length,
      totalResults: keywordAnalysis.totalResults
    }
  };

  console.log('✅ Local business SEO analysis completed');
  return analysisResult;
}

/**
 * Run domain intersection analysis for user vs competitors
 */
async function runDomainIntersectionAnalysis(uid, userWebsite, competitors, locationCode, languageCode) {
  console.log(`🔍 Running domain intersection analysis for ${competitors.length} competitors...`);

  // Extract domain from user website URL
  const userDomain = new URL(userWebsite).hostname.replace('www.', '');

  // Fetch user services
  const userDocRef = db.collection('users').doc(uid);
  const userDoc = await userDocRef.get();

  let servicesEmbedding = null;
  let existingTargetKeywords = [];

  if (userDoc.exists) {
    const userDocData = userDoc.data();
    existingTargetKeywords = userDocData.targetKeywords || [];
    const servicesArray = userDocData.services || [];

    if (servicesArray.length > 0) {
      const services = [];
      servicesArray.forEach(service => {
        if (service.name) services.push(service.name);
        if (service.serviceName) services.push(service.serviceName);
        if (service.title) services.push(service.title);
        if (service.description) services.push(service.description);
        if (typeof service === 'string') services.push(service);
      });

      if (services.length > 0) {
        const servicesText = services.join(' ');
        console.log(`📋 Creating services embedding for keyword similarity analysis...`);
        servicesEmbedding = await getEmbedding(servicesText);
      }
    }
  }

  for (const competitor of competitors) {
    if (!competitor.url) continue;

    try {
      const competitorDomain = new URL(competitor.url).hostname.replace('www.', '');

      // Get shared keywords
      const sharedData = await callDomainIntersection(
        competitorDomain,
        userDomain,
        locationCode,
        languageCode,
        true
      );

      const sharedResult = sharedData.tasks[0].result?.[0];
      const totalSharedKeywords = sharedResult?.total_count || 0;

      if (totalSharedKeywords > 0) {
        const sharedDoc = {
          competitorDomain,
          competitorTitle: competitor.title,
          userDomain,
          totalKeywords: totalSharedKeywords,
          keywords: sharedResult?.items?.map(item => {
            const keywordData = removeUndefined({
              keyword: item.keyword_data?.keyword,
              searchVolume: item.keyword_data?.keyword_info?.search_volume,
              competition: item.keyword_data?.keyword_info?.competition,
              competitorPosition: item.first_domain_serp_element?.rank_absolute,
              userPosition: item.second_domain_serp_element?.rank_absolute,
              cpc: item.keyword_data?.keyword_info?.cpc,
              searchIntent: item.keyword_data?.search_intent_info?.main_intent,
              difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty,
            });

            if (existingTargetKeywords.includes(item.keyword_data?.keyword)) {
              keywordData.targeted = true;
            }

            return keywordData;
          }) || [],
          processedAt: new Date().toISOString(),
          cost: sharedData.cost
        };

        await db.collection('users').doc(uid)
          .collection('intersections').doc('shared')
          .collection('websites').doc(competitorDomain)
          .set(sharedDoc);

        console.log(`✅ Saved shared keywords with ${competitorDomain}: ${totalSharedKeywords} keywords`);
      }

      // Get unique keywords
      const uniqueData = await callDomainIntersection(
        competitorDomain,
        userDomain,
        locationCode,
        languageCode,
        false
      );

      const uniqueResult = uniqueData.tasks[0].result?.[0];
      const totalUniqueKeywords = uniqueResult?.total_count || 0;

      if (totalUniqueKeywords > 0) {
        console.log(`🔍 Analyzing similarity for ${totalUniqueKeywords} unique keywords...`);

        const items = uniqueResult?.items || [];
        let keywordsWithSimilarity = [];

        if (servicesEmbedding) {
          const validKeywords = [];
          const keywordToItemMap = new Map();

          items.forEach((item, index) => {
            const keyword = item.keyword_data?.keyword;
            if (keyword && keyword.trim()) {
              validKeywords.push(keyword);
              keywordToItemMap.set(validKeywords.length - 1, item);
            }
          });

          if (validKeywords.length > 0) {
            console.log(`📊 Batch processing ${validKeywords.length} keywords...`);

            const chunkSize = 2000;
            const allEmbeddings = [];

            for (let i = 0; i < validKeywords.length; i += chunkSize) {
              const chunk = validKeywords.slice(i, i + chunkSize);
              console.log(`🔄 Processing keywords ${i + 1} to ${Math.min(i + chunkSize, validKeywords.length)}...`);

              try {
                const embeddings = await getEmbedding(chunk);
                allEmbeddings.push(...embeddings);
              } catch (error) {
                console.error(`⚠️ Failed to get embeddings for chunk:`, error);
                allEmbeddings.push(...Array(chunk.length).fill(null));
              }
            }

            keywordsWithSimilarity = validKeywords.map((keyword, index) => {
              const item = keywordToItemMap.get(index);
              let similarityScore = null;

              if (allEmbeddings[index] !== null) {
                try {
                  similarityScore = cosineSimilarity(servicesEmbedding, allEmbeddings[index]);
                } catch (error) {
                  console.warn(`⚠️ Failed to calculate similarity for keyword: ${keyword}`);
                }
              }

              const keywordData = removeUndefined({
                keyword,
                searchVolume: item.keyword_data?.keyword_info?.search_volume,
                competition: item.keyword_data?.keyword_info?.competition,
                competitorPosition: item.first_domain_serp_element?.rank_absolute,
                similarityToServices: similarityScore,
                cpc: item.keyword_data?.keyword_info?.cpc,
                searchIntent: item.keyword_data?.search_intent_info?.main_intent,
                difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty,
              });

              if (existingTargetKeywords.includes(keyword)) {
                keywordData.targeted = true;
              }

              return keywordData;
            });
          }
        } else {
          keywordsWithSimilarity = items.map(item => {
            const keyword = item.keyword_data?.keyword;
            const keywordData = removeUndefined({
              keyword,
              searchVolume: item.keyword_data?.keyword_info?.search_volume,
              competition: item.keyword_data?.keyword_info?.competition,
              competitorPosition: item.first_domain_serp_element?.rank_absolute,
              similarityToServices: null,
              cpc: item.keyword_data?.keyword_info?.cpc,
              searchIntent: item.keyword_data?.search_intent_info?.main_intent,
              difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty,
            });

            if (existingTargetKeywords.includes(keyword)) {
              keywordData.targeted = true;
            }

            return keywordData;
          });
        }

        const uniqueDoc = {
          competitorDomain,
          competitorTitle: competitor.title,
          userDomain,
          totalKeywords: totalUniqueKeywords,
          keywords: keywordsWithSimilarity,
          processedAt: new Date().toISOString(),
          cost: uniqueData.cost,
          hasSimilarityScores: servicesEmbedding !== null
        };

        await db.collection('users').doc(uid)
          .collection('intersections').doc('unique')
          .collection('websites').doc(competitorDomain)
          .set(uniqueDoc);

        console.log(`✅ Saved ${totalUniqueKeywords} unique keywords for ${competitorDomain}`);
      }

    } catch (error) {
      console.warn(`⚠️ Failed to analyze intersection with ${competitor.url}:`, error);
    }
  }

  console.log('✅ Domain intersection analysis completed');
}

// Keyword generation utilities
function normalize(value, min, max) {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

function calculateWordOverlap(keyword1, keyword2) {
  const words1 = new Set(keyword1.toLowerCase().split(/\s+/));
  const words2 = new Set(keyword2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

function isDiverse(keyword, selectedKeywords, threshold = 0.7) {
  for (const selected of selectedKeywords) {
    const overlap = calculateWordOverlap(keyword, selected);
    if (overlap >= threshold) return false;
  }
  return true;
}

/**
 * Generate top 20 target keywords automatically
 */
async function generateTargetKeywords(uid) {
  console.log('🎯 Auto-generating target keywords...');

  const uniqueSnapshot = await db.collection('users').doc(uid)
    .collection('intersections').doc('unique')
    .collection('websites').get();

  const allKeywords = [];

  uniqueSnapshot.forEach(websiteDoc => {
    const data = websiteDoc.data();
    const competitorDomain = data.competitorDomain;

    if (data.keywords && Array.isArray(data.keywords)) {
      data.keywords.forEach(kw => {
        if (kw.similarityToServices !== null && kw.similarityToServices !== undefined) {
          allKeywords.push({
            keyword: kw.keyword,
            similarityToServices: kw.similarityToServices,
            searchVolume: kw.searchVolume || 0,
            competition: kw.competition || 0,
            competitorPosition: kw.competitorPosition || 100,
            source: competitorDomain
          });
        }
      });
    }
  });

  console.log(`📊 Found ${allKeywords.length} total keywords with similarity scores`);

  if (allKeywords.length === 0) {
    console.log('⚠️ No keywords found for target keyword generation');
    return [];
  }

  const searchVolumes = allKeywords.map(k => k.searchVolume).filter(v => v > 0);
  const minVolume = Math.min(...searchVolumes);
  const maxVolume = Math.max(...searchVolumes);

  const competitions = allKeywords.map(k => k.competition).filter(c => c > 0);
  const minCompetition = Math.min(...competitions);
  const maxCompetition = Math.max(...competitions);

  const scoredKeywords = allKeywords.map(kw => {
    const similarityScore = kw.similarityToServices || 0;
    const volumeScore = normalize(kw.searchVolume, minVolume, maxVolume);
    const competitionScore = 1 - normalize(kw.competition, minCompetition, maxCompetition);

    const compositeScore = (
      similarityScore * 0.6 +
      volumeScore * 0.3 +
      competitionScore * 0.1
    );

    return { ...kw, compositeScore };
  });

  scoredKeywords.sort((a, b) => b.compositeScore - a.compositeScore);

  const selectedKeywords = [];
  for (const kw of scoredKeywords) {
    if (selectedKeywords.length >= 20) break;
    if (isDiverse(kw.keyword, selectedKeywords)) {
      selectedKeywords.push(kw.keyword);
    }
  }

  console.log(`✅ Selected ${selectedKeywords.length} diverse target keywords`);

  const userDocRef = db.collection('users').doc(uid);
  await userDocRef.set({
    targetKeywords: selectedKeywords
  }, { merge: true });

  console.log(`✅ Saved ${selectedKeywords.length} target keywords to user document`);

  // Mark keywords as targeted
  const sharedSnapshot = await db.collection('users').doc(uid)
    .collection('intersections').doc('shared')
    .collection('websites').get();

  for (const docSnapshot of sharedSnapshot.docs) {
    const data = docSnapshot.data();
    const keywordsArray = data.keywords || [];

    const updatedKeywords = keywordsArray.map(kw => {
      if (selectedKeywords.includes(kw.keyword)) {
        return { ...kw, targeted: true };
      }
      return kw;
    });

    await docSnapshot.ref.update({ keywords: updatedKeywords });
  }

  for (const docSnapshot of uniqueSnapshot.docs) {
    const data = docSnapshot.data();
    const keywordsArray = data.keywords || [];

    const updatedKeywords = keywordsArray.map(kw => {
      if (selectedKeywords.includes(kw.keyword)) {
        return { ...kw, targeted: true };
      }
      return kw;
    });

    await docSnapshot.ref.update({ keywords: updatedKeywords });
  }

  return selectedKeywords;
}

module.exports = {
  processLocalBusinessSEO,
  runDomainIntersectionAnalysis,
  generateTargetKeywords
};
