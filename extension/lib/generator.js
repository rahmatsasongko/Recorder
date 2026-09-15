// Generator registry.
// -------------------
// Recording is framework-agnostic: gen-core.js turns recorded steps into one
// Page Object Model, and each renderer below spells that model in its own
// framework. Adding a framework means adding a renderer, not a second
// extension.
//
//   window.Generators.get("playwright").generateFiles(session)
//   window.Generators.get("cypress").generateProjectFiles(suites)
//
// Every renderer exposes the same shape:
//   { id, label, specSuffix, generateFiles, generateProjectFiles }

(function () {
  const DEFAULT_ID = "cypress";

  const list = [window.GenCypress, window.GenPlaywright, window.GenWdio].filter(
    Boolean,
  );

  const byId = {};
  list.forEach((g) => {
    byId[g.id] = g;
  });

  function get(id) {
    return byId[id] || byId[DEFAULT_ID] || list[0];
  }

  window.Generators = { DEFAULT_ID, list, byId, get };

  // The Cypress generator used to be the only one; keep the old handle
  // working for anything that still reaches for it by name.
  window.CypressGen = byId[DEFAULT_ID];
})();
