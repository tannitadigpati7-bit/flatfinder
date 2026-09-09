// Minimal Supabase REST (PostgREST) client — the calls FlatFinder needs
// against the `listings` table (see supabase/schema.sql): read everything,
// insert a manually captured listing, and update just the notes/
// personal_status columns on an existing row. Uses the public anon key,
// which row-level security + column grants restrict to exactly these
// operations — see schema.sql's policy comments for what it can't do
// (in particular: it cannot touch match_status, score, or any other
// pipeline-owned field).

(function (root) {
  function config() {
    let url = (typeof CONFIG !== "undefined" && CONFIG.SUPABASE_URL) || "";
    // Supabase's dashboard shows the Project URL right next to the REST API
    // path (.../rest/v1/) — an easy copy-paste mistake. Strip it so a typo
    // here doesn't 404 every request instead of just fixing itself.
    url = url.replace(/\/rest\/v1\/?$/, "");
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

  // Only ever sends notes/personal_status — the anon key's write access is
  // restricted to exactly those two columns at the database level (see
  // supabase/schema.sql), so sending anything else here would just fail.
  async function updateNotes(id, fields) {
    const { url, key } = config();
    if (!url || !key) throw new Error("Supabase not configured");
    const body = {};
    if ("notes" in fields) body.notes = fields.notes;
    if ("personal_status" in fields) body.personal_status = fields.personal_status;
    const res = await fetch(`${url}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  root.FlatFinderSupabase = { isConfigured, fetchListings, insertListing, updateNotes };
})(typeof window !== "undefined" ? window : this);
