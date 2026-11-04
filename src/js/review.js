/* Every number on the page, from the stored posts and profile snapshots. Model-free.

   Settled posts (72 hours or older) of the last four weeks are grouped by the hour and weekday they
   went out (local time), by form, by original or quote, and by length; each group's median views is
   compared with the account's usual post. Reach × bookmarks splits posts into four cells. How fast a
   post gets its views comes from checkpoints taken on time only.

   Where followers come from is an estimate, not a fact (X does not say who came from which post). Each
   read logs the follower count and, for posts under 72 hours old, their views at that same moment. Over
   the gaps between reads (up to 3 hours), follower change = natural drift per hour + followers per view
   × new views; a least-squares fit gives both. In each gap, the change beyond the drift is shared among
   the posts by the views each gained in it; the rest is "other sources" (older posts, profile, search,
   unfollows). Single posts count only above a few followers; groups follow the usual sample rules. */

import { CHECKPOINTS, METRICS } from "./collect.js";

export const DAYS = 28;
const HALF = 14;
const SETTLED_HOURS = 72;
const BASELINE_DAYS = 30;
export const MIN_BASELINE_SAMPLES = 8;
export const MIN_RELIABLE = 10;
export const HOURLY_RELIABLE = 5;
export const REACH_HIGH = 1.5;
const GROWTH_POINTS = ["1h", "6h", "24h"];
const ATTRIBUTION_HOURS = 72;
const MAX_GAP_HOURS = 3;
export const MIN_ATTRIBUTION_HOURS = 48;
export const MIN_POST_FOLLOWERS = 3;
export const TOPIC_KINDS = new Set(["original", "quote"]);
export const FORMS = { video: "视频", picture: "图片", article: "X 长文", text: "纯文字" };
export const KINDS = { original: "原创", quote: "引用" };
export const LENGTHS = { short: "140 字以内", medium: "141–400 字", long: "400 字以上" };
export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const views = (post) => count(post.metrics?.views);
const time = (post) => Date.parse(post.postedAt || "");

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const engagements = (metrics = {}) => METRICS.filter((name) => name !== "views").reduce((sum, name) => sum + count(metrics[name]), 0);

/* The usual views: settled posts, and each checkpoint taken on time. */
export function baselines(posts, nowMs) {
  const settled = [];
  const atAge = Object.fromEntries(CHECKPOINTS.map(([label]) => [label, []]));
  const oldest = nowMs - (BASELINE_DAYS + SETTLED_HOURS / 24) * DAY;
  for (const post of posts) {
    const posted = time(post);
    if (!TOPIC_KINDS.has(post.kind) || !Number.isFinite(posted) || posted < oldest) continue;
    if (nowMs - posted >= SETTLED_HOURS * HOUR) settled.push(views(post));
    for (const [label, row] of Object.entries(post.checkpoints || {})) {
      if (atAge[label] && row?.onTime) atAge[label].push(count(row.metrics?.views));
    }
  }
  return {
    settled: settled.length >= MIN_BASELINE_SAMPLES ? median(settled) : null,
    settledSamples: settled.length,
    checkpoints: Object.fromEntries(Object.entries(atAge).map(([label, values]) => [label, { median: values.length >= MIN_BASELINE_SAMPLES ? median(values) : null, samples: values.length }])),
  };
}

function latestCheckpoint(post) {
  for (const [label] of [...CHECKPOINTS].reverse()) {
    if (post.checkpoints?.[label]) return [label, post.checkpoints[label]];
  }
  return null;
}

/* Views against the usual post of the same age, or null while no fair comparison exists. */
export function relativeReach(post, base, nowMs) {
  const posted = time(post);
  if (!TOPIC_KINDS.has(post.kind) || !Number.isFinite(posted)) return null;
  let usual, seen, basis;
  if (nowMs - posted >= SETTLED_HOURS * HOUR) {
    usual = base.settled; seen = views(post); basis = "settled";
  } else {
    const latest = latestCheckpoint(post);
    if (!latest || !latest[1].onTime) return null;
    [basis] = latest;
    usual = base.checkpoints?.[basis]?.median;
    seen = count(latest[1].metrics?.views);
  }
  return usual ? { ratio: Math.round((seen / usual) * 100) / 100, basis } : null;
}

export function windowStats(posts, nowMs, fromDays, toDays) {
  const rows = posts.filter((post) => TOPIC_KINDS.has(post.kind) && nowMs - time(post) >= fromDays * DAY && nowMs - time(post) < toDays * DAY);
  const all = rows.map(views);
  const total = all.reduce((sum, value) => sum + value, 0);
  const engaged = rows.reduce((sum, post) => sum + engagements(post.metrics), 0);
  return { posts: rows.length, views: total, medianViews: median(all) || 0, engagementRate: total ? engaged / total : 0 };
}

