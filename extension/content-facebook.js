// Injects a "Save to FlatFinder" button next to posts on Facebook
// Marketplace/group pages, as a lower-friction alternative to manually
// selecting text and using the right-click menu (see background.js).
//
// This does NOT read or send anything anywhere on its own. It only adds a
// button to the page; a click grabs that one post's visible text (nothing
// else, nothing in the background, nothing while you're not looking at it)
// and hands it to the same review-before-save popup every other capture
// path uses. Nothing is saved without you reviewing and pressing Save.
//
// Facebook's markup uses non-semantic, frequently-changing class names by
// design, so there is no reliable "this is a listing" selector to hook.
// role="article" is the most stable anchor available (Facebook keeps it
// for accessibility/screen-reader support on feed and Marketplace post
// containers) — if Facebook changes this, the button stops appearing and
// the manual select+right-click flow (unaffected by this) still works.

const BUTTON_CLASS = "flatfinder-capture-btn";
const MARKED_ATTR = "data-flatfinder-marked";

function extractPostText(article) {
  return (article.innerText || "").trim();
}

function makeButton(article) {
  const btn = document.createElement("button");
  btn.textContent = "Save to FlatFinder";
  btn.className = BUTTON_CLASS;
  btn.type = "button";
  btn.style.cssText = [
    "position:absolute", "top:6px", "right:6px", "z-index:2147483647",
    "background:#1a73e8", "color:#fff", "border:none", "border-radius:6px",
    "padding:5px 10px", "font:600 12px system-ui,sans-serif", "cursor:pointer",
    "box-shadow:0 1px 4px rgba(0,0,0,0.3)",
  ].join(";");

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = extractPostText(article);
    if (!text) return;

    btn.textContent = "Saving…";
    btn.disabled = true;

    await chrome.storage.local.set({
      pendingCapture: { text, url: location.href, ts: Date.now() },
    });

    try {
      await chrome.runtime.sendMessage({ type: "flatfinder-open-popup" });
    } catch (err) {
      // Background script handles the fallback notification if this fails.
    }

    btn.textContent = "Captured — review in popup";
    setTimeout(() => {
      btn.textContent = "Save to FlatFinder";
      btn.disabled = false;
    }, 2500);
  });

  return btn;
}

function markArticle(article) {
  if (article.hasAttribute(MARKED_ATTR)) return;
  article.setAttribute(MARKED_ATTR, "1");

  const computedPosition = getComputedStyle(article).position;
  if (computedPosition === "static") {
    article.style.position = "relative";
  }
  article.appendChild(makeButton(article));
}

function scan() {
  document.querySelectorAll('[role="article"]:not([' + MARKED_ATTR + "])").forEach(markArticle);
}

const observer = new MutationObserver(() => scan());
observer.observe(document.body, { childList: true, subtree: true });
scan();
