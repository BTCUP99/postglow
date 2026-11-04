import assert from "node:assert/strict";
import test from "node:test";
import { collect, emptyState, merge, normalizeStatus } from "../src/js/collect.js";
import { baselines, followerShares, median, quadrant, relativeReach, review } from "../src/js/review.js";

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-06-15T12:00:00Z");

function post(id, hoursAgo, views, extra = {}) {
  return {
    id: String(id), url: `https://x.com/demo/status/${id}`, postedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    kind: "original", format: "", text: "示例帖子", media: "",
    metrics: { views, likes: 2, reposts: 0, replies: 1, bookmarks: Math.round(views / 200), quotes: 0 }, checkpoints: {}, ...extra,
  };
}

function status(id, stamp, extra = {}) {
  return { id: String(id), created_timestamp: stamp, author: { screen_name: "demo" }, text: "hello", views: 100, likes: 3, bookmarks: 1, ...extra };
}

test("a status becomes a post only when it is the account's own", () => {
  assert.equal(normalizeStatus(status(1, 1_700_000_000, { author: { screen_name: "someone" } }), "demo"), null, "a repost of someone else");
  assert.equal(normalizeStatus(status("x", 1_700_000_000), "demo"), null);
  const reply = normalizeStatus(status(2, 1_700_000_000, { replying_to: "a" }), "demo");
  const quote = normalizeStatus(status(3, 1_700_000_000, { quote: { id: "9" }, media: { videos: [{}] } }), "Demo");
  assert.equal(reply.kind, "reply");
  assert.deepEqual([quote.kind, quote.media, quote.metrics.views, quote.url], ["quote", "videos", 100, "https://x.com/Demo/status/3"]);
});

test("counts only grow, and each checkpoint is frozen once, on time or late", () => {
  const state = emptyState("demo");
  merge(state, [{ ...post(1, 0.5, 100), checkpoints: undefined }], NOW);
  merge(state, [{ ...post(1, 0.5, 300) }], NOW + 1.2 * HOUR);
  merge(state, [{ ...post(1, 0.5, 50) }], NOW + 10 * HOUR);
  const stored = state.posts["1"];
  assert.equal(stored.metrics.views, 300, "a flaky lower read cannot erase reach");
  assert.deepEqual([stored.checkpoints["1h"].metrics.views, stored.checkpoints["1h"].onTime], [300, true]);
  assert.equal(stored.checkpoints["6h"].onTime, false, "read at 10.7 hours: too late to count as 6 hours");
});

test("the usual post is the median of settled posts, compared at the same age", () => {
  const posts = Array.from({ length: 10 }, (_, index) => post(index, 100 + index, 100 * (index + 1)));
  const base = baselines(posts, NOW);
  assert.equal(base.settled, median(posts.map((row) => row.metrics.views)));
  assert.deepEqual(relativeReach(posts[9], base, NOW), { ratio: Math.round((1000 / 550) * 100) / 100, basis: "settled" });
  assert.equal(relativeReach(post(99, 3, 10), base, NOW), null, "a young post with no on-time checkpoint is not compared");
  assert.equal(baselines(posts.slice(0, 5), NOW).settled, null, "too few posts make no usual");
});

test("reach × bookmarks splits on 1.5× the usual and the account's own bookmark rate", () => {
  const posts = [post(1, 100, 2000, { metrics: { views: 2000, bookmarks: 20 } }), post(2, 100, 2000, { metrics: { views: 2000, bookmarks: 0 } }),
    post(3, 100, 400, { metrics: { views: 400, bookmarks: 4 } }), post(4, 100, 400, { metrics: { views: 400, bookmarks: 0 } })];
  const result = quadrant(posts, 1000);
  assert.equal(result.savesLine, 5);
  assert.deepEqual(result.counts, { both: 1, reach: 1, saves: 1, neither: 1 });
});

test("followers gained in the window after a post are split among the posts in it", () => {
  const snapshots = [{ at: new Date(NOW - 50 * HOUR).toISOString(), followers: 100 }, { at: new Date(NOW - 2 * HOUR).toISOString(), followers: 130 }];
  const shares = followerShares([post(1, 40, 10), post(2, 30, 10), post(3, 1, 10)], snapshots);
  assert.deepEqual(Object.keys(shares).sort(), ["1", "2"]);
  assert.equal(shares["1"].share, 15);
});

test("the page model groups settled posts by hour, form and length, empty hours included", () => {
  const posts = Array.from({ length: 12 }, (_, index) => post(index, 80 + index * 20, 500 + index, index % 2 ? { media: "photos" } : {}));
  const model = review({ account: "demo", posts: Object.fromEntries(posts.map((row) => [row.id, row])), snapshots: [] }, NOW);
  assert.equal(model.timing.hourly.length, 24);
  assert.equal(model.timing.hourly.reduce((sum, row) => sum + row.posts, 0), 12);
  assert.deepEqual(model.forms.map((row) => row.id).sort(), ["picture", "text"]);
  assert.equal(model.posts.length, 12);
});

test("a read folds the profile and timeline in; a failure keeps what was there", async () => {
  const state = emptyState("demo");
  const pages = {
    "https://api.fxtwitter.com/demo": { code: 200, user: { name: "Demo", screen_name: "demo", followers: 42, following: 7, tweets: 99 } },
    "https://api.fxtwitter.com/2/profile/demo/statuses": { code: 200, results: [status(5, Math.floor(NOW / 1000) - 7200)], cursor: { bottom: "" } },
  };
  const ok = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(pages[url]) });
  const result = await collect(state, { now: () => NOW, fetchImpl: ok, force: true });
  assert.deepEqual([result.ok, result.backfill, result.posts, state.snapshots.at(-1).followers, state.profile.name], [true, true, 1, 42, "Demo"]);
  const failing = () => Promise.resolve({ ok: false, status: 503 });
  const again = await collect(state, { now: () => NOW + 2 * HOUR, fetchImpl: failing, force: true });
  assert.equal(again.ok, false);
  assert.equal(Object.keys(state.posts).length, 1);
  assert.match(state.collector.lastError, /503/);
});