export function form(post) {
  if (post.format === "article") return "article";
  return { videos: "video", photos: "picture" }[post.media] || "text";
}

export function length(post) {
  if (post.format === "long" || post.format === "article") return "long";
  const chars = String(post.text || "").replace(/\s/g, "").length;
  return chars <= 140 ? "short" : chars <= 400 ? "medium" : "long";
}

const local = (post) => new Date(time(post));
export const hourOfDay = (post) => String(local(post).getHours()).padStart(2, "0");
export const weekday = (post) => WEEKDAYS[(local(post).getDay() + 6) % 7];

function settledPosts(posts, nowMs) {
  return posts.filter((post) => {
    const age = nowMs - time(post);
    return TOPIC_KINDS.has(post.kind) && age >= SETTLED_HOURS * HOUR && age <= DAYS * DAY + SETTLED_HOURS * HOUR;
  });
}

/* One group: posts, median views and its ratio to the usual, bookmarks per thousand, the last two weeks
   against the two before, followers gained, and its posts (most read first). */
function row(members, shares, nowMs, baseline, reliableFrom = MIN_RELIABLE) {
  const all = members.map(views);
  const total = all.reduce((sum, value) => sum + value, 0);
  const bookmarks = members.reduce((sum, post) => sum + count(post.metrics?.bookmarks), 0);
  const split = nowMs - HALF * DAY - SETTLED_HOURS * HOUR;
  const recent = members.filter((post) => time(post) >= split).map(views);
  const earlier = members.filter((post) => time(post) < split).map(views);
  const middle = median(all);
  return {
    posts: members.length,
    reliable: members.length >= reliableFrom,
    medianViews: middle,
    ratio: baseline ? Math.round((middle / baseline) * 100) / 100 : null,
    bookmarksPerThousand: total ? Math.round((bookmarks * 10000) / total) / 10 : null,
    recent: { posts: recent.length, medianViews: median(recent) },
    earlier: { posts: earlier.length, medianViews: median(earlier) },
    ids: [...members].sort((a, b) => views(b) - views(a)).map((post) => post.id),
  };
}

function grouped(posts, key, names, shares, nowMs, baseline) {
  const groups = new Map();
  for (const post of posts) {
    const value = key(post);
    if (value) groups.set(value, [...(groups.get(value) || []), post]);
  }
  return [...groups].map(([id, members]) => ({ id, label: names[id] || id, ...row(members, shares, nowMs, baseline) }))
    .sort((a, b) => b.medianViews - a.medianViews || b.posts - a.posts);
}

/* Every slot in its natural order, empty ones included. */
function slots(posts, labels, key, shares, nowMs, baseline, reliableFrom) {
  const groups = new Map(labels.map((label) => [label, []]));
  for (const post of posts) groups.get(key(post))?.push(post);
  return [...groups].map(([id, members]) => ({ id, label: id, ...(members.length
    ? row(members, shares, nowMs, baseline, reliableFrom)
    : { posts: 0, reliable: false, medianViews: null, ratio: null, ids: [] }) }));
}

/* Views of a post at a read (unix seconds), from its series; 0 before it went out; null if not read then. */
function viewsAt(post, second) {
  const posted = time(post);
  if (second * 1000 <= posted) return 0;
  const minutes = (second * 1000 - posted) / 60000;
  const hit = (post.series || []).find(([at]) => Math.abs(at - minutes) <= 1.5);
  return hit ? hit[1] : null;
}

