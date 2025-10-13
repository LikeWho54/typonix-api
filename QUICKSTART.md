# 🚀 Quick Start Guide - TyponixAPI

## Prerequisites

- Node.js (v16 or higher)
- Yarn package manager
- Firebase project with Admin SDK
- API keys for DataForSEO, OpenAI, and Jina.ai

## Step 1: Install Dependencies

```bash
cd typonixAPI
yarn install
```

## Step 2: Set Up Environment Variables

```bash
# Copy the example env file
cp .env.example .env

# Edit .env and fill in your API keys
nano .env  # or use your preferred editor
```

Required variables:
- `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`
- `OPENAI_API_KEY`
- `JINA_API_KEY`
- `FIREBASE_DATABASE_URL`

## Step 3: Add Firebase Service Account

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** → **Service Accounts**
4. Click **Generate new private key**
5. Save the JSON file in the `typonixAPI` directory
6. Update `firebase.js` if the filename is different

## Step 4: Start the Server

```bash
yarn start
```

You should see:
```
✅ Firebase Admin initialized successfully
🚀 typonixAPI server running on port 3000
```

## Step 5: Test the API

### Check server health
```bash
curl http://localhost:3000/health
```

### Check environment setup
```bash
curl http://localhost:3000/seo/debug-env
```

### Start an SEO analysis
```bash
curl -X POST http://localhost:3000/seo/start-analysis \
  -H "Content-Type: application/json" \
  -d '{"uid":"YOUR_USER_ID"}'
```

### Check analysis status
```bash
curl "http://localhost:3000/seo/status?uid=YOUR_USER_ID"
```

## 📊 Expected Response Flow

1. **Start Analysis:** Returns immediately with status "processing"
   ```json
   {
     "success": true,
     "message": "SEO analysis started successfully",
     "uid": "user123",
     "status": "processing"
   }
   ```

2. **Check Status (while running):**
   ```json
   {
     "status": "processing",
     "startedAt": "2025-10-11T19:30:00.000Z",
     "completedAt": null,
     "error": null
   }
   ```

3. **Check Status (completed):**
   ```json
   {
     "status": "completed",
     "startedAt": "2025-10-11T19:30:00.000Z",
     "completedAt": "2025-10-11T19:45:00.000Z",
     "error": null
   }
   ```

## ⏱️ Analysis Duration

- **Local Business:** 5-10 minutes
- **Online Business:** 10-15 minutes

Factors affecting duration:
- Number of competitors discovered
- Website scraping speed
- Number of keywords to analyze
- API response times

## 🔍 What Gets Saved to Firestore

After successful analysis, the user document will have:

```javascript
{
  seoAnalysisStatus: "completed",
  seoAnalysisStartedAt: Timestamp,
  seoAnalysisCompletedAt: Timestamp,
  seoAnalysisResults: { /* analysis data */ },
  targetKeywords: ["keyword1", "keyword2", ...], // Top 20
  competitors: ["https://competitor1.com", ...] // Updated list
}
```

Plus subcollections:
- `users/{uid}/intersections/shared/websites/{domain}` - Shared keywords
- `users/{uid}/intersections/unique/websites/{domain}` - Unique keywords

## 🐛 Troubleshooting

### Server won't start
- Check that all environment variables are set correctly
- Verify Firebase service account JSON is in the correct location
- Run `yarn install` to ensure all dependencies are installed

### Analysis fails immediately
- Check that user exists in Firestore
- Verify `onboardingCompleted: true` in user document
- Check server logs for specific error messages

### Analysis stuck in "processing"
- Check server logs for errors
- Verify API keys are valid and have sufficient credits
- Check network connectivity to external APIs

### "User not found" error
- Ensure the user document exists in Firestore
- Verify you're using the correct `uid`
- Check Firebase permissions

## 📝 Next Steps

1. Test with a real user from your database
2. Monitor API costs in DataForSEO dashboard
3. Set up error monitoring (optional)
4. Deploy to production server (see README.md)
5. Add authentication middleware for security

## 🔗 Useful Links

- [DataForSEO Documentation](https://docs.dataforseo.com/)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Jina.ai Documentation](https://docs.jina.ai/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)

## 💡 Tips

- **Monitor costs:** DataForSEO charges per API call. Start with small tests.
- **Test locally first:** Always test with development data before production.
- **Check logs:** Server logs provide detailed progress information.
- **Use debug endpoint:** `/seo/debug-env` helps verify configuration.

---

**Ready to analyze!** 🎉

If you encounter any issues, check the full README.md for detailed documentation.
