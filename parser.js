// Shared free-text -> listing-fields parser. Mirrors pipeline/extraction.py
// field-for-field so a listing captured by hand (extension, mobile share,
// paste box) is extracted the same way a scraped one is.
//
// Used by: the Chrome extension popup, the mobile share-target page
// (share.html), and the "paste from a group post" box in the main site's
// Add a listing form. This does NOT fetch or read anything on its own — it
// only turns text the user already has in front of them into structured
// fields for review before saving. Every field defaults to null
// ("UNKNOWN") rather than guessing.

(function (root) {
  const FURNISHING_PATTERNS = [
    [/\bsemi[\s-]?furnished\b/i, "semi"],
    [/\bfully[\s-]?furnished\b|\bfull(?:y)?\s*furnish/i, "full"],
    [/\bun[\s-]?furnished\b|\bbare\s?shell\b|\bno furnishing\b/i, "none"],
  ];

  const LIFT_YES_RE = /\blift\s*(available|present|:?\s*yes)\b|\bwith\s+lift\b|\belevator\s*(available|present)\b/i;
  const LIFT_NO_RE = /\bno\s+lift\b|\blift\s*:?\s*no\b|\bwithout\s+lift\b|\bno\s+elevator\b/i;
  const LIFT_BARE_RE = /\blift\b|\belevator\b/i;

  const NO_BROKERAGE_RE = /\bno\s*[- ]?brokerage\b|\bzero\s*brokerage\b|\bbrokerage\s*free\b|\bno\s*broker\b|\bwithout\s*brokerage\b|\bbrokerage\s*:?\s*(?:nil|0|zero)\b/i;
  const HAS_BROKERAGE_RE = /\bbrokerage\s*(applicable|involved|:?\s*yes)\b|\bbroker\s*contact\b|\b\d+\s*month'?s?\s*brokerage\b/i;

  const OWNER_RE = /\bowner\s*direct\b|\bdirect\s*from\s*owner\b|\bposted\s*by\s*owner\b|\bno\s*brokers?\s*please\b|\(owner\)/i;
  const BROKER_RE = /\bbroker\b(?!s?\s*please)|\bagent\b|\bproperty\s*consultant\b|\breal\s*estate\s*agent\b/i;

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
    return null;
  }

  function findLift(text) {
    if (LIFT_NO_RE.test(text)) return false;
    if (LIFT_YES_RE.test(text)) return true;
    if (LIFT_BARE_RE.test(text)) return true;
    return null;
  }

  function findBrokerage(text) {
    // Returns { status: "zero"|"broker"|null, amount: 0|null }
    if (NO_BROKERAGE_RE.test(text)) return { status: "zero", amount: 0 };
    if (HAS_BROKERAGE_RE.test(text)) return { status: "broker", amount: null };
    return { status: null, amount: null };
  }

  function findOwnerStatus(text) {
    if (OWNER_RE.test(text)) return "owner";
    if (BROKER_RE.test(text)) return "broker";
    return null;
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
    // Real rent/deposit figures in Bangalore are never under four digits.
    return amount >= 1000 ? amount : null;
  }

  function findMoney(text, keywords) {
    const kwPattern = keywords.join("|");
    const nearKeyword = new RegExp(`(?:${kwPattern})[^\\d₹]{0,15}(₹?\\s?[\\d,]+\\s?k?)`, "gi");
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

  function findContact(text) {
    const wa = text.match(WA_LINK_RE);
    if (wa) return `WhatsApp: +${wa[1]}`;
    const phone = text.match(PHONE_RE);
    if (phone) return phone[0].replace(/[\s-]/g, "");
    return null;
  }

  function findTitle(text) {
    const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean);
    return firstLine ? firstLine.slice(0, 120) : null;
  }

  function findLocation(text) {
    const m = text.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\s*(?:Nagar|Layout|Colony|Extension|Cross|Block|Road|Town|Halli|Palya))\b/);
    return m ? m[1].trim() : null;
  }

  /**
   * @param {string} rawText - pasted/selected/shared text, may contain HTML.
   * @param {object} [context] - { sourceUrl }
   * @returns {object} listing fields (pipeline Listing shape, camelCase),
   *   plus `confidence` flags for fields the parser wasn't sure about.
   */
  function parse(rawText, context) {
    context = context || {};
    const isHtml = /<[a-z][\s\S]*>/i.test(rawText);
    const text = isHtml ? stripHtml(rawText) : rawText.trim();

    const bhk = findBhk(text);
    const furnishing = findFurnishing(text);
    const lift = findLift(text);
    const rent = findMoney(text, ["rent", "monthly rent", "per month", "/mo"]);
    const deposit = findMoney(text, ["deposit", "advance"]);
    const brokerage = findBrokerage(text);
    const ownerStatus = findOwnerStatus(text);
    const contact = findContact(text);
    const title = findTitle(text);
    const location = findLocation(text);

    return {
      title,
      location,
      address: location,
      bhk,
      furnishing,
      lift,
      rent,
      deposit,
      brokerageStatus: brokerage.status,
      brokerageAmount: brokerage.amount,
      ownerStatus,
      contact,
      source: context.sourceUrl ? new URL(context.sourceUrl).hostname : "Manual capture",
      url: context.sourceUrl || null,
      rawText: text,
      confidence: {
        location: !!location,
        bhk: bhk !== null,
        furnishing: !!furnishing,
        lift: lift !== null,
        rent: rent !== null,
        deposit: deposit !== null,
        brokerageStatus: brokerage.status !== null,
        ownerStatus: ownerStatus !== null,
        contact: !!contact,
      },
    };
  }

  root.FlatFinderParser = { parse };
})(typeof self !== "undefined" ? self : this);
