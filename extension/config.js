// Shared configuration for the site, the Chrome extension, and the mobile
// share target. Keep REQUIREMENTS/OFFICE_ADDRESS in sync with
// pipeline/config.py — the Python pipeline and this client-side code
// apply the exact same hard filter, just against different discovery paths
// (scheduled scrapers vs. a listing you paste in yourself).
const CONFIG = {
  // Paste your Supabase project URL and anon (public) key here to enable a
  // shared, live listings database (see README.md > "Setting up the shared
  // backend"). The anon key is safe to ship in client-side code — it can
  // only do what supabase/schema.sql's row-level-security policies allow
  // (read everything, insert new rows; never update or delete). Never put
  // your service_role key here.
  SUPABASE_URL: "https://ihottroqpydcebpmnjul.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlob3R0cm9xcHlkY2VicG1uanVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NjAzMjMsImV4cCI6MjEwNDQzNjMyM30.UnUcs13oXVjst1aWSZ6aATHlY4IVncW4lFnJfcOXFJc",

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
