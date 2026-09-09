// Per-browser search profile — lets anyone who clones this repo run it
// for their OWN office address and requirements without editing config.js.
// Stored in localStorage only: no accounts, no password, nothing sent
// anywhere. config.js's CONFIG.OFFICE_ADDRESS / CONFIG.REQUIREMENTS remain
// the *defaults* a fresh visitor's sign-up form is pre-filled with (so the
// original deployer sees their own already-correct values and can just
// confirm them) — this module is what lets a visitor override those
// per-device from then on.

(function (root) {
  const PROFILE_KEY = "flatfinder.profile";

  function defaultProfile() {
    const cfg = (typeof CONFIG !== "undefined" && CONFIG) || {};
    return {
      name: "",
      officeName: cfg.OFFICE_NAME || "",
      officeAddress: cfg.OFFICE_ADDRESS || "",
      requirements: Object.assign({
        bhk: 1,
        furnishing: "semi",
        maxRent: 15000,
        maxDeposit: 50000,
        lift: true,
        brokerageZero: true,
        maxCommuteMinutes: 30,
      }, cfg.REQUIREMENTS || {}),
    };
  }

  function getProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveProfile(profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // best-effort — profile just won't persist across reloads
    }
  }

  function clearProfile() {
    try { localStorage.removeItem(PROFILE_KEY); } catch {}
  }

  // Whether a profile is functionally identical to this deployment's own
  // built-in config.js defaults — determines whether the app can trust the
  // pipeline's own server-computed match_status/commute_minutes as-is, or
  // needs to recompute them client-side against a genuinely different
  // office/requirements (see app.js). Comparing this way (not just
  // "does a profile exist") means re-saving the form with unchanged values
  // doesn't trigger pointless recomputation.
  function isDefaultProfile(profile) {
    const d = defaultProfile();
    if (!profile) return true;
    if ((profile.officeAddress || "").trim() !== (d.officeAddress || "").trim()) return false;
    const pr = profile.requirements || {};
    const dr = d.requirements;
    return ["bhk", "furnishing", "maxRent", "maxDeposit", "lift", "brokerageZero", "maxCommuteMinutes"]
      .every((k) => pr[k] === dr[k]);
  }

  root.FlatFinderProfile = { defaultProfile, getProfile, saveProfile, clearProfile, isDefaultProfile };
})(typeof window !== "undefined" ? window : this);
