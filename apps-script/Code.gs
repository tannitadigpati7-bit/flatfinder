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
    if (header === "brokerage") return params.brokerage === "on";
    return params[header] || "";
  });

  sheet.appendRow(row);

  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok" })
  ).setMimeType(ContentService.MimeType.JSON);
}
