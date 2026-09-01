const fields = ["title", "locality", "bhk", "furnishing", "rent", "deposit", "contact", "source", "link", "notes"];
let lastConfidence = {};

function fillForm(parsed) {
  fields.forEach((f) => {
    const el = document.getElementById(f);
    if (el) el.value = parsed[f] ?? "";
  });
  document.getElementById("brokerage").checked = !!parsed.brokerage;
  lastConfidence = parsed.confidence || {};
  applyReviewHighlights();
}

function applyReviewHighlights() {
  ["locality", "bhk", "furnishing", "rent", "contact"].forEach((f) => {
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
  out.brokerage = document.getElementById("brokerage").checked;
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
  if (!data.title) {
    setStatus("Title is required.", "err");
    return;
  }

  const body = JSON.stringify({
    title: data.title,
    locality: data.locality,
    distanceKm: "",
    bhk: parseFloat(data.bhk) || 1,
    furnishing: data.furnishing,
    rent: parseFloat(data.rent) || "",
    deposit: parseFloat(data.deposit) || "",
    brokerage: !!data.brokerage,
    contact: data.contact,
    source: data.source || "Extension capture",
    link: data.link,
    notes: data.notes,
  });

  setStatus("Saving…");
  try {
    const res = await fetch(`${firebaseDbUrl}/listings.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Saved to FlatFinder.", "ok");
    document.getElementById("form").reset();
    document.getElementById("raw").value = "";
  } catch (err) {
    setStatus("Couldn't reach the database — check the Firebase URL in Settings.", "err");
  }
});

(async function init() {
  await loadSettings();
  await loadPendingCapture();
})();