/* Which posts brought followers (see the note at the top). Returns null-free totals and per-post sums. */
export function followerAttribution(posts, log = []) {
  const points = (log || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isInteger(p[1])).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  for (let i = 1; i < points.length; i += 1) {
    const [t0, f0] = points[i - 1], [t1, f1] = points[i];
    const hours = (t1 - t0) / 3600;
    if (hours <= 0 || hours > MAX_GAP_HOURS) continue;
    const parts = [];
    for (const post of posts) {
      const posted = time(post);
      if (!Number.isFinite(posted) || posted >= t1 * 1000 || t0 * 1000 >= posted + ATTRIBUTION_HOURS * HOUR) continue;
      const before = viewsAt(post, t0), after = viewsAt(post, t1);
      if (before === null || after === null) continue;
      if (after > before) parts.push([post.id, after - before]);
    }
    gaps.push({ hours, change: f1 - f0, views: parts.reduce((sum, [, v]) => sum + v, 0), parts });
  }
  const hours = gaps.reduce((sum, gap) => sum + gap.hours, 0);
  const net = gaps.reduce((sum, gap) => sum + gap.change, 0);
  const result = { ready: false, hours: Math.round(hours), net, fromPosts: 0, other: net, drift: 0, perThousandViews: null, byPost: {} };
  if (hours < MIN_ATTRIBUTION_HOURS) return result;
  // Least squares, no intercept: change = drift × hours + rate × views.
  let hh = 0, hv = 0, vv = 0, hc = 0, vc = 0;
  for (const g of gaps) { hh += g.hours ** 2; hv += g.hours * g.views; vv += g.views ** 2; hc += g.hours * g.change; vc += g.views * g.change; }
  const det = hh * vv - hv * hv;
  const drift = det > 0 ? (vv * hc - hv * vc) / det : hc / hh;
  const rate = det > 0 ? (hh * vc - hv * hc) / det : 0;
  for (const g of gaps) {
    if (!g.views) continue;
    const excess = g.change - drift * g.hours;
    for (const [id, v] of g.parts) {
      const entry = (result.byPost[id] ||= { followers: 0, views: 0 });
      entry.followers += excess * v / g.views;
      entry.views += v;
    }
  }
  result.ready = true;
  result.drift = drift;
  result.perThousandViews = rate * 1000;
  result.fromPosts = Object.values(result.byPost).reduce((sum, entry) => sum + entry.followers, 0);
  result.other = net - result.fromPosts;
  return result;
}

/* Followers per thousand views for a group of posts, from their attributed sums. */
function conversion(members, byPost, reliableFrom = MIN_RELIABLE) {
  const known = members.filter((post) => byPost[post.id]);
  const followers = known.reduce((sum, post) => sum + byPost[post.id].followers, 0);
  const seen = known.reduce((sum, post) => sum + byPost[post.id].views, 0);
  return { posts: known.length, followers, views: seen, perThousand: seen ? (followers * 1000) / seen : null, reliable: known.length >= reliableFrom };
}

function brief(post, baseline) {
  const seen = views(post);
  return { id: post.id, views: seen, ratio: baseline ? Math.round((seen / baseline) * 100) / 100 : null,
    bookmarksPerThousand: seen ? Math.round((count(post.metrics?.bookmarks) * 10000) / seen) / 10 : 0,
    topic: String(post.text || "").replace(/\s+/g, " ").slice(0, 40), postedAt: post.postedAt, form: form(post) };
}

export function quadrant(posts, baseline) {
  const total = posts.reduce((sum, post) => sum + views(post), 0);
  const rate = total ? Math.round((posts.reduce((sum, post) => sum + count(post.metrics?.bookmarks), 0) * 10000) / total) / 10 : null;
  const points = baseline && rate !== null ? posts.map((post) => brief(post, baseline)) : [];
  const cells = { both: [], reach: [], saves: [], neither: [] };
  for (const point of points) {
    const highReach = point.ratio >= REACH_HIGH;
    const highSaves = rate > 0 && point.bookmarksPerThousand >= rate;
    point.cell = highReach && highSaves ? "both" : highReach ? "reach" : highSaves ? "saves" : "neither";
    cells[point.cell].push(point);
  }
  return { reachLine: REACH_HIGH, savesLine: rate, points, counts: Object.fromEntries(Object.entries(cells).map(([key, rows]) => [key, rows.length])),
    both: [...cells.both].sort((a, b) => b.views - a.views).slice(0, 8) };
}

function ranks(values) {
  const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
  const result = new Array(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[start]]) end += 1;
    for (let position = start; position <= end; position += 1) result[order[position]] = (start + end) / 2;
    start = end + 1;
  }
  return result;
}

export function rankCorrelation(first, second) {
  if (first.length < MIN_BASELINE_SAMPLES) return null;
  const a = ranks(first), b = ranks(second);
  const meanA = a.reduce((s, x) => s + x, 0) / a.length, meanB = b.reduce((s, x) => s + x, 0) / b.length;
  const cov = a.reduce((s, x, i) => s + (x - meanA) * (b[i] - meanB), 0);
  const spread = Math.sqrt(a.reduce((s, x) => s + (x - meanA) ** 2, 0) * b.reduce((s, y) => s + (y - meanB) ** 2, 0));
  return spread ? Math.round((cov / spread) * 100) / 100 : null;
}

