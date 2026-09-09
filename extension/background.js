// Creates the right-click "Save selection to FlatFinder" menu item and hands
// the selected text off to the popup for review before anything is saved.
// This never sends anything anywhere by itself — it only stores the raw
// selection locally until you open the popup and press Save.

importScripts("parser.js");

const MENU_ID = "flatfinder-save-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save selection to FlatFinder",
    contexts: ["selection"],
  });
});

async function openPopupOrNotify() {
  try {
    await chrome.action.openPopup();
  } catch (err) {
    // openPopup() isn't available in every Chrome version/context (this is
    // also the expected path on Android/Kiwi Browser, which doesn't support
    // programmatic popup opening) — fall back to a notification telling the
    // user to tap the toolbar icon themselves.
    chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      title: "FlatFinder",
      message: "Selection captured — click the FlatFinder icon in your toolbar to review and save it.",
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  await chrome.storage.local.set({
    pendingCapture: {
      text: info.selectionText,
      url: tab && tab.url ? tab.url : "",
      ts: Date.now(),
    },
  });

  await openPopupOrNotify();
});

// Fired by content-facebook.js's injected "Save to FlatFinder" button —
// pendingCapture is already written to storage by the time this arrives,
// this just handles opening (or notifying about) the review popup.
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "flatfinder-open-popup") {
    openPopupOrNotify();
  }
});
