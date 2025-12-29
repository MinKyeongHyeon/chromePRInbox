// background service worker: manage snooze alarms and notifications
// map notification id -> url to handle clicks without adding multiple listeners
const _notifMap = {};
chrome.notifications.onClicked.addListener((notifId) => {
  try {
    const url = _notifMap[notifId];
    if (url) {
      // try to focus an existing tab matching the URL to avoid duplicates
      chrome.tabs.query({}, (tabs) => {
        try {
          const found = tabs.find(
            (t) => t.url === url || (t.url && t.url.startsWith(url))
          );
          if (found) {
            // focus window and activate tab
            chrome.windows.update(found.windowId, { focused: true }, () => {
              chrome.tabs.update(found.id, { active: true });
            });
          } else {
            chrome.tabs.create({ url });
          }
        } catch (e) {
          chrome.tabs.create({ url });
        }
        delete _notifMap[notifId];
        chrome.notifications.clear(notifId, () => {});
      });
      return;
    }
    // clear notification if no mapping
    chrome.notifications.clear(notifId, () => {});
  } catch (e) {
    console.warn("notification click handler error", e);
  }
});

async function updateBadge() {
  try {
    const state = await new Promise((r) =>
      chrome.storage.local.get(["prCache", "seenPRs", "snoozedPRs"], (s) =>
        r(s || {})
      )
    );
    const items = (state.prCache && state.prCache.items) || [];
    const seen = new Set(
      (
        await new Promise((r) =>
          chrome.storage.local.get(["seenPRs"], (s) => r(s || {}))
        )
      )["seenPRs"] || []
    );
    const snoozed = state.snoozedPRs || {};
    const now = Date.now();
    let cnt = 0;
    for (const it of items) {
      const key =
        it.html_url || it.subject_url || `${it.repo_full_name}#${it.number}`;
      const sno = snoozed[key];
      const snoUntil = sno && sno.until ? sno.until : 0;
      if (snoUntil && now < snoUntil) continue;
      if (!seen.has(key)) cnt++;
    }
    const text = cnt > 0 ? String(cnt) : "";
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: "#5865F2" });
  } catch (e) {
    console.warn("updateBadge failed", e);
  }
}

// schedule alarms for existing snoozes
async function scheduleAlarmsForSnoozes() {
  const s = await new Promise((r) =>
    chrome.storage.local.get(["snoozedPRs"], (v) => r(v || {}))
  );
  const sno = s.snoozedPRs || {};
  for (const key of Object.keys(sno)) {
    const entry = sno[key];
    if (!entry || !entry.until) continue;
    const when = entry.until;
    if (when > Date.now()) {
      const name = "snooze_" + encodeURIComponent(key);
      chrome.alarms.create(name, { when });
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarmsForSnoozes();
  // start periodic poll for incoming review requests / assignments
  try {
    chrome.alarms.create("poll_prs", { periodInMinutes: 5 });
  } catch (e) {}
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarmsForSnoozes();
  try {
    chrome.alarms.create("poll_prs", { periodInMinutes: 5 });
  } catch (e) {}
  updateBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes.snoozedPRs ||
      changes.pinnedPRs ||
      changes.prCache ||
      changes.seenPRs)
  ) {
    // reschedule alarms when snoozedPRs changed
    if (changes.snoozedPRs) {
      // clear all snooze alarms and reschedule (simple approach)
      chrome.alarms.getAll((alarms) => {
        for (const a of alarms) {
          if (a.name && a.name.startsWith("snooze_"))
            chrome.alarms.clear(a.name);
        }
        scheduleAlarmsForSnoozes();
      });
    }
    updateBadge();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (!alarm || !alarm.name) return;
    if (alarm.name.startsWith("snooze_")) {
      const key = decodeURIComponent(alarm.name.replace("snooze_", ""));
      const s = await new Promise((r) =>
        chrome.storage.local.get(["snoozedPRs"], (v) => r(v || {}))
      );
      const sno = s.snoozedPRs || {};
      const entry = sno[key];
      if (!entry) return;
      // if still due
      if (entry.until && entry.until <= Date.now()) {
        // remove snooze
        delete sno[key];
        chrome.storage.local.set({ snoozedPRs: sno });
        // show notification
        const notifId = "snooze-" + Math.random().toString(36).slice(2, 9);
        const title = entry.title || "PR 알림";
        const message = "Snooze 해제: " + title;
        // store mapping so the single click listener can open the URL
        if (entry.url) _notifMap[notifId] = entry.url;
        chrome.notifications.create(
          notifId,
          {
            type: "basic",
            iconUrl: "icon.png",
            title,
            message,
            priority: 2,
          },
          () => {}
        );
        // notify popup(s) to refresh their view (if open)
        try {
          chrome.runtime.sendMessage({ type: "reloadPRs" });
        } catch (e) {}
      }
    }
    // periodic poll for review requests / assignments
    if (alarm.name === "poll_prs") {
      try {
        await pollForAssignedOrReviewRequests();
      } catch (e) {
        console.warn("poll_prs handler failed", e);
      }
    }
  } catch (e) {
    console.warn("onAlarm handler failed", e);
  }
});

// Poll GitHub for PRs where the user is review-requested or assignee,
// and create notifications for newly discovered items.
async function pollForAssignedOrReviewRequests() {
  try {
    const sync = await new Promise((r) =>
      chrome.storage.sync.get(["githubToken"], (s) => r(s || {}))
    );
    const token = sync.githubToken;
    if (!token) return;

    // get user login
    let user = null;
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!res.ok) return;
      user = await res.json();
    } catch (e) {
      return;
    }
    const login = user && user.login;
    if (!login) return;

    const q = `is:pr is:open (review-requested:${login} OR assignee:${login})`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(
      q
    )}&per_page=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return;
    const j = await res.json();
    const items = (j.items || []).map((it) => ({
      title: it.title,
      html_url: it.html_url,
      repo_full_name: it.repository_url
        ? it.repository_url.replace("https://api.github.com/repos/", "")
        : "",
      number: it.number,
    }));

    // load notified and snoozed state
    const s = await new Promise((r) =>
      chrome.storage.local.get(["notifiedPRs", "snoozedPRs"], (v) => r(v || {}))
    );
    const notified = new Set(s.notifiedPRs || []);
    const snoozed = s.snoozedPRs || {};
    const now = Date.now();
    let changed = false;
    for (const it of items) {
      const key = it.html_url || `${it.repo_full_name}#${it.number}`;
      // skip if snoozed
      const sno = snoozed[key];
      if (sno && sno.until && now < sno.until) continue;
      if (notified.has(key)) continue;

      // create notification
      const notifId = "auto-" + Math.random().toString(36).slice(2, 9);
      if (it.html_url) _notifMap[notifId] = it.html_url;
      const title = it.title || "새 PR 알림";
      const message = `${it.repo_full_name} · #${it.number} — 리뷰 요청/배정됨`;
      try {
        chrome.notifications.create(
          notifId,
          { type: "basic", iconUrl: "icon.png", title, message, priority: 2 },
          () => {}
        );
      } catch (e) {}

      notified.add(key);
      changed = true;
    }

    if (changed) {
      chrome.storage.local.set({ notifiedPRs: Array.from(notified) });
      try {
        chrome.runtime.sendMessage({ type: "reloadPRs" });
      } catch (e) {}
      try {
        await updateBadge();
      } catch (e) {}
    }
  } catch (e) {
    console.warn("pollForAssignedOrReviewRequests failed", e);
  }
}

// update badge periodically as a fallback
setInterval(updateBadge, 1000 * 60);

// expose a simple message interface
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "updateBadge") {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
});
