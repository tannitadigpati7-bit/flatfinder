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
  const { sheetUrl } = await chrome.storage.sync.get("sheetUrl");
  document.getElementById("sheetUrl").value = sheetUrl || "";
  return sheetUrl || "";
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
  const url = document.getElementById("sheetUrl").value.trim();
  await chrome.storage.sync.set({ sheetUrl: url });
  document.getElementById("settingsStatus").textContent = "Saved.";
  setTimeout(() => (document.getElementById("settingsStatus").textContent = ""), 2000);
});

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sheetUrl = (await chrome.storage.sync.get("sheetUrl")).sheetUrl;
  if (!sheetUrl) {
    setStatus("Set your Sheet API URL under Settings first.", "err");
    return;
  }
  const data = readForm();
  if (!data.title) {
    setStatus("Title is required.", "err");
    return;
  }

  const body = new URLSearchParams({
    title: data.title,
    locality: data.locality,
    distanceKm: "",
    bhk: data.bhk || "1",
    furnishing: data.furnishing,
    rent: data.rent,
    deposit: data.deposit,
    brokerage: data.brokerage ? "true" : "false",
    contact: data.contact,
    source: data.source || "Extension capture",
    link: data.link,
    notes: data.notes,
  });

  setStatus("Saving…");
  try {
    await fetch(sheetUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    setStatus("Saved to FlatFinder.", "ok");
    document.getElementById("form").reset();
    document.getElementById("raw").value = "";
  } catch (err) {
    setStatus("Couldn't reach the sheet — check the Sheet API URL in Settings.", "err");
  }
});

(async function init() {
  await loadSettings();
  await loadPendingCapture();
})();
