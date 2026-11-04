/* Reading one account from FxTwitter (open source, no login, no key) and keeping its posts.

   An hourly read of the newest timeline pages keeps each post's latest counts and, as a post crosses
   1h, 6h, 24h and 72h of age, freezes a checkpoint of its counts at that age, so posts of different
   ages are compared only at the same age. The first read walks back about a month once. Counts only
   grow, so a flaky read can never erase reach. A daily snapshot of the profile keeps follower growth.
   Nothing here logs in or writes to X. */

export const TIMELINE_URL = "https://api.fxtwitter.com/2/profile/{account}/statuses";
export const PROFILE_URL = "https://api.fxtwitter.com/{account}";
export const POLL_MS = 60 * 60 * 1000;
export const RETRY_MS = 15 * 60 * 1000;
export const KEEP_DAYS = 180;
export const MAX_POSTS = 3000;
export const TEXT_LIMIT = 600;
const ROUTINE_HORIZON_HOURS = 80;
const ROUTINE_MAX_PAGES = 5;
const BACKFILL_HORIZON_DAYS = 35;
const BACKFILL_MAX_PAGES = 30;
const PAGE_PAUSE_MS = 1000;
const SNAPSHOT_DAYS = 400;
// [label, age in hours, how late a reading may be and still count as that age]
export const CHECKPOINTS = [["1h", 1, 1], ["6h", 6, 2], ["24h", 24, 4], ["72h", 72, 8]];
export const METRICS = ["views", "likes", "reposts", "replies", "bookmarks", "quotes"];
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

export function emptyState(account = "") {
  return { schema: "postglow.state.v1", account, collector: {}, posts: {}, snapshots: [], profile: null };
}

/* One FxTwitter status as a stored post, or null for others' posts (reposts) and bad rows. */
export function normalizeStatus(raw, account) {
  const author = raw?.author || {};
  const id = String(raw?.id || "");
  const stamp = raw?.created_timestamp;
  if (!/^\d+$/.test(id) || String(author.screen_name || "").toLowerCase() !== String(account).toLowerCase()) return null;
  if (!Number.isInteger(stamp) || stamp <= 0) return null;
  const kind = raw.replying_to ? "reply" : raw.quote ? "quote" : "original";
  const media = raw.media || {};
  const article = raw.article || null;
  // An X Article's post text is only its link; its title and preview say what it is about.
  const text = article ? `${article.title || ""}\n${article.preview_text || ""}`.trim() : String(raw.text || "");
  return {
    id,
    url: `https://x.com/${account}/status/${id}`,
    postedAt: iso(stamp * 1000),
    kind,
    format: article ? "article" : raw.is_note_tweet ? "long" : "",
    text: text.slice(0, TEXT_LIMIT),
    media: media.videos?.length ? "videos" : media.photos?.length ? "photos" : "",
    metrics: Object.fromEntries(METRICS.map((name) => [name, count(raw[name])])),
  };
}

