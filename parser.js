// Shared free-text -> listing-fields parser.
// Used by: the Chrome extension popup, the mobile share-target page
// (share.html), and the "paste from a group post" box in the main site's
// Add a listing form. One parsing implementation, three capture surfaces.
//
// This does NOT fetch or read anything on its own — it only turns text the
// user already has in front of them (pasted, selected, or shared) into
// structured fields for review before saving.

(function (root) {
  const TARGET_LOCALITIES = [
    // Manyata Tech Park / North Bangalore
    "manyata", "hebbal", "nagawara", "thanisandra", "hbr layout", "hrbr",
    "jakkur", "yelahanka", "rt nagar", "hennur", "kalyan nagar",
    "banaswadi", "kammanahalli", "horamavu",
    // Indiranagar
    "indiranagar", "indira nagar", "indranagar", "domlur",
    // HSR Layout
    "hsr layout", "hsr", "agara", "sector 1", "sector 2", "sector 3",
    "sector 4", "sector 5", "sector 6", "sector 7",
  ];

  const FURNISHING_PATTERNS = [
    [/\bfully[\s-]?furnished\b|\bfull furnish/i, "full"],
    [/\bsemi[\s-]?furnished\b/i, "semi"],
    [/\bun[\s-]?furnished\b|\bbare\s?shell\b|\bno furnishing\b/i, "none"],
  ];

  const NO_BROKERAGE_RE = /\bno\s*[- ]?brokerage\b|\bzero\s*brokerage\b|\bbrokerage\s*free\b|\bno\s*broker\b|\bwithout\s*brokerage\b/i;
  const HAS_BROKERAGE_RE = /\bbrokerage\s*(applicable|involved|:?\s*yes)\b|\bbroker\s*contact\b|\b1\s*month\s*brokerage\b|\bbrokerage\s*charges?\b/i;

  // Indian mobile numbers: optional +91/91 prefix, then a 10-digit number
  // starting 6-9. Also catches wa.me/+91XXXXXXXXXX links.
  const PHONE_RE = /(?:\+?91[\s-]?)?([6-9]\d{9})\b/;
  const WA_LINK_RE = /wa\.me\/\+?(\d{10,12})/i;

  function stripHtml(html) {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#33;/g, "!")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function findLocality(text) {
    const lower = text.toLowerCase();
    for (const key of TARGET_LOCALITIES) {
      if (lower.includes(key)) {
        // Title-case the matched keyword for display.
        return key.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    return "";
  }

  function findBhk(text) {
    const m = text.match(/(\d(?:\.\d)?)\s*[- ]?\s*bhk/i);
    if (m) return parseFloat(m[1]);
    if (/\bstudio\b/i.test(text)) return 1;
    return null;
  }

  function findFurnishing(text) {
    for (const [re, value] of FURNISHING_PATTERNS) {
      if (re.test(text)) return value;
    }
    return "";
  }

  function parseMoneyValue(raw) {
    raw = raw.replace(/₹|\s/g, "");
    let multiplier = 1;
    if (/k$/i.test(raw)) {
      multiplier = 1000;
      raw = raw.replace(/k$/i, "");
    }
    const num = parseFloat(raw.replace(/,/g, ""));
    if (Number.isNaN(num)) return null;
    const amount = num * multiplier;
    // Guards against false positives like "for Rent in ... Sector 7" (bare
    // "7") — real rent/deposit figures in Bangalore are never under four
    // digits, so treat anything smaller as a non-match rather than trust it.
    return amount >= 1000 ? amount : null;
  }

  function findMoney(text, keywords) {
    // Looks for a keyword (e.g. "rent", "deposit") near a number, or a bare
    // ₹ amount. Handles "20k", "20,000", "Rs 20000", "₹20,000". A keyword can
    // appear more than once (e.g. "Apartment for Rent in HSR, Sector 7"
    // before the real "Rent: 33k") — check every occurrence in order and
    // keep the first one that parses to a plausible amount.
    const kwPattern = keywords.join("|");
    const nearKeyword = new RegExp(
      `(?:${kwPattern})[^\\d₹]{0,15}(₹?\\s?[\\d,]+\\s?k?)`,
      "gi"
    );
    let m;
    while ((m = nearKeyword.exec(text))) {
      const amount = parseMoneyValue(m[1]);
      if (amount !== null) return amount;
    }
    const bareRe = /₹\s?([\d,]+\s?k?)/gi;
    let b;
    while ((b = bareRe.exec(text))) {
      const amount = parseMoneyValue(b[1]);
      if (amount !== null) return amount;
    }
    return null;
  }

  function findBrokerage(text) {
    if (NO_BROKERAGE_RE.test(text)) return false;
    if (HAS_BROKERAGE_RE.test(text)) return true;
    return null; // unknown — leave for the human to confirm
  }

  function findContact(text) {
    const wa = text.match(WA_LINK_RE);
    if (wa) return `WhatsApp: +${wa[1]}`;
    const phone = text.match(PHONE_RE);
    if (phone) return phone[0].replace(/[\s-]/g, "");
    return "";
  }

  function findTitle(text) {
    const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean);
    return firstLine ? firstLine.slice(0, 120) : "";
  }

  /**
   * @param {string} rawText - pasted/selected/shared text, may contain HTML.
   * @param {object} [context] - { sourceUrl }
   * @returns {object} listing fields, plus `confidence` flags for fields
   *   that were not found and need the user to fill in by hand.
   */
  function parse(rawText, context) {
    context = context || {};
    const isHtml = /<[a-z][\s\S]*>/i.test(rawText);
    const text = isHtml ? stripHtml(rawText) : rawText.trim();

    const locality = findLocality(text);
    const bhk = findBhk(text);
    const furnishing = findFurnishing(text);
    const rent = findMoney(text, ["rent", "monthly rent", "per month", "/mo"]);
    const deposit = findMoney(text, ["deposit", "advance"]);
    const brokerage = findBrokerage(text);
    const contact = findContact(text);
    const title = findTitle(text);

    return {
      title,
      locality,
      distanceKm: "",
      bhk: bhk || "",
      furnishing: furnishing || "",
      rent: rent || "",
      deposit: deposit || "",
      brokerage: brokerage === true,
      contact,
      source: context.sourceUrl ? new URL(context.sourceUrl).hostname : "Pasted",
      link: context.sourceUrl || "",
      notes: text,
      confidence: {
        locality: !!locality,
        bhk: bhk !== null,
        furnishing: !!furnishing,
        rent: rent !== null,
        brokerage: brokerage !== null,
        contact: !!contact,
      },
    };
  }

  root.FlatFinderParser = { parse, TARGET_LOCALITIES };
})(typeof self !== "undefined" ? self : this);
