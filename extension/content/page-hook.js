// Runs in the PAGE's own JavaScript world (manifest: "world": "MAIN"), at
// document_start so it is in place before any page script.
//
// content.js cannot see single-page-app navigation on its own: a content script
// lives in an isolated world with its own copy of `history`, so patching
// pushState there never touches the page's calls. This hook patches the page's
// real History and tells the recorder with a plain DOM event, which — unlike
// JS objects — crosses between worlds.

(() => {
  if (window.__cypNavHook) return;
  Object.defineProperty(window, "__cypNavHook", { value: true });

  const EVENT = "cyp:navigate";

  function wrap(name) {
    const orig = History.prototype[name];
    if (typeof orig !== "function") return;
    History.prototype[name] = function () {
      const before = location.href;
      const result = orig.apply(this, arguments);
      // Only a real change of address is a navigation: routers call
      // replaceState all the time to stash scroll position or state.
      if (location.href !== before) {
        try {
          window.dispatchEvent(new Event(EVENT));
        } catch (e) {
          /* never let recording break the page */
        }
      }
      return result;
    };
  }

  wrap("pushState");
  wrap("replaceState");
})();