async function getJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("连不上 FxTwitter，请检查网络");
  }
  if (!response.ok) throw new Error(response.status === 404 ? "找不到这个账号" : `FxTwitter 返回 HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error("FxTwitter 没有返回有效数据");
  }
}

/* Pages newest first until one reaches `horizonMs`; returns the posts and the pages read. */
export async function fetchTimeline({ account, horizonMs, maxPages, fetchImpl = fetch, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = TIMELINE_URL.replace("{account}", encodeURIComponent(account));
  let cursor = "";
  const posts = [];
  let pages = 0;
  while (pages < maxPages) {
    if (pages) await pause(PAGE_PAUSE_MS);
    const payload = await getJson(cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base, fetchImpl);
    if (payload?.code !== 200 || !Array.isArray(payload.results)) throw new Error("FxTwitter 没有返回时间线");
    pages += 1;
    const rows = payload.results.filter((row) => row && typeof row === "object");
    for (const row of rows) {
      const post = normalizeStatus(row, account);
      if (post) posts.push(post);
    }
    const stamps = rows.map((row) => row.created_timestamp).filter(Number.isInteger);
    cursor = String(payload.cursor?.bottom || "");
    if (!rows.length || !cursor || (stamps.length && Math.min(...stamps) * 1000 < horizonMs)) break;
  }
  return { posts, pages };
}

export async function fetchProfile(account, fetchImpl = fetch) {
  const payload = await getJson(PROFILE_URL.replace("{account}", encodeURIComponent(account)), fetchImpl);
  const user = payload?.user;
  if (payload?.code !== 200 || !user) throw new Error("找不到这个账号");
  return {
    name: String(user.name || ""), handle: String(user.screen_name || account), avatar: String(user.avatar_url || "").replace("_normal.", "_200x200."),
    followers: count(user.followers), following: count(user.following), posts: count(user.tweets),
  };
}

function recordCheckpoints(post, nowMs) {
  const posted = Date.parse(post.postedAt);
  if (!Number.isFinite(posted)) return;
  const age = Math.max(0, (nowMs - posted) / HOUR);
  post.checkpoints ||= {};
  for (const [label, hours, late] of CHECKPOINTS) {
    if (post.checkpoints[label] || age < hours) continue;
    post.checkpoints[label] = { at: iso(nowMs), ageHours: Math.round(age * 100) / 100, onTime: age <= hours + late, metrics: { ...post.metrics } };
  }
}

/* Fold one read into the state; counts only grow. Returns how many posts were updated. */
export function merge(state, incoming, nowMs) {
  let changed = 0;
  for (const raw of incoming) {
    if (!raw?.id) continue;
    const previous = state.posts[raw.id];
    const post = { ...(previous || { firstSeenAt: iso(nowMs), checkpoints: {} }) };
    const old = post.metrics || {};
    for (const key of ["id", "url", "postedAt", "kind", "format", "text", "media"]) post[key] = raw[key] ?? "";
    post.metrics = Object.fromEntries(METRICS.map((name) => [name, Math.max(count(old[name]), count(raw.metrics?.[name]))]));
    post.observedAt = iso(nowMs);
    recordCheckpoints(post, nowMs);
    state.posts[raw.id] = post;
    changed += 1;
  }
  const cutoff = nowMs - KEEP_DAYS * DAY;
  const kept = Object.values(state.posts)
    .filter((post) => (Date.parse(post.postedAt) || nowMs) >= cutoff)
    .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)))
    .slice(0, MAX_POSTS);
  state.posts = Object.fromEntries(kept.map((post) => [post.id, post]));
  return changed;
}

/* One profile reading a day is kept (the latest of each local day). */
export function recordSnapshot(state, profile, nowMs) {
  const day = new Date(nowMs).toLocaleDateString("en-CA");
  const row = { at: iso(nowMs), day, followers: profile.followers, following: profile.following, posts: profile.posts };
  state.snapshots = (state.snapshots || []).filter((snapshot) => snapshot.day !== day);
  state.snapshots.push(row);
  state.snapshots.sort((a, b) => a.at.localeCompare(b.at));
  state.snapshots = state.snapshots.filter((snapshot) => Date.parse(snapshot.at) >= nowMs - SNAPSHOT_DAYS * DAY);
  state.profile = { ...profile, at: row.at };
}

export function due(state, nowMs) {
  const collector = state.collector || {};
  const attempted = Date.parse(collector.lastAttemptAt || "");
  if (!Number.isFinite(attempted)) return true;
  return nowMs - attempted >= (collector.lastOk ? POLL_MS : RETRY_MS);
}

/* Read the account if due (or forced) and fold it into `state` (changed in place). */
export async function collect(state, { now = () => Date.now(), force = false, fetchImpl = fetch, pause } = {}) {
  const started = now();
  if (!state.account) return { ok: false, skipped: true, error: "还没有设置账号" };
  if (!force && !due(state, started)) return { ok: true, skipped: true };
  const backfill = !state.collector?.backfilledAt;
  const horizonMs = started - (backfill ? BACKFILL_HORIZON_DAYS * DAY : ROUTINE_HORIZON_HOURS * HOUR);
  let error = "";
  let result = { posts: [], pages: 0 };
  let profile = null;
  try {
    profile = await fetchProfile(state.account, fetchImpl);
    result = await fetchTimeline({ account: profile.handle || state.account, horizonMs, maxPages: backfill ? BACKFILL_MAX_PAGES : ROUTINE_MAX_PAGES, fetchImpl, pause });
  } catch (exc) {
    error = exc?.message || "读取失败";
  }
  const finished = now();
  const changed = error ? 0 : merge(state, result.posts, finished);
  if (!error && profile) {
    state.account = profile.handle || state.account;
    recordSnapshot(state, profile, finished);
  }
  state.collector = { ...state.collector, lastAttemptAt: iso(finished), lastOk: !error, lastError: error, pagesRead: result.pages };
  if (!error) {
    state.collector.lastSuccessAt = iso(finished);
    if (backfill) state.collector.backfilledAt = iso(finished);
  }
  return { ok: !error, error, pages: result.pages, posts: changed, backfill };
}
