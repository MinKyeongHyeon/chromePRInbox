const headerEl = document.getElementById("header");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// Theme helpers: supports 'auto'|'dark'|'light'. 'auto' follows system prefers-color-scheme.
function applyThemeMode(mode) {
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDark = mode === "dark" || (mode === "auto" && prefersDark);
  document.documentElement.classList.toggle("dark", useDark);
  const btn = document.getElementById("themeToggle");
  if (btn)
    btn.textContent =
      mode === "dark"
        ? "🌙"
        : mode === "light"
        ? "☀️"
        : prefersDark
        ? "🌙"
        : "☀️";
}
function cycleTheme(current) {
  if (current === "auto") return "dark";
  if (current === "dark") return "light";
  return "auto";
}
function setTheme(mode) {
  chrome.storage.sync.set({ uiTheme: mode }, () => applyThemeMode(mode));
}
function loadAndApplyTheme() {
  chrome.storage.sync.get(["uiTheme"], (res) => {
    const mode = res.uiTheme || "auto";
    applyThemeMode(mode);
    // respond to system changes when in auto mode
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq && mq.addEventListener) {
        mq.addEventListener("change", () => {
          chrome.storage.sync.get(["uiTheme"], (r) => {
            if (!r.uiTheme || r.uiTheme === "auto") applyThemeMode("auto");
          });
        });
      }
    }
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.onclick = () => {
        chrome.storage.sync.get(["uiTheme"], (r) => {
          const cur = r.uiTheme || "auto";
          const next = cycleTheme(cur);
          setTheme(next);
        });
      };
    }
  });
}

// Helper: fetch current authenticated user
async function getUser(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`user: ${res.status} ${res.statusText} ${text}`);
    err.response = {
      status: res.status,
      statusText: res.statusText,
      body: text,
    };
    throw err;
  }
  return res.json();
}

