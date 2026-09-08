// Client-side hard filter — mirrors pipeline/filtering.py exactly so a
// listing captured by hand goes through the same confirmed /
// needs_verification / rejected decision as one the scheduled pipeline
// found. Also builds the final stored record shape (snake_case, matching
// pipeline/listing_schema.py's Listing.to_dict()) so every listing in the
// shared database — scraped or manually captured — has one shape.

(function (root) {
  function checkBhk(l, req) {
    if (l.bhk === null || l.bhk === undefined) return ["unknown", "bhk: UNKNOWN"];
    if (l.bhk !== req.bhk) return ["fail", `bhk is ${l.bhk}, need ${req.bhk}`];
    return ["pass", ""];
  }
  function checkFurnishing(l, req) {
    if (!l.furnishing) return ["unknown", "furnishing: UNKNOWN"];
    if (l.furnishing !== req.furnishing) return ["fail", `furnishing is ${l.furnishing}, need ${req.furnishing}`];
    return ["pass", ""];
  }
  function checkRent(l, req) {
    if (l.rent === null || l.rent === undefined) return ["unknown", "rent: UNKNOWN"];
    if (l.rent > req.maxRent) return ["fail", `rent ₹${l.rent} exceeds ₹${req.maxRent}`];
    return ["pass", ""];
  }
  function checkDeposit(l, req) {
    if (l.deposit === null || l.deposit === undefined) return ["unknown", "deposit: UNKNOWN"];
    if (l.deposit > req.maxDeposit) return ["fail", `deposit ₹${l.deposit} exceeds ₹${req.maxDeposit}`];
    return ["pass", ""];
  }
  function checkLift(l) {
    if (l.lift === null || l.lift === undefined) return ["unknown", "lift: UNKNOWN"];
    if (l.lift !== true) return ["fail", "no lift"];
    return ["pass", ""];
  }
  function checkBrokerage(l) {
    if (!l.brokerage_status) return ["unknown", "brokerage: UNKNOWN"];
    if (l.brokerage_status !== "zero") return ["fail", "brokerage applies"];
    return ["pass", ""];
  }
  function checkCommute(l, req) {
    if (l.commute_minutes === null || l.commute_minutes === undefined) return ["unknown", "commute: UNKNOWN"];
    if (l.commute_minutes > req.maxCommuteMinutes) return ["fail", `commute ${Math.round(l.commute_minutes)} min exceeds ${req.maxCommuteMinutes} min`];
    return ["pass", ""];
  }

  function applyHardFilter(listing, requirements) {
    const checks = [
      checkBhk(listing, requirements),
      checkFurnishing(listing, requirements),
      checkRent(listing, requirements),
      checkDeposit(listing, requirements),
      checkLift(listing, requirements),
      checkBrokerage(listing, requirements),
      checkCommute(listing, requirements),
    ];
    const failReasons = [];
    const unknownFields = [];
    let anyFail = false;
    let anyUnknown = false;
    for (const [result, message] of checks) {
      if (result === "fail") { anyFail = true; failReasons.push(message); }
      else if (result === "unknown") { anyUnknown = true; unknownFields.push(message.split(":")[0]); }
    }
    listing.fail_reasons = failReasons;
    listing.unknown_fields = unknownFields;
    listing.match_status = anyFail ? "rejected" : anyUnknown ? "needs_verification" : "confirmed";
    return listing;
  }

  function buildStoredListing(parsed, extra) {
    const now = new Date().toISOString();
    return {
      source: parsed.source || "Manual capture",
      source_listing_id: extra.sourceListingId || `manual-${Date.now()}`,
      url: parsed.url || null,
      title: parsed.title || null,
      raw_text: parsed.rawText || null,
      first_seen: now,
      last_seen: now,
      last_verified: now,
      source_status: "active",
      bhk: parsed.bhk ?? null,
      rent: parsed.rent ?? null,
      deposit: parsed.deposit ?? null,
      furnishing: parsed.furnishing ?? null,
      lift: parsed.lift ?? null,
      brokerage_amount: parsed.brokerageAmount ?? null,
      brokerage_status: parsed.brokerageStatus ?? null,
      owner_status: parsed.ownerStatus ?? null,
      location: parsed.location ?? null,
      address: parsed.address ?? null,
      available_from: parsed.availableFrom ?? null,
      lat: extra.lat ?? null,
      lng: extra.lng ?? null,
      geocode_source: extra.lat != null ? "nominatim" : null,
      geocode_query: parsed.address || parsed.location || null,
      commute_minutes: extra.commuteMinutes ?? null,
      commute_source: extra.commuteSource ?? null,
      match_status: "needs_verification",
      fail_reasons: [],
      unknown_fields: [],
      dedup_key: null,
      merged_sources: [],
      score: null,
      score_reasons: [],
    };
  }

  root.FlatFinderFilter = { applyHardFilter, buildStoredListing };
})(typeof window !== "undefined" ? window : this);
