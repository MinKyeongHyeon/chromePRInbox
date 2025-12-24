// basic Playwright config for extension E2E (skeleton)
const { devices } = require("@playwright/test");
module.exports = {
  testDir: "e2e",
  timeout: 120000,
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
};
