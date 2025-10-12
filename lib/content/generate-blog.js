/**
 * Generate Blog Post Module
 * 
 * Generates a complete 1000-word blog post with images using:
 * 1. Perplexity for research
 * 2. Claude for outline generation
 * 3. Claude for blog content generation
 * 4. Claude for image query generation
 * 5. Unsplash for images
 */

const { db } = require('../../firebase');
const { callPerplexity } = require('../utils/perplexity-client');
const { callClaude } = require('../utils/claude-client');
const { searchMultiple: searchUnsplashMultiple } = require('../utils/unsplash-client');

/**
 * Helper function to remove undefined values
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
 * Generate a complete blog post for a user
 * @param {string} uid - User ID
 * @returns {Promise<Object>} - Generated blog post data
 */
async function generateBlogPost(uid) {
  console.log(`📝 Starting blog generation for user ${uid}...`);

  // Step 1: Select Next Title
  console.log('Step 1: Finding next uncreated title...');

  // Fetch all content plans
  const plansSnapshot = await db.collection('users').doc(uid).collection('content_plans')
    .orderBy('createdAt', 'desc')
    .get();

  if (plansSnapshot.empty) {
    throw new Error('No content plans found. Generate a content plan first.');
  }

  // Find first uncreated title across all plans
  let selectedPlan = null;
  let selectedTitle = null;
  let selectedTitleIndex = -1;

  for (const planDoc of plansSnapshot.docs) {
    const planData = planDoc.data();
    const titles = planData.titles || [];

    // Find first title without 'created' flag or where created = false
    const uncreatedIndex = titles.findIndex((t) => !t.created);

    if (uncreatedIndex !== -1) {
      selectedPlan = {
        id: planDoc.id,
        ...planData
      };
      selectedTitle = titles[uncreatedIndex];
      selectedTitleIndex = uncreatedIndex;
      break;
    }
  }

  if (!selectedTitle) {
    throw new Error('No uncreated titles found. All articles have been generated.');
  }

  console.log(`✅ Found uncreated title at index ${selectedTitleIndex} in plan ${selectedPlan.id}`);
  console.log(`📌 Title: "${selectedTitle.title}"`);
  console.log(`🎯 Keyword: "${selectedTitle.targetKeyword}"`);
  console.log(`📋 Format: ${selectedTitle.format}`);

  // Mark title as generating to prevent duplicate generation
  const initialPlanRef = db.collection('users').doc(uid).collection('content_plans').doc(selectedPlan.id);
  const initialUpdatedTitles = [...selectedPlan.titles];
  initialUpdatedTitles[selectedTitleIndex] = {
    ...selectedTitle,
    generating: true,
    generationStartedAt: new Date().toISOString()
  };

  await initialPlanRef.update({
    titles: initialUpdatedTitles
  });

  console.log(`🔒 Marked title as "generating" to prevent duplicates`);

  // Fetch user data to get extracted links and other business info
  const userDocRef = db.collection('users').doc(uid);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    throw new Error('User data not found');
  }

  const userData = userDoc.data();
  const extractedLinks = userData.extractedLinks || [];
  const services = userData.services || [];

  console.log(`📎 Found ${extractedLinks.length} extracted links from user's website`);
  console.log(`🛠️ Services: ${services.length > 0 ? services.map(s => s.name || s).join(', ') : 'No services found'}`);

  // Determine business type and location
  const isLocalBusiness = selectedPlan.businessType === 'local';
  const location = selectedPlan.location || selectedPlan.city;

  // Step 3: Research with Perplexity
  console.log('\nStep 3: Researching with Perplexity...');

  const perplexityPrompt = `You are a research assistant. Given the following:

[BLOG TITLE]: "${selectedTitle.title}"

[SEO KEYWORD]: "${selectedTitle.targetKeyword}"

[BUSINESS CONTEXT]:
- Business: ${selectedPlan.businessName}
- Type: ${selectedPlan.businessTypeIdentifier}
${isLocalBusiness ? `- Location: ${location}` : `- Target Market: ${location}`}
- Services: ${services.map((s) => s.name || s).join(', ')}

[MAIN POINTS TO RESEARCH]:
1. Overview and importance of ${selectedTitle.targetKeyword}
2. Key benefits and features customers look for
3. Common problems or pain points related to ${selectedTitle.targetKeyword}
4. Best practices and expert recommendations
${isLocalBusiness ? `5. Local considerations for ${location}` : `5. Industry trends and standards in ${location}`}

Search for and provide relevant, high-quality sources and links for each main point.

Focus on recent, authoritative information from reputable websites, academic sources, and industry publications from the last 6 months.

For each main point:

❶. Provide 2-3 relevant links with brief descriptions (1-2 sentences) of how they support or expand on the point.

• Include recent blog posts or industry case studies as research

❷. Include at least one statistic or data point, if applicable.

❸. Suggest one potential expert or thought leader to quote, if relevant.

Ensure all sources are credible and directly related to the topic. Avoid using Wikipedia. Present your findings clearly and concisely, organizing information under each main point.

Your objective is to enhance the blog content with authoritative sources and data, improving its credibility and depth.`;

  console.log('📡 Calling Perplexity API for research...');

  const researchData = await callPerplexity(perplexityPrompt);

  console.log('✅ Research completed');
  console.log(`📊 Research length: ${researchData.length} characters`);

  // Step 4: Create Outline with Claude
  console.log('\nStep 4: Creating blog outline with Claude...');

  const outlinePrompt = `As an SEO-savvy content strategist, create a comprehensive blog post outline using the following inputs:

❶/ Title: "${selectedTitle.title}"

❷/ SEO Keywords: "${selectedTitle.targetKeyword}"

❸/ Research & Brainstorm:
${researchData}

❹/ Business Context:
- Business: ${selectedPlan.businessName}
- Type: ${selectedPlan.businessTypeIdentifier}
${isLocalBusiness ? `- Location: ${location}` : `- Target Market: ${location}`}
- Services: ${services.length > 0 ? services.map(s => s.name || s).join(', ') : 'General business services'}

${extractedLinks.length > 0 ? `❺/ Internal Links Available (to naturally integrate):\n${extractedLinks.slice(0, 10).join('\n')}\n` : ''}

Develop a detailed structure with the following specifications:

1/- Overall Structure:

• Create main headings and subheadings

• Ensure high keyword density while maintaining natural language flow

• Naturally mention ${selectedPlan.businessName} and their services where relevant
${services.length > 0 ? `\n• Integrate the following services naturally throughout the content:\n${services.map((s) => `  - ${s.name || s}`).join('\n')}` : ''}

2/- Assign word counts to each section totaling 1,000 words:

❶. Introduction (100 words)
❷. Main Body (750 words distributed across 4-5 H2 sections)
❸. Conclusion (75 words)
❹. FAQ Section (75 words)

3/- For each main section, provide:

• Key points to cover

• Relevant statistics or data to include from research

• Potential examples or case studies

• Suggested visuals (images, infographics, videos)

• Where to naturally integrate internal links

4/- FAQ Section:

• Create 5-7 common questions about the topic

• Base questions on search trends and user intent

• Provide concise, informative answers

5/- Throughout the outline:

• Incorporate provided SEO keywords naturally

• Integrate insights from the research
${extractedLinks.length > 0 ? '\n• Suggest placement for provided internal links\n' : ''}
${isLocalBusiness ? `• Consider local SEO for ${location}` : `• Focus on broad industry appeal for ${location} market`}
${services.length > 0 ? `\n• IMPORTANT: Naturally weave in mentions of the business's services (${services.map(s => s.name || s).join(', ')}) where they are relevant to the topic` : ''}

