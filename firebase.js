const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require('./typonix-50d87-firebase-adminsdk-fbsvc-b988c04a72.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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
