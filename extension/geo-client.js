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
  const OFFICE_CACHE_KEY = "flatfinder.officeCoords";

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

  async function geocodeOffice(officeAddress) {
    const cached = loadCache(OFFICE_CACHE_KEY);
    if (cached && cached.lat) return cached;
    const result = await geocode(officeAddress);
    if (result) saveCache(OFFICE_CACHE_KEY, result);
    return result;
  }

  async function commuteMinutes(origin, dest) {
    if (!origin || !dest) return { minutes: null, source: null };
    const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
    try {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`);
      const data = await res.json();
      if (data.code === "Ok" && data.routes && data.routes.length) {
        return { minutes: data.routes[0].duration / 60, source: "osrm_driving" };
      }
    } catch {
      // fall through to unknown
    }
    return { minutes: null, source: null };
  }

  root.FlatFinderGeo = { geocode, geocodeOffice, commuteMinutes };
})(typeof window !== "undefined" ? window : this);
