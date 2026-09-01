const STORAGE_KEY = "flatfinder.customListings";
const SEED_URL = "data/listings.json";
const FIREBASE_DB_URL = (typeof CONFIG !== "undefined" && CONFIG.FIREBASE_DB_URL) || "";

const state = {
  listings: [],
};

const els = {
  search: document.getElementById("search"),
  bhk: document.getElementById("bhk"),
  furnishing: document.getElementById("furnishing"),
  maxRent: document.getElementById("maxRent"),
  maxDistance: document.getElementById("maxDistance"),
  noBrokerage: document.getElementById("noBrokerage"),
  sortBy: document.getElementById("sortBy"),
  resetFilters: document.getElementById("resetFilters"),
  results: document.getElementById("results"),
  resultCount: document.getElementById("resultCount"),
  addListingBtn: document.getElementById("addListingBtn"),
  addListingDialog: document.getElementById("addListingDialog"),
  addListingForm: document.getElementById("addListingForm"),
  cancelAdd: document.getElementById("cancelAdd"),
  pasteBox: document.getElementById("pasteBox"),
};

const REVIEW_FIELD_NAMES = ["locality", "bhk", "furnishing", "rent", "contact"];

function fillFormFromParsed(parsed) {
  const form = els.addListingForm;
  ["title", "locality", "bhk", "furnishing", "rent", "deposit", "contact", "source", "link", "notes"].forEach((name) => {
    const field = form.elements[name];
    if (field && parsed[name] !== undefined && parsed[name] !== "") field.value = parsed[name];
  });
  form.elements.brokerage.checked = !!parsed.brokerage;

  REVIEW_FIELD_NAMES.forEach((name) => {
    const field = form.elements[name];
    if (!field) return;
    const confident = !parsed.confidence || parsed.confidence[name] !== false;
    field.classList.toggle("needs-review", !confident);
  });
}

if (els.pasteBox) {
  els.pasteBox.addEventListener("input", () => {
    const raw = els.pasteBox.value.trim();
    if (!raw || typeof FlatFinderParser === "undefined") return;
    fillFormFromParsed(FlatFinderParser.parse(raw, {}));
  });
}

function loadCustomListings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomListings(listings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(listings));
}

function normalizeFirebaseListing(id, listing) {
  return {
    ...listing,
    id,
    distanceKm: listing.distanceKm !== "" && listing.distanceKm != null ? parseFloat(listing.distanceKm) : null,
    bhk: parseInt(listing.bhk, 10) || 1,
    rent: parseFloat(listing.rent) || 0,
    deposit: parseFloat(listing.deposit) || 0,
    brokerage: listing.brokerage === true || listing.brokerage === "true",
    shared: true,
  };
}

async function loadListings() {
  if (FIREBASE_DB_URL) {
    try {
      const res = await fetch(`${FIREBASE_DB_URL}/listings.json`);
      const shared = await res.json(); // {pushId: {...}, ...} or null if empty
      state.listings = Object.entries(shared || {}).map(([id, listing]) =>
        normalizeFirebaseListing(id, listing)
      );
      render();
      return;
    } catch {
      // fall through to local-only mode if the shared backend is unreachable
    }
  }

  let seed = [];
  try {
    const res = await fetch(SEED_URL);
    seed = await res.json();
  } catch {
    seed = [];
  }
  const custom = loadCustomListings();
  state.listings = [...seed, ...custom];
  render();
}

function furnishingLabel(value) {
  return { full: "Fully furnished", semi: "Semi furnished", none: "Unfurnished" }[value] || value;
}

