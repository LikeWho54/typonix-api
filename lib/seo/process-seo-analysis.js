/**
 * Core SEO analysis processing logic
 * Main orchestrator that routes to local or online analysis
 */

const { db } = require('../../firebase');
const { updateSEOAnalysisStatus } = require('../seo-analysis-status');
const { processLocalBusinessSEO, runDomainIntersectionAnalysis, generateTargetKeywords } = require('./local-analysis');
const { processOnlineBusinessSEO } = require('./online-analysis');

async function processSEOAnalysis(uid) {
  try {
    console.log(`🔄 Processing SEO analysis for user ${uid}...`);

    // Fetch user's onboarding data from Firestore
    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      await updateSEOAnalysisStatus(uid, 'failed', 'User not found');
      throw new Error('User not found');
    }

    const userData = userDoc.data();

    // Check if onboarding is completed
    if (!userData.onboardingCompleted) {
      await updateSEOAnalysisStatus(uid, 'failed', 'Onboarding not completed');
      throw new Error('Onboarding not completed');
    }

    console.log('📊 Processing with data:', {
      businessName: userData.businessName,
      businessType: userData.businessType,
      businessTypeIdentifier: userData.businessTypeIdentifier,
      targetCountry: userData.targetCountry,
      city: userData.city,
      language: userData.language,
      servicesCount: userData.services?.length || 0,
      keywordsCount: userData.seedKeywords?.length || 0,
      competitorsCount: userData.competitors?.length || 0
    });

    // Route analysis based on business type
    let analysisResults;

    if (userData.businessType === 'local') {
      analysisResults = await processLocalBusinessSEO(userData, uid);
    } else if (userData.businessType === 'online') {
      analysisResults = await processOnlineBusinessSEO(userData, uid);
    } else {
      throw new Error(`Unknown business type: ${userData.businessType}`);
    }

    await userDocRef.update({
      seoAnalysisResults: analysisResults,
    });

    // Run domain intersection analysis if user has a website
    if (userData.websiteUrl) {
      console.log('🔍 Starting domain intersection analysis...');

      try {
        // Get location code from targetCountryCode, default to US if not set
        const locationCode = userData.targetCountryCode || 2840;
        const languageCode = userData.language || 'en';

        let allCompetitors = [];

        if (userData.businessType === 'local') {
          // LOCAL: Collect user-selected + Google Maps competitors

          // 1. Add user-selected competitors from onboarding
          if (userData.competitors && userData.competitors.length > 0) {
            console.log(`📋 Including ${userData.competitors.length} user-selected competitors`);
            userData.competitors.forEach((competitorUrl) => {
              allCompetitors.push({
                url: competitorUrl,
                title: 'User-selected competitor'
              });
            });
          }

          // 2. Add Google Maps competitors
          if (analysisResults.keywordAnalysis?.[0]?.topCompetitors?.length > 0) {
            console.log(`📋 Including ${analysisResults.keywordAnalysis[0].topCompetitors.length} Google Maps competitors`);
            allCompetitors.push(...analysisResults.keywordAnalysis[0].topCompetitors);
          }
        } else if (userData.businessType === 'online') {
          // ONLINE: Use top 10 competitors from Competitors Domain API
          if (analysisResults.keywordAnalysis?.[0]?.topCompetitors?.length > 0) {
            console.log(`📋 Including ${analysisResults.keywordAnalysis[0].topCompetitors.length} competitors from Competitors Domain API`);

            // Convert domain format to URL format for intersection analysis
            allCompetitors = analysisResults.keywordAnalysis[0].topCompetitors.map((c) => ({
              url: `https://${c.domain}`,
              title: c.domain,
              domain: c.domain
            }));
          }
        }

        if (allCompetitors.length > 0) {
          await runDomainIntersectionAnalysis(
            uid,
            userData.websiteUrl,
            allCompetitors,
            locationCode,
            languageCode
          );

          // Update competitors array in Firestore with discovered competitors
          if (userData.businessType === 'local') {
            const googleMapsCompetitors = analysisResults.keywordAnalysis?.[0]?.topCompetitors?.map((c) => c.url).filter(Boolean) || [];
            if (googleMapsCompetitors.length > 0) {
              const existingCompetitors = userData.competitors || [];
              const mergedCompetitors = [...new Set([...existingCompetitors, ...googleMapsCompetitors])];

              await userDocRef.update({
                competitors: mergedCompetitors
              });

              console.log(`✅ Updated competitors array: ${existingCompetitors.length} → ${mergedCompetitors.length} total`);
            }
          } else if (userData.businessType === 'online') {
            const onlineCompetitors = analysisResults.keywordAnalysis?.[0]?.topCompetitors?.map((c) => c.domain) || [];
            if (onlineCompetitors.length > 0) {
              const existingCompetitors = userData.competitors || [];
              const mergedCompetitors = [...new Set([...existingCompetitors, ...onlineCompetitors])];

              await userDocRef.update({
                competitors: mergedCompetitors
              });

              console.log(`✅ Updated competitors array: ${existingCompetitors.length} → ${mergedCompetitors.length} total`);
            }
          }

          console.log('✅ Domain intersection analysis completed');

          // Generate target keywords after intersection analysis
          try {
            console.log('🎯 Generating target keywords...');
            await generateTargetKeywords(uid);
            console.log('✅ Target keywords generation completed');
          } catch (error) {
            console.error('⚠️ Target keywords generation failed (non-critical):', error);
          }
        } else {
          console.log('⚠️ No competitors found for intersection analysis');
        }
      } catch (error) {
        console.error('⚠️ Domain intersection analysis failed (non-critical):', error);
        // Don't fail the whole process if intersection analysis fails
      }
    }

    // Generate keyword ideas using DataForSEO Keyword Ideas API
    try {
      console.log('💡 Generating keyword ideas from seed keywords...');
      
      const { generateKeywordIdeas } = require('./keyword-ideas');
      const keywordIdeasResult = await generateKeywordIdeas(uid);
      
      console.log(`✅ Generated ${keywordIdeasResult.total_opportunities_found || 0} keyword ideas (cost: $${keywordIdeasResult.cost || 0})`);
      console.log(`📊 Analysis summary:`, {
        total: keywordIdeasResult.analysis_summary?.total_opportunities || 0,
        high_priority: keywordIdeasResult.analysis_summary?.high_priority_opportunities || 0,
        commercial: keywordIdeasResult.analysis_summary?.commercial_opportunities || 0,
        quick_wins: keywordIdeasResult.analysis_summary?.quick_win_opportunities || 0,
      });
    } catch (error) {
      console.error('⚠️ Keyword ideas generation failed (non-critical):', error);
      // Don't fail the whole process if keyword ideas generation fails
    }

    // Mark as completed
    await updateSEOAnalysisStatus(uid, 'completed');

    console.log(`✅ SEO analysis completed for user ${uid}`);

    // Automatically trigger content generation after SEO analysis completes
    try {
      console.log('📝 Triggering automatic content generation...');

      // Import content generation modules
      const { generateContentTitles } = require('../content/generate-titles');
      const { generateBlogPost } = require('../content/generate-blog');

      // Step 1: Generate content titles
      console.log('🎯 Step 1: Generating content titles...');
      
      const titlesResult = await generateContentTitles(uid);
      console.log(`✅ Content titles generated: ${titlesResult.titles?.length || 0} titles`);

      // Step 2: Generate first blog post
      console.log('📰 Step 2: Generating first blog post...');
      
      // Run blog generation asynchronously (don't wait for it)
      generateBlogPost(uid)
        .then((blogResult) => {
          console.log(`✅ First blog post generated: ${blogResult.data.title}`);
        })
        .catch((error) => {
          console.error('⚠️ Blog generation failed (non-critical):', error);
        });

      console.log('✅ Content generation pipeline triggered successfully');
      
    } catch (error) {
      console.error('⚠️ Content generation failed (non-critical):', error);
      // Don't fail the whole process if content generation fails
    }

    return {
      success: true,
      message: 'SEO analysis completed successfully',
      results: analysisResults
    };

  } catch (error) {
    console.error('❌ Error in process-analysis:', error);

    await updateSEOAnalysisStatus(
      uid,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );

    throw error;
  }
}

module.exports = {
  processSEOAnalysis
};
