// FlatFinder — personal rental search for a fixed set of requirements
// (see config.js). Reads listings the pipeline (pipeline/run.py, scheduled
// via GitHub Actions) has already discovered, extracted, geocoded, routed,
// and hard-filtered, and renders them into Confirmed Matches / Needs
// Verification / Near Matches. Nothing here invents or loosens a match —
// match_status on each stored listing is authoritative.

const REQ = (typeof CONFIG !== "undefined" && CONFIG.REQUIREMENTS) || {};
const OFFICE_ADDRESS = (typeof CONFIG !== "undefined" && CONFIG.OFFICE_ADDRESS) || "";
const OFFICE_NAME = (typeof CONFIG !== "undefined" && CONFIG.OFFICE_NAME) || "the office";

const state = { listings: [], cardSort: "commute" };

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
};

// ---------------------------------------------------------------- loading

async function loadListings() {
  state.listings = await window.FlatFinderSupabase.fetchListings();
  render();
}

// --------------------------------------------------------------- rendering

function fmtMoney(n) {
  return n === null || n === undefined ? "UNKNOWN" : `₹${Number(n).toLocaleString("en-IN")}`;
}

function furnishingLabel(value) {
  return { full: "Fully furnished", semi: "Semi-furnished", none: "Unfurnished" }[value] || "Furnishing UNKNOWN";
}

function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `Listed ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Listed ${hours}h ago`;
  return `Listed ${Math.round(hours / 24)}d ago`;
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

// Only ever renders a real image_url lifted from the source post/actor
// (see pipeline/sources/telegram_public.py, apify_generic.py) — never a
// placeholder or stock photo. onerror removes it rather than showing a
// broken-image icon, since a dead link isn't worth fabricating a stand-in for.
function thumbnailHtml(listing) {
  if (!listing.image_url) return "";
  return `<img class="card-thumb" src="${escapeAttr(listing.image_url)}" alt="" loading="lazy" onerror="this.remove()">`;
}

// Makes the whole card tappable through to the original listing — the
// existing "View Original Listing" button still works as its own link (a
// click there is left alone), this just extends the same navigation to
// anywhere else on the card. No-op when there's no url to send it to.
function attachCardClickthrough(card, listing) {
  if (!listing.url) return;
  card.classList.add("has-link");
  card.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    window.open(listing.url, "_blank", "noopener");
  });
}

function renderConfirmedCard(listing) {
  const card = document.createElement("article");
  card.className = "card confirmed";
  card.innerHTML = `
    ${thumbnailHtml(listing)}
    <div class="card-top">
      <div class="rent">${fmtMoney(listing.rent)}/month</div>
      ${statusBadge(listing)}
    </div>
    <div class="deposit">${fmtMoney(listing.deposit)} deposit</div>
    <div class="tags">
      <span class="tag">${listing.bhk ?? "?"} BHK</span>
      <span class="tag">${furnishingLabel(listing.furnishing)}</span>
      <span class="tag good">Lift ${boolIcon(listing.lift)}</span>
      <span class="tag good">Brokerage ₹0 ✓</span>
    </div>
    <div class="location">📍 ${escapeHtml(listing.location || listing.address || "Location UNKNOWN")}</div>
    <div class="commute">🚗 ${listing.commute_minutes != null ? Math.round(listing.commute_minutes) + " min" : "UNKNOWN"} to ${escapeHtml(OFFICE_NAME)}${listing.commute_source === "google_distance_matrix_traffic" ? " (traffic-aware)" : listing.commute_source === "osrm_driving" ? " (no live traffic)" : ""}</div>
    <div class="owner-line">${listing.owner_status === "owner" ? "Owner-direct ✓" : "Owner/broker status UNKNOWN"}</div>
    <div class="meta">
      ${timeAgo(listing.first_seen)} · via ${escapeHtml(listing.source || "unknown source")}
      ${listing.merged_sources && listing.merged_sources.length > 1 ? `<br>Also seen on: ${listing.merged_sources.map((s) => escapeHtml(s.source)).join(", ")}` : ""}
    </div>
    ${listing.score_reasons && listing.score_reasons.length ? `<div class="why">Ranked for: ${listing.score_reasons.map(escapeHtml).join(" · ")}</div>` : ""}
    ${listing.url ? `<a class="view-link" href="${escapeAttr(listing.url)}" target="_blank" rel="noopener">View Original Listing</a>` : '<div class="view-link disabled">No source link available</div>'}
  `;
  attachCardClickthrough(card, listing);
  return card;
}

function renderNeedsVerificationCard(listing) {
  const card = document.createElement("article");
  card.className = "card needs-verification";
  card.innerHTML = `
    ${thumbnailHtml(listing)}
    <div class="card-top">
      <div class="rent">${fmtMoney(listing.rent)}/month</div>
      ${statusBadge(listing)}
    </div>
    <div class="deposit">${fmtMoney(listing.deposit)} deposit</div>
    <div class="unknowns">Needs verification: ${listing.unknown_fields.map(escapeHtml).join(", ")}</div>
    <div class="location">📍 ${escapeHtml(listing.location || listing.address || "Location UNKNOWN")}</div>
    <div class="commute">🚗 ${listing.commute_minutes != null ? Math.round(listing.commute_minutes) + " min" : "UNKNOWN"} to ${escapeHtml(OFFICE_NAME)}</div>
    <div class="meta">${timeAgo(listing.first_seen)} · via ${escapeHtml(listing.source || "unknown source")}</div>
    ${listing.url ? `<a class="view-link" href="${escapeAttr(listing.url)}" target="_blank" rel="noopener">View Original Listing</a>` : '<div class="view-link disabled">No source link available</div>'}
  `;
  attachCardClickthrough(card, listing);
  return card;
}

function renderNearMatchCard(listing) {
  const card = document.createElement("article");
  card.className = "card near-match";
  card.innerHTML = `
    ${thumbnailHtml(listing)}
    <div class="card-top">
      <div class="rent">${fmtMoney(listing.rent)}/month</div>
    </div>
    <div class="fails">Fails: ${listing.fail_reasons.map(escapeHtml).join("; ")}</div>
    <div class="location">📍 ${escapeHtml(listing.location || listing.address || "Location UNKNOWN")}</div>
    <div class="meta">via ${escapeHtml(listing.source || "unknown source")}</div>
    ${listing.url ? `<a class="view-link" href="${escapeAttr(listing.url)}" target="_blank" rel="noopener">View Original Listing</a>` : '<div class="view-link disabled">No source link available</div>'}
  `;
  attachCardClickthrough(card, listing);
  return card;
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
    <td>${timeAgo(listing.first_seen) || "UNKNOWN"}</td>
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
  confirmed.forEach((l) => els.confirmed.appendChild(renderConfirmedCard(l)));
  els.confirmedCount.textContent = `${confirmed.length} confirmed match${confirmed.length === 1 ? "" : "es"}`;

  els.needsVerification.innerHTML = "";
  needsVerification.forEach((l) => els.needsVerification.appendChild(renderNeedsVerificationCard(l)));
  els.needsVerificationCount.textContent = `${needsVerification.length} listing${needsVerification.length === 1 ? "" : "s"} needing verification`;
  els.needsVerificationToggle.parentElement.hidden = needsVerification.length === 0;

  els.nearMatches.innerHTML = "";
  rejected
    .slice()
    .sort((a, b) => a.fail_reasons.length - b.fail_reasons.length)
    .slice(0, 20)
    .forEach((l) => els.nearMatches.appendChild(renderNearMatchCard(l)));
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

loadListings();
