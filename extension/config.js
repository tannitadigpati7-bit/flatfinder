// Shared configuration for the site, the Chrome extension, and the mobile
// share target. Keep REQUIREMENTS/OFFICE_ADDRESS in sync with
// pipeline/config.py — the Python pipeline and this client-side code
// apply the exact same hard filter, just against different discovery paths
// (scheduled scrapers vs. a listing you paste in yourself).
const CONFIG = {
  // Paste your Firebase Realtime Database URL here to enable a shared, live
  // listings database (see README.md > "Setting up the shared backend").
  FIREBASE_DB_URL: "https://flatfinder-6f65e-default-rtdb.firebaseio.com",

  OFFICE_NAME: "Bathla Aluminium Corporate Office",
  OFFICE_ADDRESS: "Bathla Aluminium Corporate Office, Vasanth Nagar, Bangalore, Karnataka, India",

  REQUIREMENTS: {
    bhk: 1,
    furnishing: "semi",
    maxRent: 15000,
    maxDeposit: 50000,
    lift: true,
    brokerageZero: true,
    maxCommuteMinutes: 30,
  },
};
