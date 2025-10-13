const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
let credential;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production: Use environment variable (JSON string)
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  credential = admin.credential.cert(serviceAccount);
} else {
  // Development: Use local JSON file
  const serviceAccount = require('./typonix-50d87-firebase-adminsdk-fbsvc-b988c04a72.json');
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