Present the outline in a clear, hierarchical format using markdown. Your goal is to create a comprehensive, SEO-optimized outline that will guide the writing of an engaging, creative and informative blog post.

OUTPUT FORMAT (return as valid JSON):
{
  "outline": {
    "introduction": {
      "wordCount": 100,
      "keyPoints": ["...", "..."],
      "hook": "..."
    },
    "sections": [
      {
        "h2": "Main Heading",
        "wordCount": 200,
        "keyPoints": ["...", "..."],
        "statistics": ["...", "..."],
        "internalLinks": ["...", "..."],
        "subsections": [
          {
            "h3": "Subheading",
            "keyPoints": ["...", "..."]
          }
        ]
      }
    ],
    "conclusion": {
      "wordCount": 75,
      "keyPoints": ["...", "..."],
      "cta": "..."
    },
    "faqs": [
      {
        "question": "...",
        "answer": "..."
      }
    ]
  }
}`;

  console.log('📡 Calling Claude API for outline generation...');

  const outlineContent = await callClaude(outlinePrompt, 4000);

  console.log('✅ Outline generated');
  console.log(`📝 Outline length: ${outlineContent.length} characters`);

  // Parse JSON from Claude response
  let outlineData;
  try {
    const jsonContent = outlineContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    outlineData = JSON.parse(jsonContent);
  } catch (parseError) {
    console.error('Failed to parse Claude outline response:', outlineContent.substring(0, 500));
    throw new Error('Failed to parse outline as JSON');
  }

  // Step 5: Generate Blog Content with Claude
  console.log('\nStep 5: Generating blog content with Claude...');

  const blogPrompt = `You are an expert content writer specializing in ${isLocalBusiness ? 'local' : 'industry-focused'} SEO and engaging blog posts.

Write a complete, high-quality blog post using the following inputs:

