const { computeBadgeCount } = require("../lib/utils");

describe("computeBadgeCount", () => {
  const now = 1700000000000; // fixed timestamp

  test("counts unseen non-snoozed items", () => {
    const items = [
      { html_url: "https://github.com/a/1", repo_full_name: "a", number: 1 },
      { html_url: "https://github.com/b/2", repo_full_name: "b", number: 2 },
    ];
    const seen = [];
    const snoozed = {};
    expect(computeBadgeCount(items, seen, snoozed, now)).toBe(2);
  });

  test("excludes seen items", () => {
    const items = [
      { html_url: "https://github.com/a/1", repo_full_name: "a", number: 1 },
      { html_url: "https://github.com/b/2", repo_full_name: "b", number: 2 },
    ];
    const seen = ["https://github.com/a/1"];
    const snoozed = {};
    expect(computeBadgeCount(items, seen, snoozed, now)).toBe(1);
  });

  test("excludes snoozed items", () => {
    const items = [
      { html_url: "https://github.com/a/1", repo_full_name: "a", number: 1 },
      { html_url: "https://github.com/b/2", repo_full_name: "b", number: 2 },
    ];
    const seen = [];
    const snoozed = {
      "https://github.com/a/1": { until: now + 10000 },
    };
    expect(computeBadgeCount(items, seen, snoozed, now)).toBe(1);
  });

  test("snooze expired counts again", () => {
    const items = [
      { html_url: "https://github.com/a/1", repo_full_name: "a", number: 1 },
    ];
    const seen = [];
    const snoozed = {
      "https://github.com/a/1": { until: now - 1000 },
    };
    expect(computeBadgeCount(items, seen, snoozed, now)).toBe(1);
  });
  test("no items returns zero", () => {
    expect(computeBadgeCount([], [], {}, now)).toBe(0);
  });

  test("malformed snooze entry ignored", () => {
    const items = [
      { html_url: "https://github.com/x/1", repo_full_name: "x", number: 1 },
    ];
    const snoozed = { "https://github.com/x/1": { foo: "bar" } };
    expect(computeBadgeCount(items, [], snoozed, now)).toBe(1);
  });
});
