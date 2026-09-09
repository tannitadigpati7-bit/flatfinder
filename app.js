// FlatFinder — personal rental search. Requirements/office are driven by
// a per-browser profile (profile.js) — config.js only supplies the
// defaults a first-time sign-up form is pre-filled with. Reads listings
// the pipeline (pipeline/run.py, scheduled via GitHub Actions) has already
// discovered, extracted, geocoded, routed, and hard-filtered against the
// deployment owner's own default profile; a visitor with a *different*
// profile gets those decisions recomputed client-side against their own
// criteria (see recomputeForProfile) rather than just relabeling the
// owner's results.

let REQ = {};
let OFFICE_ADDRESS = "";
let OFFICE_NAME = "the office";

function applyProfile(profile) {
  REQ = profile.requirements;
  OFFICE_ADDRESS = profile.officeAddress;
  OFFICE_NAME = profile.officeName || "the office";
  officeCoordsPromise = null; // office address may have just changed — stop reusing the old one's cached coords
}

const state = { listings: [], cardSort: "commute", expandedId: null };

const els = {
  confirmed: document.getElementById("confirmedResults"),
  confirmedCount: document.getElementById("confirmedCount"),
  needsVerification: document.getElementById("needsVerificationResults"),
  needsVerificationCount: document.getElementById("needsVerificationCount"),
  needsVerificationToggle: document.getElementById("needsVerificationToggle"),
  nearMatches: document.getElementById("nearMatchResults"),
  nearMatchesSection: document.getElementById("nearMatchesSection"),
  emptyState: document.getElementById("emptyState"),
  addListingBtn: document.getElementById("addListingBtn"),
  addListingDialog: document.getElementById("addListingDialog"),
  addListingForm: document.getElementById("addListingForm"),
  cancelAdd: document.getElementById("cancelAdd"),
  pasteBox: document.getElementById("pasteBox"),
  parseStatus: document.getElementById("parseStatus"),
  viewCards: document.getElementById("viewCards"),
  viewTable: document.getElementById("viewTable"),
  cardsView: document.getElementById("cardsView"),
  tableView: document.getElementById("tableView"),
  allListingsBody: document.getElementById("allListingsBody"),
  allListingsTable: document.getElementById("allListingsTable"),
  cardSortSelect: document.getElementById("cardSortSelect"),
  detailDialog: document.getElementById("listingDetailDialog"),
  detailContent: document.getElementById("listingDetailContent"),
  closeDetail: document.getElementById("closeDetail"),
  settingsBtn: document.getElementById("settingsBtn"),
  editRequirements: document.getElementById("editRequirements"),
  requirementsList: document.getElementById("requirementsList"),
  onboarding: document.getElementById("onboarding"),
  onboardStep1: document.getElementById("onboardStep1"),
  onboardStep2: document.getElementById("onboardStep2"),
  onboardForm: document.getElementById("onboardForm"),
  onboardContinue: document.getElementById("onboardContinue"),
};

// ---------------------------------------------------------------- loading

async function loadListings() {
  els.confirmedCount.textContent = "Loading…";
  state.listings = await window.FlatFinderSupabase.fetchListings();

  const profile = window.FlatFinderProfile.getProfile();
  if (!window.FlatFinderProfile.isDefaultProfile(profile)) {
    els.confirmedCount.textContent = "Checking listings against your criteria…";
    await recomputeForProfile(profile);
  }

  render();
}

