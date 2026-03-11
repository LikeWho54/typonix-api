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

  // FIX #1: Filter services to only those directly relevant to the target keyword using Claude
  let relevantServices = [];
  if (services.length > 0) {
    const allServiceNames = services.map(s => s.name || s).join(', ');
    const serviceFilterPrompt = `Given the TARGET KEYWORD: "${selectedTitle.targetKeyword}"

Full list of business services: ${allServiceNames}

Return ONLY the service names from the list above that are DIRECTLY about "${selectedTitle.targetKeyword}".
Do NOT include services that are related but on a different topic.
If no services directly match, return an empty array.

Respond with a JSON array of strings only. Example: ["Service A", "Service B"]`;

    try {
      const serviceFilterResponse = await callClaude(serviceFilterPrompt, 300);
      const parsed = JSON.parse(serviceFilterResponse.match(/\[[\s\S]*?\]/)?.[0] || '[]');
      relevantServices = parsed.filter(Boolean);
      console.log(`🛠️ Services filtered for "${selectedTitle.targetKeyword}": [${relevantServices.join(', ')}]`);
    } catch (e) {
      console.warn('⚠️ Service filter failed, using empty list to avoid drift:', e.message);
      relevantServices = [];
    }
  }

  // FIX #2: Cap internal links to 3 max (was 10) — fewer links = less topic bleed
  const cappedExtractedLinks = extractedLinks.slice(0, 3);

  // Step 3: Research with Perplexity
  console.log('\nStep 3: Researching with Perplexity...');

  const perplexityPrompt = `You are a research assistant. Given the following:

[BLOG TITLE]: "${selectedTitle.title}"

[TARGET KEYWORD]: "${selectedTitle.targetKeyword}"

[BUSINESS CONTEXT]:
- Business: ${selectedPlan.businessName}
- Type: ${selectedPlan.businessTypeIdentifier}
${isLocalBusiness ? `- Location: ${location}` : `- Target Market: ${location}`}

🎯 CRITICAL FOCUS CONSTRAINT:
Focus EXCLUSIVELY on "${selectedTitle.targetKeyword}" and NOTHING ELSE.
- Do NOT research related but different topics
- Do NOT include information about similar or alternative options
- Do NOT mention other types, varieties, or categories unless directly part of "${selectedTitle.targetKeyword}"
- Example: If keyword is "rose gardening", do NOT research tulips, daisies, or general gardening
- Example: If keyword is "plumbing leak repair", do NOT research drain cleaning or pipe installation

[RESEARCH SCOPE - 3 SPECIFIC POINTS ONLY]:
Research ONLY these 3 highly specific aspects of "${selectedTitle.targetKeyword}":

1. What makes "${selectedTitle.targetKeyword}" unique and important (specific to THIS keyword only)
2. Top 3 specific benefits or solutions that "${selectedTitle.targetKeyword}" provides
3. Most common specific problem that "${selectedTitle.targetKeyword}" solves

🔍 RELEVANCE FILTER:
Before including ANY information, verify it directly relates to "${selectedTitle.targetKeyword}".
If it mentions other topics, tools, types, or alternatives - EXCLUDE IT.

For each of the 3 points above:
❶. Provide 1-2 relevant sources with brief descriptions (1 sentence each)
❷. Include one specific statistic or data point about "${selectedTitle.targetKeyword}"
❸. Keep information tightly focused on the exact keyword topic

Search for recent, authoritative information from reputable sources (last 6 months).
Avoid Wikipedia. Present findings clearly under each of the 3 points.

Your objective is to provide laser-focused research on "${selectedTitle.targetKeyword}" ONLY.`;

  console.log('📡 Calling Perplexity API for research...');

  const researchData = await callPerplexity(perplexityPrompt);

  console.log('✅ Research completed');
  console.log(`📊 Research length: ${researchData.length} characters`);

  // Step 3b: Filter research to remove off-topic content
  console.log('\nStep 3b: Filtering research for topic relevance...');

  const filterPrompt = `You are a strict content editor.

TARGET KEYWORD: "${selectedTitle.targetKeyword}"

RAW RESEARCH:
${researchData}

Your job: Extract ONLY the sentences and facts that are directly about "${selectedTitle.targetKeyword}".

Rules:
- If a sentence is about a related but different topic, DELETE it
- If a fact mentions other types, alternatives, or variations that are not "${selectedTitle.targetKeyword}" itself, DELETE it
- Keep only what someone searching specifically for "${selectedTitle.targetKeyword}" needs to know
- Do not add anything new
- Do not summarize — keep exact facts and statistics that pass the filter

Output only the filtered research text, nothing else.`;

  const filteredResearch = await callClaude(filterPrompt, 800);

  console.log(`✅ Research filtered: ${researchData.length} → ${filteredResearch.length} characters`);

  // Step 4: Create Outline with Claude
  console.log('\nStep 4: Creating blog outline with Claude...');

  const outlinePrompt = `As an SEO-savvy content strategist, create a comprehensive blog post outline using the following inputs:

❶/ Title: "${selectedTitle.title}"

❷/ TARGET KEYWORD: "${selectedTitle.targetKeyword}"

🎯 CRITICAL TOPIC BOUNDARY:
Write ONLY about "${selectedTitle.targetKeyword}".
- If research mentions other topics, tools, types, or alternatives - IGNORE THEM COMPLETELY
- Do NOT create sections about related but different topics
- Every H2 heading must directly relate to "${selectedTitle.targetKeyword}"
- Example: If keyword is "rose gardening", do NOT include sections about other flowers
- Example: If keyword is "leak repair", do NOT include sections about drain cleaning

❸/ Research & Brainstorm (FILTER FOR RELEVANCE):
${filteredResearch}

⚠️ RELEVANCE FILTER INSTRUCTION:\nBefore using ANY research point in the outline, verify it directly relates to "${selectedTitle.targetKeyword}".\nIf a research point discusses other topics, types, or alternatives - DO NOT USE IT.

❹/ Business Context:
- Business: ${selectedPlan.businessName}
- Type: ${selectedPlan.businessTypeIdentifier}
${isLocalBusiness ? `- Location: ${location}` : `- Target Market: ${location}`}
${relevantServices.length > 0 ? `- Relevant Services (keyword-matched, do NOT mention others): ${relevantServices.join(', ')}` : '- Services: NONE match this keyword — do not invent or generalize service references'}

🛑 H2 HEADING VALIDATION — Before finalizing any section heading, ask:
"Does this heading ONLY discuss '${selectedTitle.targetKeyword}'?"
If the answer is NO or MAYBE — remove that section entirely. Not rename it. Remove it.
Every H2 that survives must be exclusively about "${selectedTitle.targetKeyword}".

Note: Internal links will be provided separately at the writing stage. Do NOT plan for them in this outline.

Develop a detailed structure with the following specifications:

1/- Overall Structure:

• Create main headings and subheadings that ALL relate to "${selectedTitle.targetKeyword}"

• Ensure high keyword density while maintaining natural language flow

• Naturally mention ${selectedPlan.businessName} ONLY in context of "${selectedTitle.targetKeyword}"

2/- Assign word counts to each section totaling 600-800 words:

❶. Introduction (80 words) - focused on "${selectedTitle.targetKeyword}"
❷. Main Body (450-550 words distributed across 3-4 H2 sections) - ALL about "${selectedTitle.targetKeyword}"
❸. Conclusion (50 words) - summarizing "${selectedTitle.targetKeyword}"
❹. FAQ Section (20-120 words with 2-4 questions) - questions about "${selectedTitle.targetKeyword}" ONLY

3/- For each main section, provide:

• Key points to cover (must relate to "${selectedTitle.targetKeyword}")

• Relevant statistics or data from research (ONLY if about "${selectedTitle.targetKeyword}")

• Potential examples or case studies (ONLY about "${selectedTitle.targetKeyword}")

• Suggested visuals (images related to "${selectedTitle.targetKeyword}" ONLY)

• Where to naturally integrate internal links

• **[Insight_Constraint]**: The key points for each H2 must be the **most compelling, non-obvious piece of information** about "${selectedTitle.targetKeyword}" specifically.

• **[Novelty_Mandate]**: For the Introduction's key points, include a **single, controversial, or highly specialized claim** about "${selectedTitle.targetKeyword}" that serves as the article's core thesis.

4/- FAQ Section:

• Create 5-7 common questions about "${selectedTitle.targetKeyword}" SPECIFICALLY

• Do NOT include questions about related but different topics

• Provide concise, informative answers focused on "${selectedTitle.targetKeyword}"

5/- Throughout the outline:

• Incorporate "${selectedTitle.targetKeyword}" naturally

• Integrate insights from research (ONLY if directly about "${selectedTitle.targetKeyword}")

${extractedLinks.length > 0 ? '\n• Suggest placement for provided internal links\n' : ''}
${isLocalBusiness ? `• Consider local SEO for ${location}` : `• Focus on broad industry appeal for ${location} market`}

**[Thinking_Process]**: Before generating the final JSON outline, identify any research points that are NOT directly about "${selectedTitle.targetKeyword}" and EXCLUDE them from the outline. **DO NOT include this thought process in the final JSON output.**

Present the outline in a clear, hierarchical format using markdown. Your goal is to create a laser-focused, SEO-optimized outline about "${selectedTitle.targetKeyword}" ONLY.

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

🎯 ABSOLUTE TOPIC BOUNDARY - READ THIS FIRST:
Write ONLY about "${selectedTitle.targetKeyword}". 
- If research mentions other topics, ignore them COMPLETELY
- Do NOT write about related but different topics, tools, types, or alternatives
- Do NOT mention other options even if they seem relevant
- Stay laser-focused on "${selectedTitle.targetKeyword}" throughout the ENTIRE article
- Example: If keyword is "rose gardening", do NOT mention tulips, daisies, or general gardening
- Example: If keyword is "leak repair", do NOT mention drain cleaning or pipe installation

BUSINESS CONTEXT:
- Business: ${selectedPlan.businessName}
- Type: ${selectedPlan.businessTypeIdentifier}
${isLocalBusiness ? `- Location: ${location}` : `- Target Market: ${location}`}
- Services: ${services.map((s) => s.name || s).join(', ')}

⚠️ SERVICE FILTER:
ONLY mention services from the list above that are DIRECTLY relevant to "${selectedTitle.targetKeyword}".
Do NOT mention unrelated services even if they are in the business's service list.

RESEARCH & DATA:
${filteredResearch}

⚠️ RESEARCH FILTER INSTRUCTION:
Before using ANY research point, verify it directly relates to "${selectedTitle.targetKeyword}".
If a research point discusses other topics, types, or alternatives - DO NOT USE IT in the blog.

OUTLINE TO FOLLOW:
${JSON.stringify(outlineData.outline, null, 2)}
${cappedExtractedLinks.length > 0 ? `\nINTERNAL LINKS (use 1-2 max — only if directly relevant to "${selectedTitle.targetKeyword}", skip the rest):\n${cappedExtractedLinks.join('\n')}\n` : ''}
WRITING REQUIREMENTS:

1. **Tone & Style**:
   - Professional yet conversational
   - **Engaging, HYPER-CONCISE, and direct**
   - Short paragraphs (2-4 sentences)
   - Use transition words
   - Address the reader directly
   - **[Filler_Prohibition]**: **STRICTLY FORBID** the use of clichés, rhetorical filler, and vague transitions. This includes, but is not limited to: "In today's digital landscape," "It's important to note," "At the end of the day," and "In conclusion." **Write directly and powerfully.**
   - **[Actionability_Mandate]**: Every H2 section **must** end with a **bolded, bulleted list** titled "**3 Key Takeaways**" or "**Action Items**."

2. **SEO Optimization**:
   - Use "${selectedTitle.targetKeyword}" naturally 5-7 times
   - Include keyword variations of "${selectedTitle.targetKeyword}" ONLY
   - Use H2 and H3 headings from the outline (all must relate to "${selectedTitle.targetKeyword}")
   - Optimize for featured snippets about "${selectedTitle.targetKeyword}"

3. **${isLocalBusiness ? 'Local' : 'Market'} SEO**:
${isLocalBusiness
      ? `   - Mention ${location} naturally throughout
   - Reference local context where relevant to "${selectedTitle.targetKeyword}"
   - Naturally promote ${selectedPlan.businessName} for "${selectedTitle.targetKeyword}" services`
      : `   - Focus on industry-wide appeal for ${location} market
   - DO NOT force location into content unnaturally
   - Naturally promote ${selectedPlan.businessName} as a solution for "${selectedTitle.targetKeyword}"`}

4. **Content Structure**:
   - Follow the outline's word counts (**STRICTLY adhere to 600-800 words total, NO exceptions**)
   - Include all sections: Introduction, Main Body, Conclusion, FAQs
   - Use bullet points and numbered lists
   - Bold important terms related to "${selectedTitle.targetKeyword}"

5. **Business Integration**:
   - Mention ONLY these pre-filtered services: ${relevantServices.length > 0 ? relevantServices.join(', ') : '(none — do not invent or generalize service references)'}
   ${cappedExtractedLinks.length > 0 ? '- Include 1-2 internal links only if they land on a page directly about the target keyword\n   ' : ''}- Add a clear call-to-action mentioning ${selectedPlan.businessName} in context of "${selectedTitle.targetKeyword}"

6. **Credibility**:
   - Use statistics from research (ONLY if about "${selectedTitle.targetKeyword}")
   - Reference authoritative sources (ONLY if about "${selectedTitle.targetKeyword}")
   - Provide actionable advice about "${selectedTitle.targetKeyword}"

7. **CRITICAL - External Links**:
   - NEVER add any external links under any circumstances
   - NEVER link to external websites, sources, or references
   - DO NOT create hyperlinks to external domains
   - You may mention sources by name (e.g., "According to Harvard Business Review") but DO NOT link to them
   ${extractedLinks.length > 0 ? '- ONLY use the internal links provided in the INTERNAL LINKS section above\n   - Do NOT add any links that are not in the provided list' : '- Do NOT add any links whatsoever'}

🔍 FINAL VERIFICATION BEFORE WRITING:
Review the research and outline. Remove or ignore ANY content that is not directly about "${selectedTitle.targetKeyword}".

OUTPUT FORMAT:
Write the complete blog post in **markdown format**. Use proper markdown syntax for:
- # H1 (title)
- ## H2 (main sections) - ALL must be about "${selectedTitle.targetKeyword}"
- ### H3 (subsections) - ALL must be about "${selectedTitle.targetKeyword}"
- **bold text**
- [link text](url) - ONLY for internal links from the provided list
- Bullet points with -
- Numbered lists

Start writing now. Output ONLY the markdown blog post about "${selectedTitle.targetKeyword}", no additional commentary.`;

  console.log('📡 Calling Claude API for blog generation...');

  const blogSystemPrompt = `You are a laser-focused SEO writer. You write exclusively about the exact topic given to you. You treat any off-topic content as invisible — you do not acknowledge it, reference it, or include it. If your outline or research mentions anything not directly about the target keyword, you skip it entirely and stay on topic.`;

  const blogContent = await callClaude(blogPrompt, 8000, blogSystemPrompt, 'claude-opus-4-6');

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
    researchData: filteredResearch,
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