// Helper: convert PR API URL to web URL
function prApiUrlToWeb(apiUrl) {
  if (!apiUrl) return null;
  // example: https://api.github.com/repos/owner/repo/pulls/123
  return apiUrl
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace(/pulls\//, "pull/");
}

// Helper: mark notification thread as read with retries (exponential backoff)
async function markAsRead(token, threadId, attempts = 3) {
  let attempt = 0;
  let delay = 300; // ms
  while (attempt < attempts) {
    try {
      const res = await fetch(
        `https://api.github.com/notifications/threads/${threadId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
          },
        }
      );
      if (res.status === 205) return true;
      const t = await res.text();
      const err = new Error(`markAsRead: ${res.status} ${res.statusText} ${t}`);
      err.response = {
        status: res.status,
        statusText: res.statusText,
        body: t,
      };
      throw err;
    } catch (e) {
      attempt += 1;
      console.warn(`markAsRead attempt ${attempt} failed`, e);
      if (attempt >= attempts) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

// Helper: get unread PR notifications (using Notifications API) with paging
async function getPRNotifications(
  token,
  page = 1,
  perPage = 30,
  ifNoneMatch = null
) {
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
  };
  if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;

  const res = await fetch(
    `https://api.github.com/notifications?participating=true&per_page=${perPage}&page=${page}`,
    { headers }
  );

  // 304 Not Modified -> indicates no change since ETag
  if (res.status === 304) {
    return { notModified: true, etag: res.headers.get("ETag") };
  }

  if (!res.ok) {
    const t = await res.text();
    const err = new Error(
      `notifications: ${res.status} ${res.statusText} ${t}`
    );
    err.response = { status: res.status, statusText: res.statusText, body: t };
    throw err;
  }

  const notifs = await res.json();

  // Determine if there's a next page via Link header
  const linkHeader = res.headers.get("Link") || "";
  const hasNext = /rel=\"next\"/.test(linkHeader);

  // Filter to PR notifications — include 'Issue' subjects that may represent PRs
  const prNotifs = notifs.filter((n) => {
    if (!n.subject || !n.subject.url) return false;
    const url = n.subject.url;
    return (
      n.subject.type === "PullRequest" ||
      /\/pulls?\//.test(url) ||
      /\/issues\//.test(url)
    );
  });

  const items = [];
  for (const n of prNotifs) {
    try {
      const subjUrl = n.subject.url;
      if (!subjUrl) continue;

      const subjRes = await fetch(subjUrl, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (!subjRes.ok) {
        console.warn(
          "Failed to fetch subject details",
          subjUrl,
          subjRes.status
        );
        continue;
      }

      let subj = await subjRes.json();

      // If this is an issue that contains a pull_request reference, fetch the PR details
      if (subj.pull_request && subj.pull_request.url) {
        try {
          const prApiRes = await fetch(subj.pull_request.url, {
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github+json",
            },
          });
          if (prApiRes.ok) subj = await prApiRes.json();
        } catch (e) {
          console.warn(
            "Failed to fetch PR via pull_request.url",
            subj.pull_request.url,
            e
          );
        }
      }

      // Some subjects may be issues or PRs — ensure we only include open PRs
      // PR resources typically include 'state' and 'html_url'
      if (subj.state && subj.state !== "open") continue;

      const item = {
        title: subj.title || n.subject.title,
        html_url:
          subj.html_url ||
          (subj.pull_request && subj.pull_request.html_url) ||
          null,
        repo_full_name:
          n.repository && n.repository.full_name
            ? n.repository.full_name
            : (subj.base && subj.base.repo && subj.base.repo.full_name) || "",
        reason: n.reason,
        thread_id: n.id,
        number: subj.number || null,
        user: subj.user ? subj.user.login : null,
        updated_at: subj.updated_at || null,
        subject_url: subjUrl,
      };

      items.push(item);
    } catch (err) {
      console.error("PR processing error", err);
    }
  }
  const rawCount = notifs.length;
  const prCandidateCount = prNotifs.length;
  const sampleNotifs = prNotifs.slice(0, 5).map((n) => ({
    id: n.id,
    title: n.subject && n.subject.title,
    url: n.subject && n.subject.url,
    type: n.subject && n.subject.type,
  }));
  const etag = res.headers.get("ETag");
  return { items, hasNext, rawCount, prCandidateCount, sampleNotifs, etag };
}

chrome.storage.sync.get(["githubToken"], async (res) => {
  const token = res.githubToken;

  if (!token) {
    headerEl.innerHTML = `<button id="goOpt">토큰 입력</button>`;
    statusEl.innerText = "GitHub Token 필요";
    document.getElementById("goOpt").onclick = () =>
      chrome.runtime.openOptionsPage();
    return;
  }

  try {
    statusEl.innerText = "불러오는 중...";

    const user = await getUser(token);
    // set header avatar and user elements
    const avatarEl = document.getElementById("headerAvatar");
    const userEl = document.getElementById("headerUser");
    const countEl = document.getElementById("headerCount");
    if (user.avatar_url && avatarEl) {
      avatarEl.src = user.avatar_url;
      avatarEl.style.display = "inline-block";
    }
    if (userEl) userEl.innerText = user.login;
    if (countEl) countEl.innerText = `Unread 0`;
    // Apply theme (load from storage and react to system preference)
    try {
      loadAndApplyTheme();
    } catch (e) {
      console.warn("Theme load failed", e);
    }
    // Pro upgrade button: open Options (placeholder for upgrade flow)
    try {
      const proBtn = document.getElementById("proBtn");
      if (proBtn) {
        proBtn.onclick = () => {
          // Open options page where upgrade CTA/flow can be shown
          try {
            chrome.runtime.openOptionsPage();
          } catch (e) {
            // fallback to opening options.html directly
            window.open("options.html", "_blank");
          }
        };
      }
    } catch (e) {
      console.warn("Theme load failed", e);
    }
    // Filter UI and logic
    function toggleFilterPanel() {
      const panel = document.getElementById("filterPanel");
      if (!panel) return;
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }

    async function loadFiltersUI() {
      const res = await new Promise((r) =>
        chrome.storage.sync.get(["filters"], (v) => r(v || {}))
      );
      const f = res.filters || {};
      document.getElementById("filterRepo").value = f.repo || "";
      document.getElementById("filterAuthor").value = f.author || "";
      document.getElementById("filterLabels").value = (f.labels || []).join(
        ","
      );
      document.getElementById("role_author").checked = (f.roles || []).includes(
        "author"
      );
      document.getElementById("role_review").checked = (f.roles || []).includes(
        "review_requested"
      );
      document.getElementById("role_assignee").checked = (
        f.roles || []
      ).includes("assignee");
    }

    function saveFiltersFromUI() {
      const repo = document.getElementById("filterRepo").value.trim();
      const author = document.getElementById("filterAuthor").value.trim();
      const labels = document
        .getElementById("filterLabels")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const roles = [];
      if (document.getElementById("role_author").checked) roles.push("author");
      if (document.getElementById("role_review").checked)
        roles.push("review_requested");
      if (document.getElementById("role_assignee").checked)
        roles.push("assignee");
      const filters = {
        repo: repo || null,
        author: author || null,
        labels,
        roles,
      };
      chrome.storage.sync.set({ filters });
      return filters;
    }

    // get labels for an issue/pr (caches in chrome.storage.local for 1 hour)
    async function getIssueLabels(token, repoFull, number) {
      if (!repoFull || !number) return [];
      const key = `labels:${repoFull}#${number}`;
      const cached = await new Promise((r) =>
        chrome.storage.local.get([key], (res) => r(res[key] || null))
      );
      const now = Date.now();
      if (
        cached &&
        cached.fetchedAt &&
        now - cached.fetchedAt < 1000 * 60 * 60
      ) {
        return cached.labels || [];
      }
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repoFull}/issues/${number}`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github+json",
            },
          }
        );
        if (!res.ok) return [];
        const j = await res.json();
        const labels = (j.labels || []).map((l) => (l.name ? l.name : l));
        chrome.storage.local.set({ [key]: { labels, fetchedAt: Date.now() } });
        return labels;
      } catch (e) {
        return [];
      }
    }

    // apply filters to items; supports repo substring, author exact, roles (author/review_requested/assignee), labels (match any)
    async function applyFilters(items, token) {
      const cfg = await new Promise((r) =>
        chrome.storage.sync.get(["filters"], (v) => r(v.filters || {}))
      );
      if (
        !cfg ||
        (!cfg.repo &&
          !cfg.author &&
          (!cfg.roles || cfg.roles.length === 0) &&
          (!cfg.labels || cfg.labels.length === 0))
      )
        return items;
      const out = [];
      const needLabelFetch = [];
      // first pass: apply repo/author/roles filters
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        let keep = false;
        if (cfg.repo) {
          if (
            it.repo_full_name &&
            it.repo_full_name.toLowerCase().includes(cfg.repo.toLowerCase())
          )
            keep = true;
        }
        if (
          cfg.author &&
          it.user &&
          it.user.toLowerCase() === cfg.author.toLowerCase()
        )
          keep = true;
        if (cfg.roles && cfg.roles.length > 0) {
          for (const r of cfg.roles) {
            if ((it.reason || "").toLowerCase().includes(r)) {
              keep = true;
              break;
            }
          }
        }
        if (keep) {
          out.push(it);
        } else if (
          cfg.labels &&
          cfg.labels.length > 0 &&
          it.repo_full_name &&
          it.number
        ) {
          // schedule label fetch for later, store index
          needLabelFetch.push(i);
        }
      }

      // fetch labels in parallel for items that require label checks
      if (needLabelFetch.length > 0) {
        const promises = needLabelFetch.map((idx) => {
          const it = items[idx];
          return getIssueLabels(token, it.repo_full_name, it.number).then(
            (labels) => ({ idx, labels })
          );
        });
        const results = await Promise.all(promises);
        for (const r of results) {
          const it = items[r.idx];
          const labels = r.labels || [];
          it.labels = labels;
          for (const lf of cfg.labels) {
            if (labels.some((L) => L.toLowerCase() === lf.toLowerCase())) {
              out.push(it);
              break;
            }
          }
        }
      }

      return out;
    }

    // hookup filter UI buttons
    const filterBtn = document.getElementById("filterBtn");
    if (filterBtn) filterBtn.onclick = () => toggleFilterPanel();
    const saveFiltersBtn = document.getElementById("saveFiltersBtn");
    if (saveFiltersBtn)
      saveFiltersBtn.onclick = async () => {
        saveFiltersFromUI();
        // reload page with filters applied
        page = 1;
        await loadPage(false);
        toggleFilterPanel();
      };
    const clearFiltersBtn = document.getElementById("clearFiltersBtn");
    if (clearFiltersBtn)
      clearFiltersBtn.onclick = async () => {
        chrome.storage.sync.set({ filters: {} });
        await loadFiltersUI();
        page = 1;
        await loadPage(false);
      };
    // initialize UI
    try {
      await loadFiltersUI();
    } catch (e) {
      /* ignore */
    }
    // paging state
    let page = 1;
    const perPage = 30;

    async function loadPage(append = false) {
      statusEl.innerText = "불러오는 중...";
      try {
        // load cache (etag + items)
        const cache = await new Promise((resolve) =>
          chrome.storage.local.get(["prCache"], (r) =>
            resolve(r.prCache || null)
          )
        );
        const etag = cache && cache.etag ? cache.etag : null;

        const resObj = await getPRNotifications(
          token,
          page,
          perPage,
          page === 1 ? etag : null
        );

        // If not modified (304), reuse cache
        let items = [];
        let hasNext = false;
        let rawCount = 0;
        let prCandidateCount = 0;
        let sampleNotifs = [];

        if (resObj.notModified) {
          if (cache && cache.items) {
            items = cache.items;
            rawCount = cache.rawCount || 0;
            prCandidateCount = cache.prCandidateCount || 0;
            sampleNotifs = cache.sampleNotifs || [];
            // quick status: nothing changed
            statusEl.innerHTML = `<div class="empty">최근 변경사항 없음</div>`;
          } else {
            // no cache present unexpectedly — force a fresh load without etag
            const fresh = await getPRNotifications(token, page, perPage, null);
            ({ items, hasNext, rawCount, prCandidateCount, sampleNotifs } =
              fresh);
          }
        } else {
          ({ items, hasNext, rawCount, prCandidateCount, sampleNotifs } =
            resObj);
          // cached thread ids (used to determine if a notification is new)
          const cachedIds = new Set(
            cache && cache.items ? cache.items.map((i) => i.thread_id) : []
          );
          // We'll compute isNew deterministically later after merging authored/GraphQL results.
          // persist cache (store minimal items array and etag)
          try {
            const cacheToStore = {
              etag: resObj.etag,
              items,
              rawCount,
              prCandidateCount,
              sampleNotifs,
              fetchedAt: Date.now(),
            };
            chrome.storage.local.set({ prCache: cacheToStore });
          } catch (e) {
            console.warn("Failed to write cache", e);
          }
        }

        // update header summary counts
        const headerSummaryEl = document.getElementById("headerSummary");
        const countEl = document.getElementById("headerCount");
        if (headerSummaryEl)
          headerSummaryEl.innerText = `알림 ${rawCount} · PR 후보 ${prCandidateCount}`;

        // 보완: authored open PRs도 가져와서 합칩니다 (중복 제거)
        let authored = [];
        try {
          authored = await fetchAuthoredOpenPRs(token, user.login);
          // merge authored into items if not present
          const urls = new Set(items.map((i) => i.html_url));
          authored.forEach((a) => {
            if (!urls.has(a.html_url)) {
              a.reason = a.reason || "author";
              items.unshift(a); // put authored PRs at top
            }
          });
        } catch (e) {
          console.warn("fetch authored PRs failed", e);
        }
        // if authored search returned none, add hint for scopes (user might have private PRs)
        // (this will be used below when showing empty states)
        let authoredHint = null;
        if (Array.isArray(authored) && authored.length === 0) {
          authoredHint =
            "참고: 내 PR이 보이지 않으면 private repo 권한('repo')이 필요할 수 있습니다. Options에서 토큰을 확인하세요.";
        }
        console.info(
          "Authored PRs:",
          authored.map((a) => a.html_url)
        );

        // Determine NEW badge deterministically:
        // - If the URL/subject has been marked 'seen' in storage, it's not NEW
        // - If it has a notification thread_id and wasn't present in previous cache, it's NEW
        // - Otherwise, for authored/graphql items (no thread_id), consider them NEW only if updated within last 7 days
        const NEW_WINDOW_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
        const seenSet = await new Promise((r) =>
          chrome.storage.local.get(["seenPRs"], (res) =>
            r(new Set(res.seenPRs || []))
          )
        );
        const cachedThreadIds = new Set(
          cache && cache.items
            ? cache.items.map((i) => i.thread_id).filter(Boolean)
            : []
        );

        items.forEach((it) => {
          const key =
            it.html_url ||
            it.subject_url ||
            `${it.repo_full_name}#${it.number}`;
          if (seenSet.has(key)) {
            it.isNew = false;
            return;
          }
          if (it.thread_id) {
            it.isNew = !cachedThreadIds.has(it.thread_id);
            return;
          }
          // authored / graphql fallback: check recent updates
          const updated = it.updated_at ? new Date(it.updated_at).getTime() : 0;
          it.isNew = updated && Date.now() - updated <= NEW_WINDOW_MS;
        });

        // fetchAuthoredOpenPRs implementation
        async function fetchAuthoredOpenPRs(token, login) {
          if (!login) return [];
          try {
            const q = `is:pr is:open author:${login}`;
            const url = `https://api.github.com/search/issues?q=${encodeURIComponent(
              q
            )}&per_page=50`;
            const res = await fetch(url, {
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github+json",
              },
            });
            if (!res.ok) {
              const txt = await res.text();
              console.warn("Search authored PRs failed", res.status, txt);
              return [];
            }
            const j = await res.json();
            const items = (j.items || []).map((it) => {
              const repoMatch = it.repository_url
                ? it.repository_url.replace("https://api.github.com/repos/", "")
                : "";
              return {
                title: it.title,
                html_url: it.html_url,
                repo_full_name: repoMatch,
                reason: "author",
                thread_id: null,
                number: it.number,
                user: it.user && it.user.login,
                updated_at: it.updated_at,
                subject_url: it.url,
              };
            });
            return items;
          } catch (e) {
            console.warn("fetchAuthoredOpenPRs error", e);
            return [];
          }
        }

        // GraphQL 폴백: user 기반으로 열린 PR을 직접 조회
        async function fetchGraphQLPRs(token, login) {
          if (!login) return [];
          const query = `query SearchPRs($q: String!, $first: Int!) { search(query: $q, type: ISSUE, first: $first) { nodes { ... on PullRequest { number title url repository { nameWithOwner } updatedAt author { login } } } } }`;
          const q = `is:pr is:open (review-requested:${login} OR assignee:${login} OR author:${login})`;
          try {
            const res = await fetch("https://api.github.com/graphql", {
              method: "POST",
              headers: {
                Authorization: `bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ query, variables: { q, first: 50 } }),
            });
            if (!res.ok) {
              const t = await res.text();
              console.warn("GraphQL search failed", res.status, t);
              return [];
            }
            const j = await res.json();
            const nodes =
              j.data && j.data.search && j.data.search.nodes
                ? j.data.search.nodes
                : [];
            return nodes.map((n) => ({
              title: n.title,
              html_url: n.url,
              repo_full_name: n.repository ? n.repository.nameWithOwner : "",
              reason: "graphql",
              thread_id: null,
              number: n.number || null,
              user: n.author ? n.author.login : null,
              updated_at: n.updatedAt || null,
              subject_url: null,
            }));
          } catch (e) {
            console.warn("fetchGraphQLPRs error", e);
            return [];
          }
        }

        if (!append) {
          listEl.innerHTML = "";
        }

        // If items are empty on first page, attempt a GraphQL fallback to find open PRs
        if (items.length === 0 && page === 1) {
          try {
            const gqlItems = await fetchGraphQLPRs(token, user.login);
            if (gqlItems && gqlItems.length > 0) {
              const urls = new Set(items.map((i) => i.html_url));
              gqlItems.forEach((g) => {
                if (!urls.has(g.html_url)) items.unshift(g);
              });
              // reflect gql results in candidate count when appropriate
              prCandidateCount = prCandidateCount || gqlItems.length;
              console.info(
                "GraphQL PRs added:",
                gqlItems.map((g) => g.html_url)
              );
            } else {
              console.info("GraphQL fallback returned no PRs");
            }
          } catch (e) {
            console.warn("GraphQL fallback failed", e);
          }
        }

        // Apply user filters (if any)
        try {
          items = await applyFilters(items, token);
        } catch (e) {
          console.warn("applyFilters failed", e);
        }

        // Load pin/snooze state and apply: hide snoozed, lift pinned to top
        const storageState = await new Promise((r) =>
          chrome.storage.local.get(["pinnedPRs", "snoozedPRs"], (s) =>
            r(s || {})
          )
        );
        const pinnedPRs = new Set(storageState.pinnedPRs || []);
        const snoozedPRs = storageState.snoozedPRs || {}; // { key: {until,title,url} }
        const nowTs = Date.now();
        const visible = [];
        const pinnedItems = [];
        function prKey(it) {
          return (
            it.html_url || it.subject_url || `${it.repo_full_name}#${it.number}`
          );
        }
        for (const it of items) {
          const key = prKey(it);
          const snoozeEntry = snoozedPRs[key];
          const snoozeUntil = snoozeEntry ? snoozeEntry.until : 0;
          if (snoozeUntil && nowTs < snoozeUntil) {
            // currently snoozed -> skip
            continue;
          }
          if (pinnedPRs.has(key)) {
            it.__pinned = true;
            pinnedItems.push(it);
          } else {
            visible.push(it);
          }
        }
        // render pinned first
        items = pinnedItems.concat(visible);

        if (items.length === 0 && page === 1) {
          // No PRs to show — keep header summary and show concise message only
          if (countEl) countEl.innerText = `Unread 0`;
          if (prCandidateCount > 0) {
            statusEl.innerHTML = `<div class="empty">열린 PR 없음 (PR 후보 ${prCandidateCount}개)${
              authoredHint
                ? `<div style="font-size:12px;color:#888;margin-top:6px">${authoredHint}</div>`
                : ""
            }</div>`;
            console.info("PR candidate samples:", sampleNotifs);
          } else if (rawCount > 0) {
            statusEl.innerHTML = `<div class="empty">알림은 ${rawCount}개 있으나 PR 관련 알림이 없습니다${
              authoredHint
                ? `<div style="font-size:12px;color:#888;margin-top:6px">${authoredHint}</div>`
                : ""
            }</div>`;
            console.info(
              "No PR candidates; run '진단' to inspect notifications."
            );
          } else {
            statusEl.innerHTML = `<div class="empty">Unread PR 없음 🎉${
              authoredHint
                ? `<div style="font-size:12px;color:#888;margin-top:6px">${authoredHint}</div>`
                : ""
            }</div>`;
          }
          document.getElementById("loadMoreBtn").style.display = "none";
          return;
        }

        // fetch repo meta for displayed items (cache-aware)
        const repoNames = Array.from(
          new Set(items.map((i) => i.repo_full_name).filter(Boolean))
        );
        const repoMetaMap = {};
        await Promise.all(
          repoNames.map(async (fullname) => {
            try {
              const meta = await getRepoMeta(token, fullname);
              if (meta) repoMetaMap[fullname] = meta;
            } catch (e) {
              console.warn("repo meta fetch failed", fullname, e);
            }
          })
        );

        items.forEach((pr) => {
          const li = document.createElement("li");
          li.className = "pr-card"; // mark authored PR visually
          const isAuth = pr.user === user.login || pr.reason === "author";
          const reasonLabel =
            pr.reason === "review_requested" ? "Review" : pr.reason;
          const meta = repoMetaMap[pr.repo_full_name] || {};

          li.innerHTML = `
            <div class="pr-repo">
              <div class="name">${pr.repo_full_name}</div>
              <div class="meta-right">${meta.language || ""} ${
            meta.stars ? `· ★ ${meta.stars}` : ""
          }</div>
            </div>
            <div class="pr-title">
              <span class="reason-badge">${reasonLabel}</span>
              ${pr.title}
              ${
                pr.isNew
                  ? `<span class="new-badge" title="새 알림 또는 최근 7일 내 변경">NEW</span>`
                  : ""
              }
              ${isAuth ? `<span class="new-badge">MY PR</span>` : ""}
              ${pr.__pinned ? `<span class="pr-pin-badge">PINNED</span>` : ""}
            </div>
            <div class="pr-desc">${
              meta.description ? escapeHtml(meta.description) : ""
            }</div>
            <div class="meta">
              ${pr.user ? `by ${pr.user}` : ""}
              ${pr.number ? ` · #${pr.number}` : ""}
              ${
                pr.updated_at
                  ? ` · ${new Date(pr.updated_at).toLocaleString()}`
                  : ""
              }
            </div>
            <div class="pr-actions">
              <button class="pin-btn">${pr.__pinned ? "UNPIN" : "PIN"}</button>
              <button class="snooze-btn">SNOOZE</button>
            </div>
          `;

          // Card click: open and mark seen/read (but pin/snooze buttons have separate handlers)
          li.onclick = async (ev) => {
            // ignore clicks coming from action buttons
            if (
              ev.target &&
              (ev.target.classList.contains("pin-btn") ||
                ev.target.classList.contains("snooze-btn"))
            )
              return;
            try {
              if (pr.thread_id) {
                await markAsRead(token, pr.thread_id);
              }

              const webUrl = pr.html_url || prApiUrlToWeb(pr.subject_url);
              if (webUrl) {
                chrome.tabs.create({ url: webUrl });
              }

              li.remove();
              const countElInner = document.getElementById("headerCount");
              if (countElInner)
                countElInner.innerText = `Unread ${listEl.children.length}`;

              // Persist as seen so NEW badge won't reappear
              try {
                const key =
                  webUrl ||
                  pr.subject_url ||
                  `${pr.repo_full_name}#${pr.number}`;
                chrome.storage.local.get(["seenPRs"], (res) => {
                  const arr = res.seenPRs || [];
                  if (!arr.includes(key)) {
                    arr.push(key);
                    chrome.storage.local.set({ seenPRs: arr });
                  }
                });
              } catch (e) {
                console.warn("Failed to persist seenPRs", e);
              }
            } catch (e) {
              console.warn("Failed to mark as read", e);
              // still open PR page for authored items
              const webUrl = pr.html_url || prApiUrlToWeb(pr.subject_url);
              if (webUrl) chrome.tabs.create({ url: webUrl });
            }
          };

          // Pin button handler
          const pinBtn = li.querySelector(".pin-btn");
          if (pinBtn) {
            pinBtn.onclick = (ev) => {
              ev.stopPropagation();
              const key = prKey(pr);
              chrome.storage.local.get(["pinnedPRs"], (s) => {
                const arr = s.pinnedPRs || [];
                const idx = arr.indexOf(key);
                if (idx === -1) {
                  arr.push(key);
                } else {
                  arr.splice(idx, 1);
                }
                chrome.storage.local.set({ pinnedPRs: arr }, () => {
                  // refresh view
                  page = 1;
                  loadPage(false).catch((e) => console.warn(e));
                });
              });
            };
          }

          // Snooze button handler
          const snoozeBtn = li.querySelector(".snooze-btn");
          if (snoozeBtn) {
            snoozeBtn.onclick = (ev) => {
              ev.stopPropagation();
              const choice = prompt(
                "Snooze duration: 1h,8h,1d,7d (default 1h)"
              );
              const c = (choice || "1h").trim();
              let ms = 60 * 60 * 1000; // 1h
              if (c === "8h") ms = 8 * 60 * 60 * 1000;
              else if (c === "1d") ms = 24 * 60 * 60 * 1000;
              else if (c === "7d") ms = 7 * 24 * 60 * 60 * 1000;
              const key = prKey(pr);
              chrome.storage.local.get(["snoozedPRs"], (s) => {
                const map = s.snoozedPRs || {};
                map[key] = {
                  until: Date.now() + ms,
                  title: pr.title,
                  url: pr.html_url || prApiUrlToWeb(pr.subject_url),
                };
                chrome.storage.local.set({ snoozedPRs: map }, () => {
                  // remove card from view
                  li.remove();
                  try {
                    chrome.runtime.sendMessage({ type: "updateBadge" });
                  } catch (e) {}
                });
              });
            };
          }

          listEl.appendChild(li);
        });

        // helper: escape HTML
        function escapeHtml(s) {
          if (!s) return "";
          return s.replace(
            /[&<>\"]/g,
            (c) =>
              ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
          );
        }

        // helper: get repo metadata with caching
        async function getRepoMeta(token, fullName) {
          if (!fullName) return null;
          const key = `repoMeta:${fullName}`;
          const cache = await new Promise((r) =>
            chrome.storage.local.get([key], (res) => r(res[key] || null))
          );
          const now = Date.now();
          if (
            cache &&
            cache.fetchedAt &&
            now - cache.fetchedAt < 1000 * 60 * 60 * 24
          ) {
            return cache.meta;
          }
          try {
            const res = await fetch(
              `https://api.github.com/repos/${fullName}`,
              {
                headers: {
                  Authorization: `token ${token}`,
                  Accept: "application/vnd.github+json",
                },
              }
            );
            if (!res.ok) return null;
            const j = await res.json();
            const meta = {
              description: j.description,
              language: j.language,
              stars: j.stargazers_count,
            };
            chrome.storage.local.set({
              [key]: { meta, fetchedAt: Date.now() },
            });
            return meta;
          } catch (e) {
            return null;
          }
        }

        const countElFinal = document.getElementById("headerCount");
        if (countElFinal)
          countElFinal.innerText = `Unread ${listEl.children.length}`;
        statusEl.innerText = "";

        const loadMoreBtn = document.getElementById("loadMoreBtn");
        if (hasNext) {
          loadMoreBtn.style.display = "inline-block";
        } else {
          loadMoreBtn.style.display = "none";
        }
      } catch (e) {
        throw e;
      }
    }

    // initial load
    await loadPage(false);

    // load more handler
    document.getElementById("loadMoreBtn").onclick = async () => {
      page += 1;
      try {
        await loadPage(true);
      } catch (e) {
        page -= 1;
        console.error("Load more failed", e);
        statusEl.innerText = e.response
          ? `오류: ${e.response.status} ${e.response.statusText}\n${e.response.body}`
          : "추가 로드 실패";
      }
    };

    // Refresh controls
    const refreshBtn = document.getElementById("refreshBtn");
    const autoSelect = document.getElementById("autoRefresh");
    let autoTimer = null;

    refreshBtn.onclick = async () => {
      page = 1;
      await loadPage(false);
    };

    function setAutoRefresh(sec) {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
      if (!sec || sec === "off") return;
      const ms = Number(sec) * 1000;
      autoTimer = setInterval(async () => {
        page = 1;
        try {
          await loadPage(false);
        } catch (e) {
          console.error("Auto-refresh failed", e);
        }
      }, ms);
    }

    autoSelect.onchange = (e) => {
      setAutoRefresh(e.target.value);
    };

    // start with selected value
    setAutoRefresh(document.getElementById("autoRefresh").value);

    // Diagnostic helper (top-level so diag works even if main flow fails)
    async function runDiagnostics(token) {
      const out = {};
      // user
      const uRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${token}` },
      });
      out.user = { status: uRes.status, ok: uRes.ok };
      if (uRes.ok) out.user = Object.assign(out.user, await uRes.json());

      // notifications quick check
      const nRes = await fetch(
        "https://api.github.com/notifications?participating=true&per_page=5",
        { headers: { Authorization: `token ${token}` } }
      );
      out.notifications = { status: nRes.status, ok: nRes.ok };
      if (nRes.ok) {
        const list = await nRes.json();
        out.notifications.count = list.length;
        out.notifications.sample = list.slice(0, 3).map((x) => ({
          id: x.id,
          subject: x.subject && x.subject.title,
          reason: x.reason,
        }));
      } else {
        out.notifications.body = await nRes.text();
      }

      // authored PR quick check
      if (out.user && out.user.login) {
        try {
          const q = `is:pr is:open author:${out.user.login}`;
          const url = `https://api.github.com/search/issues?q=${encodeURIComponent(
            q
          )}&per_page=5`;
          const aRes = await fetch(url, {
            headers: { Authorization: `token ${token}` },
          });
          out.authored = { status: aRes.status, ok: aRes.ok };
          if (aRes.ok) {
            const aj = await aRes.json();
            out.authored.count = aj.total_count;
            out.authored.sample = (aj.items || [])
              .slice(0, 3)
              .map((it) => ({ title: it.title, url: it.html_url }));
          } else {
            out.authored.body = await aRes.text();
          }
        } catch (e) {
          out.authored = { status: 0, ok: false, error: e.message };
        }

        // GraphQL check as well (may provide wider coverage)
        try {
          const query = `query SearchPRs($q: String!, $first: Int!) { search(query: $q, type: ISSUE, first: $first) { nodes { ... on PullRequest { number title url repository { nameWithOwner } updatedAt author { login } } } } }`;
          const q = `is:pr is:open (review-requested:${out.user.login} OR assignee:${out.user.login} OR author:${out.user.login})`;
          const gRes = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
              Authorization: `bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query, variables: { q, first: 5 } }),
          });
          out.graphql = { status: gRes.status, ok: gRes.ok };
          if (gRes.ok) {
            const gj = await gRes.json();
            const nodes =
              gj.data && gj.data.search && gj.data.search.nodes
                ? gj.data.search.nodes
                : [];
            out.graphql.count = nodes.length;
            out.graphql.sample = nodes
              .slice(0, 3)
              .map((n) => ({ title: n.title, url: n.url }));
          } else {
            out.graphql.body = await gRes.text();
          }
        } catch (e) {
          out.graphql = { status: 0, ok: false, error: e.message };
        }
      }

      return out;
    }

    // Attach diag button handler early so it works regardless of main try/catch
    const diagBtnEl = document.getElementById("diagBtn");
    if (diagBtnEl) {
      diagBtnEl.onclick = () => {
        statusEl.innerText = "진단 중... 콘솔을 확인하세요";
        chrome.storage.sync.get(["githubToken"], async (res) => {
          const token = res.githubToken;
          if (!token) {
            statusEl.innerText =
              "토큰이 없습니다. Options에서 토큰 설정하세요.";
            return;
          }
          try {
            const diag = await runDiagnostics(token);
            console.info("Diagnostics:", diag);
            statusEl.innerText = `진단 결과: user=${
              diag.user.login || diag.user.status
            }, notifications_status=${
              diag.notifications.status
            }, notifications_count=${diag.notifications.count || 0}`;
          } catch (dErr) {
            console.error(dErr);
            statusEl.innerText = `진단 실패: ${dErr.message}`;
          }
        });
      };
    }
    // --- Snooze management UI ---
    const manageSnoozesBtnEl = document.getElementById("manageSnoozesBtn");
    const snoozePanelEl = document.getElementById("snoozePanel");
    const snoozeListEl = document.getElementById("snoozeList");
    const closeSnoozePanelBtn = document.getElementById("closeSnoozePanel");
    const unsnoozeAllBtn = document.getElementById("unsnoozeAllBtn");
    const snoozeSearchEl = document.getElementById("snoozeSearch");
    const snoozeSortEl = document.getElementById("snoozeSort");

    function formatRemaining(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h`;
      const d = Math.floor(h / 24);
      return `${d}d`;
    }

    let _snoozeTimerId = null;
    async function renderSnoozes() {
      if (!snoozeListEl) return;
      snoozeListEl.innerHTML = "";
      const s = await new Promise((r) =>
        chrome.storage.local.get(["snoozedPRs"], (v) => r(v || {}))
      );
      const map = s.snoozedPRs || {};
      // apply search filter and sort
      const searchVal = ((snoozeSearchEl && snoozeSearchEl.value) || "")
        .toLowerCase()
        .trim();
      const sortVal = (snoozeSortEl && snoozeSortEl.value) || "soonest";
      let keys = Object.keys(map).filter((k) => {
        if (!searchVal) return true;
        const entry = map[k] || {};
        const title = (entry.title || "").toLowerCase();
        const keystr = (k || "").toLowerCase();
        return title.includes(searchVal) || keystr.includes(searchVal);
      });
      keys.sort((a, b) => {
        const ea = map[a] || {};
        const eb = map[b] || {};
        if (sortVal === "soonest") return (ea.until || 0) - (eb.until || 0);
        if (sortVal === "latest") return (eb.until || 0) - (ea.until || 0);
        // title
        const ta = (ea.title || "").toLowerCase();
        const tb = (eb.title || "").toLowerCase();
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      if (keys.length === 0) {
        snoozeListEl.innerHTML = `<div class="empty">스누즈된 항목이 없습니다.</div>`;
        return;
      }
      const now = Date.now();
      for (const key of keys) {
        const entry = map[key];
        const rem = entry.until ? entry.until - now : 0;
        const item = document.createElement("div");
        item.className = "snooze-item";
        item.style =
          "padding:6px;border-bottom:1px solid var(--control-border);display:flex;align-items:center;gap:8px;";
        item.innerHTML = `
          <div style="flex:1">
            <div style="font-weight:600">${escapeHtml(entry.title || key)}</div>
            <div style="font-size:12px;color:var(--muted);">${escapeHtml(
              key
            )}</div>
            <div style="font-size:12px;color:var(--muted);">남은시간: <span class="snooze-remaining" data-key="${escapeHtml(
              key
            )}">${formatRemaining(rem)}</span></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="open-pr-btn">열기</button>
            <button class="unsnooze-btn">언스누즈</button>
          </div>
        `;
        const unsBtn = item.querySelector(".unsnooze-btn");
        const openBtn = item.querySelector(".open-pr-btn");
        unsBtn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          chrome.storage.local.get(["snoozedPRs"], (v) => {
            const m = v.snoozedPRs || {};
            delete m[key];
            chrome.storage.local.set({ snoozedPRs: m }, () => {
              renderSnoozes();
              try {
                chrome.runtime.sendMessage({ type: "updateBadge" });
              } catch (e) {}
            });
          });
        };
        openBtn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (entry && entry.url) chrome.tabs.create({ url: entry.url });
        };
        snoozeListEl.appendChild(item);
      }
    }

    function _updateSnoozeRemainingOnce() {
      chrome.storage.local.get(["snoozedPRs"], (v) => {
        const map = v.snoozedPRs || {};
        const now = Date.now();
        const els = document.querySelectorAll(".snooze-remaining");
        let needsRerender = false;
        els.forEach((span) => {
          const k = span.getAttribute("data-key");
          const e = map[k];
          if (!e) {
            span.textContent = "만료";
            needsRerender = true;
            return;
          }
          const rem = e.until ? e.until - now : 0;
          if (rem <= 0) {
            span.textContent = "만료";
            needsRerender = true;
          } else {
            span.textContent = formatRemaining(rem);
          }
        });
        if (needsRerender) {
          // slight delay to allow storage update events to settle
          setTimeout(() => renderSnoozes(), 300);
        }
      });
    }

    function startSnoozeTimer() {
      if (_snoozeTimerId) return;
      _snoozeTimerId = setInterval(_updateSnoozeRemainingOnce, 1000);
    }

    function stopSnoozeTimer() {
      if (_snoozeTimerId) {
        clearInterval(_snoozeTimerId);
        _snoozeTimerId = null;
      }
    }

    function openSnoozePanel() {
      if (snoozePanelEl) snoozePanelEl.style.display = "block";
      renderSnoozes();
      startSnoozeTimer();
    }
    function closeSnoozePanel() {
      if (snoozePanelEl) snoozePanelEl.style.display = "none";
      stopSnoozeTimer();
    }

    if (manageSnoozesBtnEl) {
      manageSnoozesBtnEl.onclick = (e) => {
        e.preventDefault();
        openSnoozePanel();
      };
    }
    if (closeSnoozePanelBtn)
      closeSnoozePanelBtn.onclick = () => closeSnoozePanel();
    if (unsnoozeAllBtn)
      unsnoozeAllBtn.onclick = () => {
        chrome.storage.local.set({ snoozedPRs: {} }, () => {
          renderSnoozes();
          try {
            chrome.runtime.sendMessage({ type: "updateBadge" });
          } catch (e) {}
        });
      };
    if (snoozeSearchEl) {
      snoozeSearchEl.oninput = () => renderSnoozes();
    }
    if (snoozeSortEl) {
      snoozeSortEl.onchange = () => renderSnoozes();
    }

    // keep panel in sync with storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.snoozedPRs) {
        if (snoozePanelEl && snoozePanelEl.style.display !== "none") {
          renderSnoozes();
        }
      }
    });

    // listen for background messages (e.g., snooze expired) to refresh PR list
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "reloadPRs") {
        try {
          page = 1;
          loadPage(false)
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        } catch (e) {
          sendResponse({ ok: false });
        }
        return true; // keep sendResponse channel open
      }
    });
  } catch (e) {
    console.error(e);
    if (e.response) {
      statusEl.innerText = `오류: ${e.response.status} ${e.response.statusText}\n${e.response.body}`;
    } else {
      statusEl.innerText = "PR 불러오기 실패";
    }
  }
});
