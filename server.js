require('dotenv').config();
const express = require('express');
const { db, auth } = require('./firebase');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const seoRoutes = require('./routes/seo');
const contentRoutes = require('./routes/content');
const keywordRoutes = require('./routes/keywords');

// Basic route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to typonixAPI',
    status: 'running',
    firebase: 'connected',
    endpoints: {
      seo: {
        status: 'GET /seo/status?uid=<uid>',
        debugEnv: 'GET /seo/debug-env',
        startAnalysis: 'POST /seo/start-analysis',
        processAnalysis: 'POST /seo/process-analysis'
      },
      content: {
        generateTitles: 'POST /content/generate-titles',
        generateBlog: 'POST /content/generate-blog'
      },
      keywords: {
        generateIdeas: 'POST /keywords/ideas'
      }
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    firebase: 'initialized'
  });
});

// Mount routes
app.use('/seo', seoRoutes);
app.use('/content', contentRoutes);
app.use('/keywords', keywordRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 typonixAPI server running on port ${PORT}`);
});