/* Share of the 72-hour views reached at 1, 6 and 24 hours, from posts whose four checkpoints were on time. */
export function growth(posts) {
  const rows = [];
  for (const post of posts) {
    const marks = [...GROWTH_POINTS, "72h"].map((label) => post.checkpoints?.[label]);
    if (marks.every((mark) => mark?.onTime)) {
      const seen = marks.map((mark) => count(mark.metrics?.views));
      if (seen.at(-1) > 0) rows.push(seen);
    }
  }
  return { posts: rows.length, points: GROWTH_POINTS.map((label, index) => {
    const shares = rows.map((seen) => Math.min(1, seen[index] / seen.at(-1))).sort((a, b) => a - b);
    const enough = shares.length >= MIN_BASELINE_SAMPLES;
    return { label, median: enough ? Math.round(median(shares) * 100) / 100 : null,
      low: enough ? Math.round(shares[Math.floor(shares.length / 4)] * 100) / 100 : null,
      high: enough ? Math.round(shares[Math.floor((shares.length * 3) / 4)] * 100) / 100 : null,
      rankCorrelation: rankCorrelation(rows.map((seen) => seen[index]), rows.map((seen) => seen.at(-1))) };
  }) };
}

function weekLine(posts, nowMs, baseline) {
  const week = (offset) => posts.filter((post) => TOPIC_KINDS.has(post.kind) && nowMs - time(post) >= offset * 7 * DAY && nowMs - time(post) < (offset + 1) * 7 * DAY);
  const thisWeek = week(0), lastWeek = week(1);
  if (!thisWeek.length) return "这周还没有发帖。";
  const forms = {};
  for (const post of thisWeek) forms[form(post)] = (forms[form(post)] || 0) + 1;
  const [top] = Object.entries(forms).sort((a, b) => b[1] - a[1]);
  return `这周发了 ${thisWeek.length} 条（上周 ${lastWeek.length} 条），${FORMS[top[0]]}最多（${top[1]} 条）`
    + (baseline ? `；满 72 小时的帖子中位 ${Math.round(baseline).toLocaleString("zh-CN")} 阅读。` : "。");
}

/* The whole page's model. */
/* The page's view of the attribution: totals, the posts above the noise floor, and groups by form, kind and length. */
function followerModel(posts, attribution, baseline) {
  const { byPost } = attribution;
  const overall = conversion(posts, byPost, 1);
  const groups = (key, names) => Object.entries(names).map(([id, label]) => ({ id, label, ...conversion(posts.filter((post) => key(post) === id), byPost) }))
    .filter((entry) => entry.posts > 0);
  return {
    ...attribution, byPost: undefined, overallPerThousand: overall.perThousand, minPostFollowers: MIN_POST_FOLLOWERS, minHours: MIN_ATTRIBUTION_HOURS,
    posts: posts.filter((post) => byPost[post.id]?.followers >= MIN_POST_FOLLOWERS)
      .map((post) => ({ ...brief(post, baseline), followers: byPost[post.id].followers, windowViews: byPost[post.id].views,
        perThousand: byPost[post.id].views ? (byPost[post.id].followers * 1000) / byPost[post.id].views : null }))
      .sort((a, b) => b.followers - a.followers).slice(0, 5),
    groups: { forms: groups(form, FORMS), kinds: groups((post) => post.kind, KINDS), lengths: groups(length, LENGTHS) },
  };
}

export function review(state, nowMs = Date.now()) {
  const posts = Object.values(state.posts || {}).sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
  const base = baselines(posts, nowMs);
  const baseline = base.settled;
  const settled = settledPosts(posts, nowMs);
  const shares = {};
  const topical = posts.filter((post) => TOPIC_KINDS.has(post.kind));
  const attribution = followerAttribution(topical, state.followerLog);
  const rows = posts.map((post) => ({ ...post, reach: relativeReach(post, base, nowMs),
    engagementRate: views(post) ? engagements(post.metrics) / views(post) : 0, ageHours: (nowMs - time(post)) / HOUR }));
  return {
    account: state.account, profile: state.profile, snapshots: state.snapshots || [], collector: state.collector || {},
    days: DAYS, baseline: base, baselineViews: baseline, settledPosts: settled.length,
    week: { now: windowStats(posts, nowMs, 0, 7), before: windowStats(posts, nowMs, 7, 14), month: windowStats(posts, nowMs, 0, 30) },
    weekLine: weekLine(posts, nowMs, baseline),
    timing: {
      hourlyReliable: HOURLY_RELIABLE, minReliable: MIN_RELIABLE,
      hourly: slots(settled, Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")), hourOfDay, shares, nowMs, baseline, HOURLY_RELIABLE),
      weekdays: slots(settled, WEEKDAYS, weekday, shares, nowMs, baseline, MIN_RELIABLE),
    },
    forms: grouped(settled, form, FORMS, shares, nowMs, baseline),
    kinds: grouped(settled, (post) => post.kind, KINDS, shares, nowMs, baseline),
    lengths: slots(settled, Object.keys(LENGTHS), length, shares, nowMs, baseline, MIN_RELIABLE).map((entry) => ({ ...entry, label: LENGTHS[entry.id] })),
    quadrant: quadrant(settled, baseline),
    growth: growth(settled),
    followers: followerModel(topical, attribution, baseline),
    posts: rows,
  };
}
