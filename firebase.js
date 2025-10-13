const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
let credential;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('🔧 Using FIREBASE_SERVICE_ACCOUNT from environment variable');
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Service account parsed successfully');
    console.log('📧 Client email:', serviceAccount.client_email);
    console.log('🆔 Project ID:', serviceAccount.project_id);
    credential = admin.credential.cert(serviceAccount);
  } catch (error) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error.message);
    throw error;
  }
} else {
  console.log('🔧 Using local service account JSON file');
  const serviceAccount = require('./typonix-50d87-firebase-adminsdk-fbsvc-d38babd164.json');
  credential = admin.credential.cert(serviceAccount);
}

admin.initializeApp({
  credential: credential,
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const auth = admin.auth();

console.log('✅ Firebase Admin initialized successfully');

module.exports = {
  admin,
  db,
  auth
};
