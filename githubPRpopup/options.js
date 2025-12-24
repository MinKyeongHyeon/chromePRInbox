const input = document.getElementById("token");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status") || null;

chrome.storage.sync.get(["githubToken"], (res) => {
  if (res.githubToken) input.value = res.githubToken;
});

async function validateToken(token) {
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}` },
  });
  if (!userRes.ok) throw new Error("Invalid token or unable to fetch user");
  const user = await userRes.json();

  const notifRes = await fetch(
    "https://api.github.com/notifications?per_page=1",
    {
      headers: { Authorization: `token ${token}` },
    }
  );
  if (notifRes.status === 401)
    throw new Error("Unauthorized: token invalid or expired");
  if (notifRes.status === 403)
    throw new Error("Forbidden: token missing notifications scope");

  return user;
}

saveBtn.onclick = async () => {
  const token = input.value.trim();
  if (!token) {
    if (statusEl) {
      statusEl.textContent = "토큰을 입력하세요";
      input.focus();
      return;
    }
    return;
  }

  saveBtn.disabled = true;
  if (statusEl) {
    statusEl.textContent = "토큰 검증 중...";
  }
  try {
    const user = await validateToken(token);
    chrome.storage.sync.set({ githubToken: token }, () => {
      if (statusEl) statusEl.textContent = `저장 완료 · ${user.login}`;
      saveBtn.disabled = false;
    });
  } catch (e) {
    saveBtn.disabled = false;
    if (statusEl) statusEl.textContent = `토큰 검증 실패: ${e.message}`;
    else console.warn(`토큰 검증 실패: ${e.message}`);
  }
};
