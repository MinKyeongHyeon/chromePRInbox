// Utility functions for PR Inbox tests

function computeBadgeCount(
  items,
  seenArr = [],
  snoozedMap = {},
  now = Date.now()
) {
  const seen = new Set((seenArr || []).filter(Boolean));
  let cnt = 0;
  for (const it of items || []) {
    const key =
      it.html_url || it.subject_url || `${it.repo_full_name}#${it.number}`;
    const sno = snoozedMap && snoozedMap[key];
    const snoUntil = sno && sno.until ? sno.until : 0;
    if (snoUntil && now < snoUntil) continue;
    if (!seen.has(key)) cnt++;
  }
  return cnt;
}

module.exports = { computeBadgeCount };
