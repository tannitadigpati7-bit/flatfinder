// Deploy this as a Google Apps Script Web App bound to a Google Sheet.
// See README.md > "Setting up the shared backend" for the full setup steps.

const SHEET_NAME = "Listings";

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function doGet(e) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const listings = data
    .map((row) => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i];
      });
      return obj;
    })
    .filter((listing) => listing.title);

  return ContentService.createTextOutput(JSON.stringify(listings)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doPost(e) {
  const sheet = getSheet_();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const params = e.parameter;

  const row = headers.map((header) => {
    if (header === "id") return "sheet-" + new Date().getTime();
    if (header === "brokerage") return params.brokerage === "on" || params.brokerage === "true";
    return params[header] || "";
  });

  sheet.appendRow(row);
  notifyTelegram_(headers, row);

  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok" })
  ).setMimeType(ContentService.MimeType.JSON);
}

// Sends a Telegram message for every new row, whether added via the site's
// "+ Add a listing" form or pushed in by the scraper workflow. Configure by
// running setTelegramConfig_() once from the Apps Script editor (see README).
function notifyTelegram_(headers, row) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("TELEGRAM_BOT_TOKEN");
  const chatId = props.getProperty("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;

  const listing = {};
  headers.forEach((header, i) => {
    listing[header] = row[i];
  });

  const lines = [
    `New listing: ${listing.title || "(untitled)"}`,
    `${listing.locality || "?"} · ${listing.bhk || "?"}BHK · ${listing.furnishing || "?"}`,
    `Rent: Rs.${listing.rent || "?"}/mo`,
    listing.brokerage ? "Has brokerage" : "No brokerage",
    listing.link ? listing.link : null,
    listing.contact ? `Contact: ${listing.contact}` : null,
  ].filter(Boolean);

  try {
    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: {
        chat_id: chatId,
        text: lines.join("\n"),
      },
      muteHttpExceptions: true,
    });
  } catch (err) {
    // Notification failures shouldn't block the listing from being saved.
  }
}

// Run this once from the Apps Script editor (select it in the function
// dropdown, click Run) after filling in your own bot token and chat id.
function setTelegramConfig_() {
  PropertiesService.getScriptProperties().setProperties({
    TELEGRAM_BOT_TOKEN: "PASTE_YOUR_BOT_TOKEN_HERE",
    TELEGRAM_CHAT_ID: "PASTE_YOUR_CHAT_ID_HERE",
  });
}
