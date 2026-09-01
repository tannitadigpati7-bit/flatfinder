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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  await chrome.storage.local.set({
    pendingCapture: {
      text: info.selectionText,
      url: tab && tab.url ? tab.url : "",
      ts: Date.now(),
    },
  });

  try {
    await chrome.action.openPopup();
  } catch (err) {
    // openPopup() isn't available in every Chrome version/context — fall
    // back to a notification telling the user to click the toolbar icon.
    chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      title: "FlatFinder",
      message: "Selection captured — click the FlatFinder icon in your toolbar to review and save it.",
    });
  }
});
