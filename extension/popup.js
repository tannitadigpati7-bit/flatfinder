const fields = ["title", "location", "bhk", "furnishing", "lift", "rent", "deposit", "brokerageStatus", "ownerStatus", "contact", "source", "link"];
let lastConfidence = {};
let lastRawText = "";

function fillForm(parsed) {
  const map = { title: "title", location: "location", bhk: "bhk", furnishing: "furnishing", lift: "lift", rent: "rent", deposit: "deposit", brokerageStatus: "brokerageStatus", ownerStatus: "ownerStatus", contact: "contact" };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = parsed[key];
    el.value = value === null || value === undefined ? "" : value;
  });
  lastConfidence = parsed.confidence || {};
  lastRawText = parsed.rawText || "";
  applyReviewHighlights();
}

function applyReviewHighlights() {
  ["location", "bhk", "furnishing", "lift", "rent", "brokerageStatus", "ownerStatus", "contact"].forEach((f) => {
    const el = document.getElementById(f);
    if (!el) return;
    el.classList.toggle("needs-review", lastConfidence[f] === false);
  });
}

function parseAndFill() {
  const raw = document.getElementById("raw").value.trim();
  if (!raw) return;
  const parsed = FlatFinderParser.parse(raw, {});
  fillForm(parsed);
}

function readForm() {
  const out = {};
  fields.forEach((f) => (out[f] = document.getElementById(f).value.trim()));
  return out;
}

function setStatus(msg, cls) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = cls || "";
}

async function loadSettings() {
  const { firebaseDbUrl } = await chrome.storage.sync.get("firebaseDbUrl");
  document.getElementById("firebaseDbUrl").value = firebaseDbUrl || "";
  return firebaseDbUrl || "";
}

async function loadPendingCapture() {
  const { pendingCapture } = await chrome.storage.local.get("pendingCapture");
  if (!pendingCapture) return;
  document.getElementById("raw").value = pendingCapture.text;
  const parsed = FlatFinderParser.parse(pendingCapture.text, { sourceUrl: pendingCapture.url });
  document.getElementById("link").value = pendingCapture.url || "";
  fillForm(parsed);
  await chrome.storage.local.remove("pendingCapture");
}

document.getElementById("reparse").addEventListener("click", parseAndFill);

document.getElementById("saveSettings").addEventListener("click", async () => {
  const url = document.getElementById("firebaseDbUrl").value.trim();
  await chrome.storage.sync.set({ firebaseDbUrl: url });
  document.getElementById("settingsStatus").textContent = "Saved.";
  setTimeout(() => (document.getElementById("settingsStatus").textContent = ""), 2000);
});

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const firebaseDbUrl = (await chrome.storage.sync.get("firebaseDbUrl")).firebaseDbUrl;
  if (!firebaseDbUrl) {
    setStatus("Set your Firebase Database URL under Settings first.", "err");
    return;
  }
  const data = readForm();

  setStatus("Geocoding and computing commute…");
  const parsed = {
    title: data.title || null,
    location: data.location || null,
    address: data.location || null,
    bhk: data.bhk ? parseFloat(data.bhk) : null,
    furnishing: data.furnishing || null,
    lift: data.lift === "true" ? true : data.lift === "false" ? false : null,
    rent: data.rent ? parseFloat(data.rent) : null,
    deposit: data.deposit ? parseFloat(data.deposit) : null,
    brokerageStatus: data.brokerageStatus || null,
    brokerageAmount: data.brokerageStatus === "zero" ? 0 : null,
    ownerStatus: data.ownerStatus || null,
    source: data.source || "Extension capture",
    url: data.link || null,
    rawText: lastRawText,
  };

  let lat = null, lng = null, commuteMinutes = null, commuteSource = null;
  const officeAddress = (typeof CONFIG !== "undefined" && CONFIG.OFFICE_ADDRESS) || "";
  if (parsed.location && officeAddress) {
    const officeCoords = await window.FlatFinderGeo.geocodeOffice(officeAddress);
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
  const requirements = (typeof CONFIG !== "undefined" && CONFIG.REQUIREMENTS) || {
    bhk: 1, furnishing: "semi", maxRent: 15000, maxDeposit: 50000, lift: true, brokerageZero: true, maxCommuteMinutes: 30,
  };
  window.FlatFinderFilter.applyHardFilter(stored, requirements);

  const matchEl = document.getElementById("matchStatus");
  matchEl.textContent = `Match status: ${stored.match_status.replace("_", " ")}`;
  matchEl.className = stored.match_status;

  try {
    const res = await fetch(`${firebaseDbUrl}/pipeline_listings.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stored),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Saved to FlatFinder.", "ok");
    document.getElementById("form").reset();
    document.getElementById("raw").value = "";
    matchEl.textContent = "";
  } catch (err) {
    setStatus("Couldn't reach the database — check the Firebase URL in Settings.", "err");
  }
});

(async function init() {
  await loadSettings();
  await loadPendingCapture();
})();
