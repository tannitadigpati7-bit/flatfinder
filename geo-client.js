// Client-side geocoding + commute calculation for listings captured by hand
// (the "+ Add a listing" paste box, the extension, the mobile share
// target) — mirrors pipeline/geocode.py and pipeline/commute.py so a
// manually captured listing gets held to the exact same hard filter as a
// scraped one, not treated as pre-approved.
//
// No Google Maps key is used here (a paid key belongs on a server, never
// shipped in client-side JS where anyone can read it out of the page
// source and run up your bill) — manually captured listings get an OSRM
// (no live traffic) commute estimate, same honest commuteSource tagging
// as the pipeline. Traffic-aware commute is only available for listings
// the scheduled pipeline discovers server-side.

(function (root) {
  const NOMINATIM_CACHE_KEY = "flatfinder.geocodeCache";
  const COMMUTE_CACHE_KEY = "flatfinder.commuteCache";

  function loadCache(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      return {};
    }
  }
  function saveCache(key, cache) {
    try {
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      // best-effort only — a full/unavailable localStorage just means no caching
    }
  }

  async function geocode(queryText) {
    if (!queryText || !queryText.trim()) return null;
    const cache = loadCache(NOMINATIM_CACHE_KEY);
    const key = queryText.trim().toLowerCase();
    if (key in cache) return cache[key];

    const searchText = /bangalore|bengaluru/.test(key) ? queryText : `${queryText}, Bangalore, India`;
    const params = new URLSearchParams({ q: searchText, format: "jsonv2", limit: "1", countrycodes: "in" });
    let result = null;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "Accept-Language": "en" },
      });
      const data = await res.json();
      if (data && data.length) {
        result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch {
      return null; // network failure -> unknown, not cached, retry later
    }
    cache[key] = result;
    saveCache(NOMINATIM_CACHE_KEY, cache);
    return result;
  }

  // Just geocode() under a clearer name for call sites geocoding "the
  // office" specifically — geocode()'s own cache is already keyed by the
  // address text, so two different office addresses (e.g. two visitors
  // with different personal profiles, see profile.js) each get their own
  // correctly cached coordinates rather than sharing one slot.
  async function geocodeOffice(officeAddress) {
    return geocode(officeAddress);
  }

  async function commuteMinutes(origin, dest) {
    if (!origin || !dest) return { minutes: null, source: null };
    const cache = loadCache(COMMUTE_CACHE_KEY);
    const key = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}->${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
    if (key in cache) return cache[key];

    const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
    let result = { minutes: null, source: null };
    try {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`);
      const data = await res.json();
      if (data.code === "Ok" && data.routes && data.routes.length) {
        result = { minutes: data.routes[0].duration / 60, source: "osrm_driving" };
      }
    } catch {
      return { minutes: null, source: null }; // network failure -> unknown, not cached, retry later
    }
    cache[key] = result;
    saveCache(COMMUTE_CACHE_KEY, cache);
    return result;
  }

  root.FlatFinderGeo = { geocode, geocodeOffice, commuteMinutes };
})(typeof window !== "undefined" ? window : this);