function matchesFilters(listing) {
  const search = els.search.value.trim().toLowerCase();
  const bhk = els.bhk.value;
  const furnishing = els.furnishing.value;
  const maxRent = parseFloat(els.maxRent.value);
  const maxDistance = parseFloat(els.maxDistance.value);
  const noBrokerage = els.noBrokerage.checked;

  if (search) {
    const haystack = `${listing.title} ${listing.locality} ${listing.notes || ""}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (bhk) {
    const wanted = parseInt(bhk, 10);
    if (wanted === 3) {
      if (listing.bhk < 3) return false;
    } else if (listing.bhk !== wanted) {
      return false;
    }
  }
  if (furnishing && listing.furnishing !== furnishing) return false;
  if (!Number.isNaN(maxRent) && listing.rent > maxRent) return false;
  if (!Number.isNaN(maxDistance) && listing.distanceKm > maxDistance) return false;
  if (noBrokerage && listing.brokerage) return false;
  return true;
}

function sortListings(listings) {
  const sortBy = els.sortBy.value;
  const copy = [...listings];
  if (sortBy === "distance") {
    copy.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  } else if (sortBy === "rent") {
    copy.sort((a, b) => (a.rent ?? Infinity) - (b.rent ?? Infinity));
  } else if (sortBy === "newest") {
    copy.reverse();
  }
  return copy;
}

function renderCard(listing) {
  const card = document.createElement("article");
  card.className = "card";

  const tags = [
    `${listing.bhk}BHK`,
    furnishingLabel(listing.furnishing),
    listing.brokerage ? "Brokerage" : "No brokerage",
  ];

  card.innerHTML = `
    <h3>${escapeHtml(listing.title)}</h3>
    <div class="locality">${escapeHtml(listing.locality)} · ${listing.distanceKm ?? "?"} km from Manyata</div>
    <div class="rent">₹${Number(listing.rent || 0).toLocaleString("en-IN")}/mo${listing.deposit ? ` · Deposit ₹${Number(listing.deposit).toLocaleString("en-IN")}` : ""}</div>
    <div class="tags">
      ${tags.map((t, i) => `<span class="tag${i === 2 && listing.brokerage ? " brokerage" : ""}">${escapeHtml(String(t))}</span>`).join("")}
    </div>
    ${listing.notes ? `<div class="notes">${escapeHtml(listing.notes)}</div>` : ""}
    <div class="meta">
      ${listing.contact ? `Contact: ${escapeHtml(listing.contact)}<br>` : ""}
      ${listing.source ? `Source: ${escapeHtml(listing.source)}` : ""}
      ${listing.link ? ` · <a href="${escapeAttr(listing.link)}" target="_blank" rel="noopener">Link</a>` : ""}
      ${listing.availableFrom ? `<br>Available from: ${escapeHtml(listing.availableFrom)}` : ""}
    </div>
  `;

  if (listing.custom) {
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeListing(listing.id));
    card.appendChild(removeBtn);
  }

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function render() {
  const filtered = sortListings(state.listings.filter(matchesFilters));
  els.results.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      state.listings.length === 0
        ? FIREBASE_DB_URL
          ? "No listings yet — the shared database is empty. Add one, or wait for the scrapers to find some."
          : "No sample data ships with this app anymore. Set up the shared backend (see README) or add a listing you found yourself."
        : "No listings match these filters yet. Try loosening a filter, or add one you found.";
    els.results.appendChild(empty);
  } else {
    filtered.forEach((listing) => els.results.appendChild(renderCard(listing)));
  }

  els.resultCount.textContent = `${filtered.length} listing${filtered.length === 1 ? "" : "s"} found`;
}

function removeListing(id) {
  const custom = loadCustomListings().filter((l) => l.id !== id);
  saveCustomListings(custom);
  state.listings = state.listings.filter((l) => l.id !== id);
  render();
}

function resetFilters() {
  els.search.value = "";
  els.bhk.value = "";
  els.furnishing.value = "";
  els.maxRent.value = "";
  els.maxDistance.value = "";
  els.noBrokerage.checked = true;
  els.sortBy.value = "distance";
  render();
}

async function addListingFromForm(formData) {
  const listing = {
    id: `custom-${Date.now()}`,
    title: formData.get("title"),
    locality: formData.get("locality"),
    distanceKm: parseFloat(formData.get("distanceKm")) || null,
    bhk: parseInt(formData.get("bhk"), 10),
    furnishing: formData.get("furnishing"),
    rent: parseFloat(formData.get("rent")) || 0,
    deposit: parseFloat(formData.get("deposit")) || 0,
    brokerage: formData.get("brokerage") === "on",
    contact: formData.get("contact") || "",
    source: formData.get("source") || "",
    link: formData.get("link") || "",
    notes: formData.get("notes") || "",
  };

  if (FIREBASE_DB_URL) {
    try {
      const { id, ...withoutId } = listing;
      const res = await fetch(`${FIREBASE_DB_URL}/listings.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withoutId),
      });
      const { name } = await res.json(); // Firebase's generated push id
      listing.id = name || listing.id;
    } catch {
      // best-effort; the listing still gets added locally below so it isn't lost
    }
    state.listings.push({ ...listing, shared: true });
    render();
    return;
  }

  listing.custom = true;
  const custom = loadCustomListings();
  custom.push(listing);
  saveCustomListings(custom);
  state.listings.push(listing);
  render();
}

[els.search, els.bhk, els.furnishing, els.maxRent, els.maxDistance, els.noBrokerage, els.sortBy].forEach((el) => {
  el.addEventListener("input", render);
  el.addEventListener("change", render);
});

els.resetFilters.addEventListener("click", resetFilters);

els.addListingBtn.addEventListener("click", () => els.addListingDialog.showModal());
els.cancelAdd.addEventListener("click", () => els.addListingDialog.close());
els.addListingForm.addEventListener("submit", async (e) => {
  const formData = new FormData(els.addListingForm);
  await addListingFromForm(formData);
  els.addListingForm.reset();
});

loadListings();
