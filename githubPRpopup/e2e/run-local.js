const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const extensionPath = path.resolve(__dirname, "..");
  const userDataDir = path.join(__dirname, "tmp-profile");
  if (!fs.existsSync(userDataDir))
    fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 900, height: 800 },
  });

  // give extension time to load
  await new Promise((r) => setTimeout(r, 1200));

  // try to discover extension id from any background or extension page
  const allPages = context.backgroundPages().concat(context.pages());
  let extensionId = null;
  for (const p of allPages) {
    try {
      const url = p.url();
      if (url && url.startsWith("chrome-extension://")) {
        extensionId = url.split("/")[2];
        break;
      }
    } catch (e) {}
  }

  if (!extensionId) {
    console.error(
      "Extension id not found automatically. Check extension path or increase timeout."
    );
    await context.close();
    process.exit(1);
  }

  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  console.log("Extension id:", extensionId);
  console.log("Opening popup:", popupUrl);

  const page = await context.newPage();
  await page.goto(popupUrl);

  // set a test snoozed entry via chrome.storage.local inside the extension context
  await page.evaluate(
    () =>
      new Promise((res) =>
        chrome.storage.local.set(
          {
            snoozedPRs: {
              "https://example.com/test/1": {
                until: Date.now() + 60 * 1000,
                title: "E2E Test PR",
                url: "https://example.com/test/1",
              },
            },
          },
          () => res()
        )
      )
  );

  // reload so popup picks up changes
  await page.reload();

  // open snooze panel
  await page.click("#manageSnoozesBtn");

  // wait for snooze item
  try {
    await page.waitForSelector(".snooze-item", { timeout: 5000 });
    console.log("SNOOZE item visible in popup");
  } catch (e) {
    console.error("SNOOZE item not found in popup", e);
  }

  // cleanup
  await context.close();
  process.exit(0);
})();