// Recomputes match_status/commute_minutes/fail_reasons/unknown_fields for
// every listing against a profile that differs from this deployment's own
// defaults — using each listing's already-extracted raw fields (rent,
// bhk, lat/lng, etc.) and the exact same filter-client.js logic the
// pipeline itself uses, never a guess. Only ever changes the in-memory
// copies rendered this session; nothing is written back to Supabase, so
// the shared database stays the pipeline's own authoritative record.
async function recomputeForProfile(profile) {
  const officeCoords = await window.FlatFinderGeo.geocodeOffice(profile.officeAddress);
  const CONCURRENCY = 4;
  let i = 0;
  async function worker() {
    while (i < state.listings.length) {
      const listing = state.listings[i++];
      if (listing.lat != null && listing.lng != null && officeCoords) {
        const result = await window.FlatFinderGeo.commuteMinutes({ lat: listing.lat, lng: listing.lng }, officeCoords);
        listing.commute_minutes = result.minutes;
        listing.commute_source = result.source;
      } else {
        listing.commute_minutes = null;
        listing.commute_source = null;
      }
      window.FlatFinderFilter.applyHardFilter(listing, profile.requirements);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// --------------------------------------------------------------- rendering

function fmtMoney(n) {
  return n === null || n === undefined ? "UNKNOWN" : `₹${Number(n).toLocaleString("en-IN")}`;
}

function furnishingLabel(value) {
  return { full: "Fully furnished", semi: "Semi-furnished", none: "Unfurnished" }[value] || "Furnishing UNKNOWN";
}

// Manual captures (extension, share target, paste box) all stamp their
// source_listing_id as `manual-<timestamp>` (see filter-client.js,
// share.html, popup.js) — that's a reliable, already-existing signal for
// "you added this yourself," distinct from a scraped listing's first_seen
// (when the pipeline discovered it, not when anyone added anything).
function isManuallyAdded(listing) {
  return typeof listing.source_listing_id === "string" && listing.source_listing_id.startsWith("manual-");
}

function timeAgo(iso, listing) {
  if (!iso) return "";
  const verb = listing && isManuallyAdded(listing) ? "Added by you" : "Listed";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${verb} ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${verb} ${hours}h ago`;
  return `${verb} ${Math.round(hours / 24)}d ago`;
}

const STATUS_LABEL = {
  active: "Active",
  possibly_unavailable: "Possibly unavailable",
  unavailable: "Unavailable",
  not_recently_verified: "Not recently verified",
};

function statusBadge(listing) {
  const label = STATUS_LABEL[listing.source_status] || "Active";
  return `<span class="status-badge status-${listing.source_status || "active"}">${label}</span>`;
}

function boolIcon(value) {
  if (value === true) return "✓";
  if (value === false) return "✗";
  return "UNKNOWN";
}

// Row background color: a hard-requirement signal you can read at a
// glance, not decoration. Brokerage is checked first and overrides rent —
// a broker-involved listing fails a hard requirement outright regardless
// of how good the rent looks, so it gets its own color rather than being
// folded into the rent tiers.
function rowColorClass(listing) {
  if (listing.brokerage_status === "broker") return "row-blue";
  if (listing.rent == null) return "row-amber";
  return listing.rent <= 15000 ? "row-green" : "row-red";
}

// The one line of context a row has room for, since everything else now
// lives behind the external listing link (or, when there is none, the
// detail dialog — see renderRow). Prioritizes whichever hard-requirement
// signal is most informative for this listing's match_status.
function rowSubtitle(listing) {
  if (listing.match_status === "rejected" && listing.fail_reasons && listing.fail_reasons.length) {
    return `Fails: ${listing.fail_reasons.join("; ")}`;
  }
  if (listing.match_status === "needs_verification" && listing.unknown_fields && listing.unknown_fields.length) {
    return `Needs verification: ${listing.unknown_fields.join(", ")}`;
  }
  return `via ${listing.source || "unknown source"} · ${timeAgo(listing.first_seen, listing) || "UNKNOWN"}`;
}

// Leaner than renderDetailContent (no dialog fallback needs) — the row
// header above already shows rent/location, so this only adds what the
// header didn't: deposit, tags, commute, owner/verification status, meta,
// and the "View Original Listing" link (the explicit alternative to the
// implicit "tap the expanded row again" shortcut).
function renderExpandContent(listing) {
  const kind = listing.match_status;
  const parts = [];

  if (listing.image_url) {
    parts.push(`<img class="detail-thumb" src="${escapeAttr(listing.image_url)}" alt="" onerror="this.remove()">`);
  }
  parts.push(`<div class="deposit">${fmtMoney(listing.deposit)} deposit</div>`);

  if (kind === "confirmed") {
    parts.push(`
      <div class="tags">
        <span class="tag">${listing.bhk ?? "?"} BHK</span>
        <span class="tag">${furnishingLabel(listing.furnishing)}</span>
        <span class="tag good">Lift ${boolIcon(listing.lift)}</span>
        <span class="tag good">Brokerage ₹0 ✓</span>
      </div>
    `);
  }

  parts.push(`<div class="commute">🚗 ${listing.commute_minutes != null ? Math.round(listing.commute_minutes) + " min" : "UNKNOWN"} to ${escapeHtml(OFFICE_NAME)}${listing.commute_source === "google_distance_matrix_traffic" ? " (traffic-aware)" : listing.commute_source === "osrm_driving" ? " (no live traffic)" : ""}</div>`);

  if (kind === "confirmed") {
    parts.push(`<div class="owner-line">${listing.owner_status === "owner" ? "Owner-direct ✓" : "Owner/broker status UNKNOWN"}</div>`);
  }
  // Needs-verification/rejected reasons already appear in the row's own
  // subtitle line (rowSubtitle) right above this panel — repeating the
  // identical text here would just be noise.

  parts.push(`
    <div class="meta">
      ${timeAgo(listing.first_seen, listing)} · via ${escapeHtml(listing.source || "unknown source")}
      ${listing.merged_sources && listing.merged_sources.length > 1 ? `<br>Also seen on: ${listing.merged_sources.map((s) => escapeHtml(s.source)).join(", ")}` : ""}
    </div>
  `);
  if (listing.score_reasons && listing.score_reasons.length) {
    parts.push(`<div class="why">Ranked for: ${listing.score_reasons.map(escapeHtml).join(" · ")}</div>`);
  }
  parts.push(listing.url
    ? `<a class="view-link" href="${escapeAttr(listing.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View Original Listing</a>`
    : '<div class="view-link disabled">No source link available</div>');

  return parts.join("");
}

// Full-width stacked row, colored by rent/brokerage (see rowColorClass).
// First tap expands the row in place — the expansion is the same color,
// just taller, so it reads as one continuous block unfolding rather than
// a popup — showing everything a click doesn't. Tapping the already-
// expanded row (or the "View Original Listing" link inside it) goes to
// the source. Only one row stays expanded at a time.
function renderRow(listing) {
  const wrap = document.createElement("div");
  wrap.className = "row-wrap";

  const color = rowColorClass(listing);
  const row = document.createElement("article");
  row.className = `row-item ${color}`;
  row.innerHTML = `
    <div class="row-icon">${listing.bhk != null ? escapeHtml(String(listing.bhk)) : "🏠"}</div>
    <div class="row-text">
      <div class="row-title">${escapeHtml(listing.location || listing.address || "Location UNKNOWN")}</div>
      <div class="row-sub">${escapeHtml(rowSubtitle(listing))}</div>
    </div>
    <div class="row-amount">${fmtMoney(listing.rent)}${listing.rent != null ? "<span>/mo</span>" : ""}</div>
  `;

  const expandPanel = document.createElement("div");
  expandPanel.className = `row-expand ${color}`;
  expandPanel.hidden = true;

  row.addEventListener("click", () => {
    if (!expandPanel.hidden) {
      if (listing.url) window.open(listing.url, "_blank", "noopener");
      return;
    }
    document.querySelectorAll(".row-wrap .row-item.row-item-open").forEach((el) => {
      el.classList.remove("row-item-open");
      el.nextElementSibling.hidden = true;
    });
    row.classList.add("row-item-open");
    expandPanel.hidden = false;
    if (!expandPanel.dataset.built) {
      expandPanel.innerHTML = renderExpandContent(listing);
      expandPanel.dataset.built = "1";
    }
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  wrap.appendChild(row);
  wrap.appendChild(expandPanel);
  return wrap;
}

// Full detail content shown in the expanded dialog — everything the old
// full-size cards used to show inline, now revealed on demand instead of
// dominating the list. Adapts what it shows to match_status the same way
// the three separate card renderers used to.
function renderDetailContent(listing) {
  const kind = listing.match_status;
  const parts = [];

  if (listing.image_url) {
    parts.push(`<img class="detail-thumb" src="${escapeAttr(listing.image_url)}" alt="" onerror="this.remove()">`);
  }

  parts.push(`
    <div class="card-top">
      <div class="rent">${fmtMoney(listing.rent)}${listing.rent != null ? "/month" : ""}</div>
      ${kind === "needs_verification"
        ? '<span class="status-badge status-needs_verification">Needs verification</span>'
        : kind === "rejected"
        ? '<span class="status-badge status-rejected">Rejected</span>'
        : statusBadge(listing)}
    </div>
    <div class="deposit">${fmtMoney(listing.deposit)} deposit</div>
  `);

  if (kind === "confirmed") {
    parts.push(`
      <div class="tags">
        <span class="tag">${listing.bhk ?? "?"} BHK</span>
        <span class="tag">${furnishingLabel(listing.furnishing)}</span>
        <span class="tag good">Lift ${boolIcon(listing.lift)}</span>
        <span class="tag good">Brokerage ₹0 ✓</span>
      </div>
    `);
  }

  parts.push(`<div class="location">📍 ${escapeHtml(listing.location || listing.address || "Location UNKNOWN")}</div>`);
  parts.push(`<div class="commute">🚗 ${listing.commute_minutes != null ? Math.round(listing.commute_minutes) + " min" : "UNKNOWN"} to ${escapeHtml(OFFICE_NAME)}${listing.commute_source === "google_distance_matrix_traffic" ? " (traffic-aware)" : listing.commute_source === "osrm_driving" ? " (no live traffic)" : ""}</div>`);

  if (kind === "confirmed") {
    parts.push(`<div class="owner-line">${listing.owner_status === "owner" ? "Owner-direct ✓" : "Owner/broker status UNKNOWN"}</div>`);
  }
  if (kind === "needs_verification" && listing.unknown_fields && listing.unknown_fields.length) {
    parts.push(`<div class="unknowns">Needs verification: ${listing.unknown_fields.map(escapeHtml).join(", ")}</div>`);
  }
  if (kind === "rejected" && listing.fail_reasons && listing.fail_reasons.length) {
    parts.push(`<div class="fails">Fails: ${listing.fail_reasons.map(escapeHtml).join("; ")}</div>`);
  }

  parts.push(`
    <div class="meta">
      ${timeAgo(listing.first_seen, listing)} · via ${escapeHtml(listing.source || "unknown source")}
      ${listing.merged_sources && listing.merged_sources.length > 1 ? `<br>Also seen on: ${listing.merged_sources.map((s) => escapeHtml(s.source)).join(", ")}` : ""}
    </div>
  `);
  if (listing.score_reasons && listing.score_reasons.length) {
    parts.push(`<div class="why">Ranked for: ${listing.score_reasons.map(escapeHtml).join(" · ")}</div>`);
  }
  parts.push(listing.url
    ? `<a class="view-link" href="${escapeAttr(listing.url)}" target="_blank" rel="noopener">View Original Listing</a>`
    : '<div class="view-link disabled">No source link available</div>');

  return parts.join("");
}

function openDetail(listing) {
  els.detailContent.innerHTML = renderDetailContent(listing);
  els.detailDialog.showModal();
}

if (els.closeDetail) {
  els.closeDetail.addEventListener("click", () => els.detailDialog.close());
}

// ------------------------------------------------------ all listings table

const MATCH_STATUS_LABEL = { confirmed: "Confirmed", needs_verification: "Needs verification", rejected: "Rejected" };
const PERSONAL_STATUS_OPTIONS = [
  ["", "—"],
  ["not_contacted", "Not contacted"],
  ["contacted", "Contacted"],
  ["visited", "Visited"],
  ["not_interested", "Not interested"],
];

const tableSort = { field: "first_seen", dir: "desc" };

function sortValue(listing, field) {
  const v = listing[field];
  if (field === "lift") return v === true ? 1 : v === false ? 0 : -1;
  if (v === null || v === undefined) return field === "commute_minutes" || field === "rent" || field === "deposit" ? Infinity : "";
  return v;
}

function sortedListings() {
  const items = state.listings.slice();
  const { field, dir } = tableSort;
  items.sort((a, b) => {
    const av = sortValue(a, field);
    const bv = sortValue(b, field);
    let cmp;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });
  return items;
}

function renderAllListingsRow(listing) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><span class="status-badge status-${listing.match_status}">${MATCH_STATUS_LABEL[listing.match_status] || listing.match_status}</span></td>
    <td>${fmtMoney(listing.rent)}</td>
    <td>${fmtMoney(listing.deposit)}</td>
    <td>${listing.bhk ?? "UNKNOWN"}</td>
    <td>${furnishingLabel(listing.furnishing)}</td>
    <td>${boolIcon(listing.lift)}</td>
    <td>${listing.brokerage_status === "zero" ? "₹0" : listing.brokerage_status === "broker" ? "Broker" : "UNKNOWN"}</td>
    <td>${listing.commute_minutes != null ? Math.round(listing.commute_minutes) + " min" : "UNKNOWN"}</td>
    <td>${escapeHtml(listing.location || listing.address || "UNKNOWN")}</td>
    <td>${escapeHtml(listing.source || "unknown")}</td>
    <td>${timeAgo(listing.first_seen, listing) || "UNKNOWN"}</td>
    <td>${listing.url ? `<a href="${escapeAttr(listing.url)}" target="_blank" rel="noopener">Open</a>` : "—"}</td>
    <td><input type="text" class="notes-input" value="${escapeAttr(listing.notes || "")}" placeholder="Add a note…"></td>
    <td>
      <select class="status-select">
        ${PERSONAL_STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${listing.personal_status === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </td>
  `;

  const notesInput = tr.querySelector(".notes-input");
  const statusSelect = tr.querySelector(".status-select");
  let notesTimer = null;

  async function saveField(field, value) {
    listing[field] = value;
    try {
      await window.FlatFinderSupabase.updateNotes(listing.id, { [field]: value });
    } catch {
      // Best-effort — the field keeps its edited value in the UI even if
      // the save failed; the next successful edit will retry the write.
    }
  }

  notesInput.addEventListener("input", () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => saveField("notes", notesInput.value), 600);
  });
  statusSelect.addEventListener("change", () => saveField("personal_status", statusSelect.value));

  return tr;
}

function renderAllListingsTable() {
  if (!els.allListingsBody) return;
  els.allListingsBody.innerHTML = "";
  sortedListings().forEach((l) => els.allListingsBody.appendChild(renderAllListingsRow(l)));

  if (els.allListingsTable) {
    els.allListingsTable.querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === tableSort.field);
      th.classList.toggle("sorted-asc", th.dataset.sort === tableSort.field && tableSort.dir === "asc");
    });
  }
}

if (els.allListingsTable) {
  els.allListingsTable.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (tableSort.field === field) {
        tableSort.dir = tableSort.dir === "asc" ? "desc" : "asc";
      } else {
        tableSort.field = field;
        tableSort.dir = "asc";
      }
      renderAllListingsTable();
    });
  });
}

if (els.viewCards && els.viewTable) {
  els.viewCards.addEventListener("click", () => {
    els.cardsView.hidden = false;
    els.tableView.hidden = true;
    els.viewCards.classList.add("active");
    els.viewCards.setAttribute("aria-selected", "true");
    els.viewTable.classList.remove("active");
    els.viewTable.setAttribute("aria-selected", "false");
  });
  els.viewTable.addEventListener("click", () => {
    els.cardsView.hidden = true;
    els.tableView.hidden = false;
    els.viewTable.classList.add("active");
    els.viewTable.setAttribute("aria-selected", "true");
    els.viewCards.classList.remove("active");
    els.viewCards.setAttribute("aria-selected", "false");
    renderAllListingsTable();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function cardComparator() {
  if (state.cardSort === "newest") {
    return (a, b) => new Date(b.first_seen || 0) - new Date(a.first_seen || 0);
  }
  if (state.cardSort === "oldest") {
    return (a, b) => new Date(a.first_seen || 0) - new Date(b.first_seen || 0);
  }
  // "commute" (default) — listings with unknown commute sort last, not first.
  return (a, b) => (a.commute_minutes ?? Infinity) - (b.commute_minutes ?? Infinity);
}

function render() {
  const confirmed = state.listings.filter((l) => l.match_status === "confirmed").sort(cardComparator());
  const needsVerification = state.listings.filter((l) => l.match_status === "needs_verification").sort(cardComparator());
  const rejected = state.listings.filter((l) => l.match_status === "rejected");

  els.confirmed.innerHTML = "";
  confirmed.forEach((l) => els.confirmed.appendChild(renderRow(l)));
  els.confirmedCount.textContent = `${confirmed.length} confirmed match${confirmed.length === 1 ? "" : "es"}`;

  els.needsVerification.innerHTML = "";
  needsVerification.forEach((l) => els.needsVerification.appendChild(renderRow(l)));
  els.needsVerificationCount.textContent = `${needsVerification.length} listing${needsVerification.length === 1 ? "" : "s"} needing verification`;
  els.needsVerificationToggle.parentElement.hidden = needsVerification.length === 0;

  els.nearMatches.innerHTML = "";
  rejected
    .slice()
    .sort((a, b) => a.fail_reasons.length - b.fail_reasons.length)
    .slice(0, 20)
    .forEach((l) => els.nearMatches.appendChild(renderRow(l)));
  els.nearMatchesSection.hidden = rejected.length === 0;

  els.emptyState.hidden = confirmed.length !== 0;
  if (confirmed.length === 0) {
    els.emptyState.textContent = window.FlatFinderSupabase.isConfigured()
      ? "No verified matches found right now."
      : "No shared backend configured (see README) — nothing has been discovered yet.";
  }

  renderAllListingsTable();
}

// ----------------------------------------------------------- add a listing

let officeCoordsPromise = null;
function getOfficeCoords() {
  if (!officeCoordsPromise) officeCoordsPromise = window.FlatFinderGeo.geocodeOffice(OFFICE_ADDRESS);
  return officeCoordsPromise;
}

function fillFormFromParsed(parsed) {
  const form = els.addListingForm;
  const fieldMap = { title: "title", location: "location", bhk: "bhk", furnishing: "furnishing", rent: "rent", deposit: "deposit", contact: "contact", availableFrom: "availableFrom" };
  Object.entries(fieldMap).forEach(([parsedKey, fieldName]) => {
    const field = form.elements[fieldName];
    if (field && parsed[parsedKey] !== null && parsed[parsedKey] !== undefined) field.value = parsed[parsedKey];
  });
  form.elements.lift.value = parsed.lift === true ? "true" : parsed.lift === false ? "false" : "";
  form.elements.brokerageStatus.value = parsed.brokerageStatus || "";
  form.elements.ownerStatus.value = parsed.ownerStatus || "";
  form.dataset.rawText = parsed.rawText || "";
  form.dataset.sourceUrl = parsed.url || "";
}

if (els.pasteBox) {
  els.pasteBox.addEventListener("input", () => {
    const raw = els.pasteBox.value.trim();
    if (!raw || typeof FlatFinderParser === "undefined") return;
    fillFormFromParsed(FlatFinderParser.parse(raw, {}));
  });
}

async function addListingFromForm(formData, form) {
  els.parseStatus.textContent = "Geocoding and computing commute…";
  const parsed = {
    title: formData.get("title") || null,
    location: formData.get("location") || null,
    address: formData.get("location") || null,
    bhk: formData.get("bhk") ? parseFloat(formData.get("bhk")) : null,
    furnishing: formData.get("furnishing") || null,
    lift: formData.get("lift") === "true" ? true : formData.get("lift") === "false" ? false : null,
    rent: formData.get("rent") ? parseFloat(formData.get("rent")) : null,
    deposit: formData.get("deposit") ? parseFloat(formData.get("deposit")) : null,
    brokerageStatus: formData.get("brokerageStatus") || null,
    brokerageAmount: formData.get("brokerageStatus") === "zero" ? 0 : null,
    ownerStatus: formData.get("ownerStatus") || null,
    availableFrom: formData.get("availableFrom") || null,
    source: formData.get("source") || "Manual capture",
    url: formData.get("link") || form.dataset.sourceUrl || null,
    rawText: form.dataset.rawText || null,
  };

  let lat = null, lng = null, commuteMinutes = null, commuteSource = null;
  if (parsed.location) {
    const officeCoords = await getOfficeCoords();
    const originCoords = await window.FlatFinderGeo.geocode(parsed.location);
    if (originCoords) {
      lat = originCoords.lat;
      lng = originCoords.lng;
      if (officeCoords) {
        const result = await window.FlatFinderGeo.commuteMinutes(originCoords, officeCoords);
        commuteMinutes = result.minutes;
        commuteSource = result.source;
      }
    }
  }

  const stored = window.FlatFinderFilter.buildStoredListing(parsed, {
    sourceListingId: `manual-${Date.now()}`,
    lat, lng, commuteMinutes, commuteSource,
  });
  window.FlatFinderFilter.applyHardFilter(stored, REQ);

  if (window.FlatFinderSupabase.isConfigured()) {
    try {
      const saved = await window.FlatFinderSupabase.insertListing(stored);
      state.listings.push(saved);
      els.parseStatus.textContent = `Saved — ${stored.match_status.replace("_", " ")}.`;
    } catch {
      els.parseStatus.textContent = "Couldn't reach the shared database — not saved.";
      return;
    }
  } else {
    els.parseStatus.textContent = "No shared backend configured — set SUPABASE_URL/SUPABASE_ANON_KEY in config.js first.";
    return;
  }
  render();
}

if (els.addListingBtn) {
  els.addListingBtn.addEventListener("click", () => {
    els.parseStatus.textContent = "";
    els.addListingDialog.showModal();
  });
  els.cancelAdd.addEventListener("click", () => els.addListingDialog.close());
  els.addListingForm.addEventListener("submit", async (e) => {
    const formData = new FormData(els.addListingForm);
    await addListingFromForm(formData, els.addListingForm);
  });
}

if (els.cardSortSelect) {
  els.cardSortSelect.addEventListener("change", () => {
    state.cardSort = els.cardSortSelect.value;
    render();
  });
}

if (els.needsVerificationToggle) {
  els.needsVerificationToggle.addEventListener("click", () => {
    const expanded = els.needsVerification.hidden === false;
    els.needsVerification.hidden = expanded;
    els.needsVerificationToggle.textContent = expanded ? "Show" : "Hide";
  });
}

// -------------------------------------------------------- requirements list

function renderRequirementsList() {
  if (!els.requirementsList) return;
  const bhkLabel = REQ.bhk != null ? `${REQ.bhk} BHK` : "Any BHK";
  const items = [
    bhkLabel,
    REQ.furnishing ? furnishingLabel(REQ.furnishing) : "Any furnishing",
    REQ.maxRent != null ? `Rent ≤ ₹${Number(REQ.maxRent).toLocaleString("en-IN")}/month` : "No rent limit",
    REQ.maxDeposit != null ? `Deposit ≤ ₹${Number(REQ.maxDeposit).toLocaleString("en-IN")}` : "No deposit limit",
    REQ.lift === false ? "Lift not required" : "Lift mandatory",
    REQ.brokerageZero === false ? "Brokerage not restricted" : "Brokerage ₹0 (owner-direct preferred)",
    `≤ ${REQ.maxCommuteMinutes ?? "?"} min commute to ${OFFICE_NAME || "your destination"}`,
  ];
  els.requirementsList.innerHTML = items.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
}

// -------------------------------------------------------------- onboarding

function fillOnboardForm(profile) {
  const form = els.onboardForm;
  form.elements.name.value = profile.name || "";
  form.elements.officeName.value = profile.officeName || "";
  form.elements.officeAddress.value = profile.officeAddress || "";
  const r = profile.requirements;
  form.elements.bhk.value = r.bhk ?? "";
  form.elements.furnishing.value = r.furnishing || "semi";
  form.elements.maxRent.value = r.maxRent ?? "";
  form.elements.maxDeposit.value = r.maxDeposit ?? "";
  form.elements.maxCommuteMinutes.value = r.maxCommuteMinutes ?? "";
  form.elements.lift.checked = r.lift !== false;
  form.elements.brokerageZero.checked = r.brokerageZero !== false;
}

function readOnboardForm() {
  const form = els.onboardForm;
  const fd = new FormData(form);
  return {
    name: (fd.get("name") || "").trim(),
    officeName: (fd.get("officeName") || "").trim(),
    officeAddress: (fd.get("officeAddress") || "").trim(),
    requirements: {
      bhk: fd.get("bhk") ? parseFloat(fd.get("bhk")) : null,
      furnishing: fd.get("furnishing") || null,
      maxRent: fd.get("maxRent") ? parseFloat(fd.get("maxRent")) : null,
      maxDeposit: fd.get("maxDeposit") ? parseFloat(fd.get("maxDeposit")) : null,
      lift: form.elements.lift.checked,
      brokerageZero: form.elements.brokerageZero.checked,
      maxCommuteMinutes: fd.get("maxCommuteMinutes") ? parseFloat(fd.get("maxCommuteMinutes")) : null,
    },
  };
}

// skipExplainer: true when re-editing an existing profile from the
// settings button — the "how this works" screen only makes sense once,
// on a genuinely first visit.
function showOnboarding(profile, { skipExplainer } = {}) {
  fillOnboardForm(profile);
  els.onboarding.hidden = false;
  els.onboardStep1.hidden = false;
  els.onboardStep2.hidden = true;
  els.onboarding.dataset.skipExplainer = skipExplainer ? "1" : "";
}

function hideOnboarding() {
  els.onboarding.hidden = true;
}

if (els.onboardForm) {
  els.onboardForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const profile = readOnboardForm();
    window.FlatFinderProfile.saveProfile(profile);
    applyProfile(profile);
    renderRequirementsList();
    if (els.onboarding.dataset.skipExplainer) {
      hideOnboarding();
      loadListings();
    } else {
      els.onboardStep1.hidden = true;
      els.onboardStep2.hidden = false;
    }
  });
}

if (els.onboardContinue) {
  els.onboardContinue.addEventListener("click", () => {
    hideOnboarding();
    loadListings();
  });
}

if (els.settingsBtn) {
  els.settingsBtn.addEventListener("click", () => {
    const profile = window.FlatFinderProfile.getProfile() || window.FlatFinderProfile.defaultProfile();
    showOnboarding(profile, { skipExplainer: true });
  });
}
if (els.editRequirements) {
  els.editRequirements.addEventListener("click", () => {
    const profile = window.FlatFinderProfile.getProfile() || window.FlatFinderProfile.defaultProfile();
    showOnboarding(profile, { skipExplainer: true });
  });
}

// ------------------------------------------------------------------- init

function init() {
  const existing = window.FlatFinderProfile.getProfile();
  if (existing) {
    applyProfile(existing);
    renderRequirementsList();
    loadListings();
  } else {
    showOnboarding(window.FlatFinderProfile.defaultProfile(), { skipExplainer: false });
  }
}

init();