TITLE: "${selectedTitle.title}"

TARGET KEYWORD: "${selectedTitle.targetKeyword}"

BUSINESS CONTEXT:
- Business: ${selectedPlan.businessName}
- Type: ${selectedPlan.businessTypeIdentifier}
${isLocalBusiness ? `- Location: ${location}` : `- Target Market: ${location}`}
- Services: ${services.map((s) => s.name || s).join(', ')}

RESEARCH & DATA:
${researchData}

OUTLINE TO FOLLOW:
${JSON.stringify(outlineData.outline, null, 2)}
${extractedLinks.length > 0 ? `\nINTERNAL LINKS TO INTEGRATE (use 2-3 naturally):\n${extractedLinks.slice(0, 10).join('\n')}\n` : ''}
WRITING REQUIREMENTS:

1. **Tone & Style**:
   - Professional yet conversational
   - Engaging and easy to read
   - Short paragraphs (2-4 sentences)
   - Use transition words
   - Address the reader directly

2. **SEO Optimization**:
   - Use "${selectedTitle.targetKeyword}" naturally 5-7 times
   - Include keyword variations
   - Use H2 and H3 headings from the outline
   - Optimize for featured snippets

3. **${isLocalBusiness ? 'Local' : 'Market'} SEO**:
${isLocalBusiness
  ? `   - Mention ${location} naturally throughout
   - Reference local context where relevant
   - Naturally promote ${selectedPlan.businessName}`
  : `   - Focus on industry-wide appeal for ${location} market
   - DO NOT force location into content unnaturally
   - Naturally promote ${selectedPlan.businessName} as a solution`}

4. **Content Structure**:
   - Follow the outline's word counts (1000 words total)
   - Include all sections: Introduction, Main Body, Conclusion, FAQs
   - Use bullet points and numbered lists
   - Bold important terms

5. **Business Integration**:
   ${services.length > 0 ? `- Naturally mention ${selectedPlan.businessName}'s services: ${services.map(s => s.name || s).join(', ')}\n   ` : ''}${extractedLinks.length > 0 ? '- Include 2-3 internal links naturally\n   ' : ''}- Add a clear call-to-action mentioning ${selectedPlan.businessName}

6. **Credibility**:
   - Use statistics from research
   - Reference authoritative sources
   - Provide actionable advice

7. **CRITICAL - External Links**:
   - NEVER add any external links under any circumstances
   - NEVER link to external websites, sources, or references
   - DO NOT create hyperlinks to external domains
   - You may mention sources by name (e.g., "According to Harvard Business Review") but DO NOT link to them
   ${extractedLinks.length > 0 ? '- ONLY use the internal links provided in the INTERNAL LINKS section above\n   - Do NOT add any links that are not in the provided list' : '- Do NOT add any links whatsoever'}

OUTPUT FORMAT:
Write the complete blog post in **markdown format**. Use proper markdown syntax for:
- # H1 (title)
- ## H2 (main sections)
- ### H3 (subsections)
- **bold text**
- [link text](url) - ONLY for internal links from the provided list
- Bullet points with -
- Numbered lists

Start writing now. Output ONLY the markdown blog post, no additional commentary.`;

  console.log('📡 Calling Claude API for blog generation...');

  const blogContent = await callClaude(blogPrompt, 8000);

  console.log('✅ Blog content generated');
  console.log(`📝 Blog length: ${blogContent.length} characters`);

  const wordCount = blogContent.split(/\s+/).length;
  console.log(`📊 Word count: ~${wordCount} words`);

  // Step 6: Generate image search queries with Claude
  console.log('\nStep 6: Generating image search queries with Claude...');

  const imageQueryPrompt = `Based on this blog post title and outline, generate 3 relevant image search queries for Unsplash.

TITLE: "${selectedTitle.title}"
TOPIC: "${selectedTitle.targetKeyword}"
LOCATION: ${selectedPlan.city}

Create 3 specific, descriptive search queries that would find relevant, high-quality images for this blog post.
Each query should be:
- Specific and descriptive (3-5 words)
- Relevant to the blog topic
- Professional and business-appropriate
- Likely to return good results on Unsplash

