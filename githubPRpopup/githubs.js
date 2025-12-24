const API = "https://api.github.com";

async function githubFetch(path, token, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res.json();
}

export async function getUser(token) {
  return githubFetch("/user", token);
}

export async function getPRNotifications(token) {
  // ⭐ 핵심: participating=true
  const all = await githubFetch("/notifications?participating=true", token);

  return all.filter(
    (n) =>
      n.unread === true && n.subject?.type === "PullRequest" && n.subject?.url
  );
}

export async function markAsRead(token, threadId) {
  await githubFetch(`/notifications/threads/${threadId}`, token, {
    method: "PATCH",
  });
}

export function prApiUrlToWeb(url) {
  const m = url.match(/repos\/(.+?)\/(.+?)\/pulls\/(\d+)/);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
}
