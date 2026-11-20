// Browser e2e on a slow or busy machine (a GitHub runner, a laptop on battery, a fresh Windows install): every page and
// context the suite opens waits up to 60 s for an element or a navigation instead of Playwright's 30 s. The tests still
// wait on real signals (a selector, a state change); this only gives a slow machine room. STUDIO_E2E_TIMEOUT_MS overrides.
export const E2E_TIMEOUT = +process.env.STUDIO_E2E_TIMEOUT_MS || 60e3;
export function patient(browser, ms = E2E_TIMEOUT) {
  const tune = x => { x.setDefaultTimeout(ms); x.setDefaultNavigationTimeout(ms); return x; };
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
  browser.newContext = async (...a) => tune(await newContext(...a));
  browser.newPage = async (...a) => tune(await newPage(...a));
  return browser;
}
