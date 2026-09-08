// Minimal Supabase REST (PostgREST) client — just the two calls FlatFinder
// needs against the `listings` table (see supabase/schema.sql): read
// everything, insert a manually captured listing. Uses the public anon
// key, which row-level security restricts to exactly those two
// operations — see schema.sql's policy comments for what it can't do.

(function (root) {
  function config() {
    const url = (typeof CONFIG !== "undefined" && CONFIG.SUPABASE_URL) || "";
    const key = (typeof CONFIG !== "undefined" && CONFIG.SUPABASE_ANON_KEY) || "";
    return { url, key };
  }

  function isConfigured() {
    const { url, key } = config();
    return !!(url && key);
  }

  async function fetchListings() {
    const { url, key } = config();
    if (!url || !key) return [];
    try {
      const res = await fetch(`${url}/rest/v1/listings?select=*`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  async function insertListing(record) {
    const { url, key } = config();
    if (!url || !key) throw new Error("Supabase not configured");
    const res = await fetch(`${url}/rest/v1/listings`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return rows[0];
  }

  root.FlatFinderSupabase = { isConfigured, fetchListings, insertListing };
})(typeof window !== "undefined" ? window : this);