OUTPUT FORMAT (return as valid JSON):
{
  "queries": ["query 1", "query 2", "query 3"]
}`;

  const imageQueryText = await callClaude(imageQueryPrompt, 500);
  const imageQueries = JSON.parse(imageQueryText.match(/\{[\s\S]*\}/)?.[0] || '{"queries":[]}');

  console.log('✅ Image queries generated:', imageQueries.queries);

  // Fetch images from Unsplash
  console.log('\nFetching images from Unsplash...');

  const unsplashImages = await searchUnsplashMultiple(imageQueries.queries);

  // Insert images into blog content
  let enhancedBlogContent = blogContent;
  if (unsplashImages.length > 0) {
    // Insert first image after introduction (after first ##)
    const firstH2Index = enhancedBlogContent.indexOf('\n## ');
    if (firstH2Index !== -1) {
      const img1 = unsplashImages[0];
      const imageMarkdown = `\n\n![${img1.alt}](${img1.url})\n*Photo by [${img1.photographer}](${img1.photographerUrl}) on Unsplash*\n\n`;
      enhancedBlogContent = enhancedBlogContent.slice(0, firstH2Index) + imageMarkdown + enhancedBlogContent.slice(firstH2Index);
    }

    // Insert second image in the middle of content
    if (unsplashImages.length > 1) {
      const h2Matches = [...enhancedBlogContent.matchAll(/\n## /g)];
      if (h2Matches.length >= 3) {
        const middleIndex = h2Matches[Math.floor(h2Matches.length / 2)].index;
        const img2 = unsplashImages[1];
        const imageMarkdown = `\n\n![${img2.alt}](${img2.url})\n*Photo by [${img2.photographer}](${img2.photographerUrl}) on Unsplash*\n\n`;
        enhancedBlogContent = enhancedBlogContent.slice(0, middleIndex) + imageMarkdown + enhancedBlogContent.slice(middleIndex);
      }
    }

    // Insert third image before conclusion
    if (unsplashImages.length > 2) {
      const conclusionIndex = enhancedBlogContent.lastIndexOf('\n## ');
      if (conclusionIndex !== -1) {
        const img3 = unsplashImages[2];
        const imageMarkdown = `\n\n![${img3.alt}](${img3.url})\n*Photo by [${img3.photographer}](${img3.photographerUrl}) on Unsplash*\n\n`;
        enhancedBlogContent = enhancedBlogContent.slice(0, conclusionIndex) + imageMarkdown + enhancedBlogContent.slice(conclusionIndex);
      }
    }
  }

  console.log('✅ Images integrated into blog content');

  // Step 7: Save to Firestore
  console.log('\nStep 7: Saving blog to Firestore...');

  const articleId = `article_${Date.now()}`;
  const now = new Date().toISOString();

  // Save article to generated_articles collection
  const articleRef = db.collection('users').doc(uid).collection('generated_articles').doc(articleId);

  await articleRef.set(removeUndefined({
    // Article content
    title: selectedTitle.title,
    content: enhancedBlogContent,
    wordCount: wordCount,

    // SEO data
    targetKeyword: selectedTitle.targetKeyword,
    format: selectedTitle.format,

    // Business context
    businessName: selectedPlan.businessName,
    businessType: selectedPlan.businessType, // 'local' or 'online'
    businessTypeIdentifier: selectedPlan.businessTypeIdentifier, // 'Nutrition Practice', 'Dentist', etc.
    city: isLocalBusiness ? location : '',
    targetCountry: isLocalBusiness ? (selectedPlan.targetCountry || '') : location,
    location: location,

    // Generation metadata
    contentPlanId: selectedPlan.id,
    titleIndex: selectedTitleIndex,
    outline: outlineData.outline,
    researchData: researchData,
    images: unsplashImages,
    imageCount: unsplashImages.length,

    // Status
    status: 'draft',
    createdAt: now,
    updatedAt: now
  }));

  console.log(`✅ Article saved to Firestore with ID: ${articleId}`);

  // Mark title as created in content plan
  const planRef = db.collection('users').doc(uid).collection('content_plans').doc(selectedPlan.id);
  const updatedTitles = [...selectedPlan.titles];
  updatedTitles[selectedTitleIndex] = {
    ...selectedTitle,
    created: true,
    generating: false,
    articleId: articleId,
    generatedAt: now
  };

  await planRef.update({
    titles: updatedTitles
  });

  console.log(`✅ Marked title as "created" in content plan`);

  // Return complete data
  return {
    success: true,
    step: 7,
    message: 'Blog post fully generated and saved',
    data: removeUndefined({
      articleId: articleId,
      contentPlanId: selectedPlan.id,
      titleIndex: selectedTitleIndex,
      title: selectedTitle.title,
      targetKeyword: selectedTitle.targetKeyword,
      format: selectedTitle.format,
      businessName: selectedPlan.businessName,
      businessType: selectedPlan.businessType, // 'local' or 'online'
      businessTypeIdentifier: selectedPlan.businessTypeIdentifier, // 'Nutrition Practice', 'Dentist', etc.
      city: isLocalBusiness ? location : '',
      targetCountry: isLocalBusiness ? (selectedPlan.targetCountry || '') : location,
      location: location,
      wordCount: wordCount,
      imageCount: unsplashImages.length,
      status: 'draft',
      createdAt: now
    })
  };
}

module.exports = {
  generateBlogPost
};
