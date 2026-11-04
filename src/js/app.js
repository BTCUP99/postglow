/* Postglow's page: welcome, the hourly read, and every card drawn from review.js's model. */
import { collect, due, emptyState } from "./collect.js";
import { FORMS, review } from "./review.js";
import { HELP_HTML, HINTS } from "./help.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DAY = 86400000;
const hint = (key) => `<button type="button" class="hint" data-help="${key}" aria-label="这是什么？">?</button>`;
const PAGE = 10;
const tauri = window.__TAURI__;
const view = { state: null, prefs: {}, accounts: [], model: null, sort: "recent", replies: false, filter: null, focusId: "", shown: PAGE, drill: null, busy: false };
const MAX_ACCOUNTS = 10;

/* ---------- storage: one file per account plus prefs.json through the native side (the browser's storage in a preview).
   Each account is loaded once and kept here, so the page and the background reads always change the same object. ---------- */
const key = (handle) => String(handle || "").toLowerCase();
const cache = new Map();
const local = {
  list: () => Object.keys(localStorage).filter((k) => k.startsWith("postglow-account:")).map((k) => k.slice(17)).sort(),
  get: (k) => localStorage.getItem(k) || "",
};
const store = {
  list: () => (tauri ? tauri.core.invoke("list_accounts") : Promise.resolve(local.list())),
  async load(handle) {
    if (cache.has(key(handle))) return cache.get(key(handle));
    let state = null;
    try {
      const text = tauri ? await tauri.core.invoke("load_account", { handle }) : local.get(`postglow-account:${key(handle)}`);
      state = text ? JSON.parse(text) : null;
    } catch {}
    if (state?.schema !== "postglow.state.v1") return null;
    cache.set(key(handle), state);
    return state;
  },
  async save(state) {
    cache.set(key(state.account), state);
    const json = JSON.stringify(state);
    if (tauri) await tauri.core.invoke("save_account", { handle: state.account, json });
    else localStorage.setItem(`postglow-account:${key(state.account)}`, json);
  },
  async remove(handle) {
    cache.delete(key(handle));
    if (tauri) await tauri.core.invoke("delete_account", { handle });
    else localStorage.removeItem(`postglow-account:${key(handle)}`);
  },
  async prefs() {
    try {
      const text = tauri ? await tauri.core.invoke("load_prefs") : local.get("postglow-prefs");
      return text ? JSON.parse(text) : {};
    } catch { return {}; }
  },
  savePrefs() {
    const json = JSON.stringify(view.prefs);
    return tauri ? tauri.core.invoke("save_prefs", { json }) : Promise.resolve(localStorage.setItem("postglow-prefs", json));
  },
};
const save = () => store.save(view.state);

function openPost(url) {
  if (!/^https:\/\/x\.com\//.test(url || "")) return;
  if (tauri) tauri.core.invoke("open_url", { url });
  else window.open(url, "_blank", "noopener");
}

/* ---------- formatting ---------- */
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("zh-CN") : "-");
function compact(value) {
  const n = Number(value) || 0;
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}
const times = (value) => (typeof value === "number" ? `${value.toFixed(1)}×` : "-");
const percent = (value) => (value > 0 ? `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%` : "-");
function when(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function ago(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  return minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`;
}
function delta(now, before, unit = "") {
  if (!before || !Number.isFinite(now)) return "";
  const change = (now - before) / before;
  const tone = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";
  return `<span class="delta ${tone}">${change >= 0 ? "↑" : "↓"} ${Math.abs(change * 100).toFixed(0)}%${unit}</span>`;
}
function spark(values, color = "var(--accent)") {
  const clean = values.map((value) => Number(value) || 0);
  if (clean.length < 2) return "";
  const w = 200, h = 30, min = Math.min(...clean), max = Math.max(...clean), span = max - min || 1;
  const pts = clean.map((value, index) => [index / (clean.length - 1) * w, h - 3 - (value - min) / span * (h - 6)]);
  const line = pts.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${line}L${w},${h}L0,${h}Z" fill="${color}" opacity=".12"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg>`;
}
function reachCopy(post) {
  if (post.kind === "reply") return { tone: "muted", text: "回复不计入对比" };
  if (!post.reach) return { tone: "muted", text: post.ageHours < 72 ? "数据积累中" : "样本不足" };
  const basis = post.reach.basis === "settled" ? "" : `（${post.reach.basis}）`;
  const ratio = post.reach.ratio;
  if (ratio >= 1.5) return { tone: "good", text: `高于平时 ${ratio.toFixed(1)}×${basis}` };
  if (ratio <= 0.6) return { tone: "bad", text: `低于平时 ${ratio.toFixed(1)}×${basis}` };
  return { tone: "neutral", text: `接近平时 ${ratio.toFixed(1)}×${basis}` };
}
const formOf = (post) => (post.format === "article" ? "article" : { videos: "video", photos: "picture" }[post.media] || "text");

/* ---------- looks ---------- */
function applyLook() {
  const chosen = view.prefs.look || "auto";
  const look = chosen === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "cloud") : chosen;
  document.documentElement.dataset.look = look;
  document.querySelectorAll("[data-look-option]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.lookOption === chosen)));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyLook);

/* ---------- tooltip ---------- */
const tip = $("tip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add("on");
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - w - 12, x + 16)}px`;
  tip.style.top = `${Math.max(12, Math.min(innerHeight - h - 12, y - h / 2))}px`;
}
const hideTip = () => tip.classList.remove("on");
function showHint(node) {
  const [title, body] = HINTS[node.dataset.help] || [];
  if (!title) return;
  const box = node.getBoundingClientRect();
  showTip(`<strong>${esc(title)}</strong><p>${esc(body)}</p>`, box.right, box.top + box.height / 2);
}
function openHelp() {
  hideTip();
  const dialog = $("help");
  if (!dialog.innerHTML) {
    dialog.innerHTML = HELP_HTML;
    tauri?.app?.getVersion().then((version) => { $("appVersion").textContent = `版本 ${version}`; }).catch(() => {});
  }
  syncAutostart();
  const choice = closeChoice() || "ask";
  dialog.querySelectorAll('[name="closeAction"]').forEach((input) => { input.checked = input.value === choice; });
  dialog.showModal();
}

/* ---------- start at login (a LaunchAgent that opens Postglow in the menu bar) ---------- */
async function syncAutostart() {
  const box = $("autostart");
  if (!box) return;
  if (!tauri) { box.disabled = true; return; }
  try { box.checked = await tauri.core.invoke("autostart_enabled"); } catch { box.disabled = true; }
}
async function setAutostart(enabled) {
  try { await tauri?.core.invoke("set_autostart", { enabled }); } catch {}
}

/* ---------- closing the window: stay in the menu bar or quit, asked the first time ---------- */
function closeChoice() {
  try { return localStorage.getItem("postglow-close"); } catch { return null; }
}
function rememberClose(choice) {
  try { choice === "ask" ? localStorage.removeItem("postglow-close") : localStorage.setItem("postglow-close", choice); } catch {}
}
function closeAs(choice) {
  tauri?.core.invoke(choice === "quit" ? "quit_app" : "hide_window");
}
tauri?.event?.listen("close-requested", () => {
  const choice = closeChoice();
  if (choice === "hide" || choice === "quit") { closeAs(choice); return; }
  hideTip();
  $("help").open && $("help").close();
  $("closeAsk").showModal();
});
document.addEventListener("change", (event) => {
  if (event.target.name === "closeAction") rememberClose(event.target.value);
  if (event.target.id === "autostart") setAutostart(event.target.checked);
});

/* ---------- updates: checked at launch and daily; installing replaces the app and restarts it ---------- */
const updates = { latest: "", dismissed: "", busy: false, hideTimer: 0 };
function showUpdate(html, autoHide = false) {
  const bar = $("update");
  clearTimeout(updates.hideTimer);
  bar.innerHTML = html;
  bar.hidden = false;
  if (autoHide) updates.hideTimer = setTimeout(() => { bar.hidden = true; }, 5000);
}
async function checkUpdate(manual) {
  if (!tauri || updates.busy) return;
  if (manual) showUpdate("正在检查更新…");
  try {
    const info = await tauri.core.invoke("check_update");
    if (info.latest) {
      updates.latest = info.latest;
      if (manual || updates.dismissed !== info.latest) {
        showUpdate(`<span><b>Postglow ${esc(info.latest)}</b> 可以更新了 <small>当前 ${esc(info.current)}</small></span>
          <button type="button" class="btn primary" data-update-install>立即更新</button><button type="button" class="btn" data-update-later>稍后</button>`);
      }
    } else if (manual) {
      showUpdate(`已经是最新版本（${esc(info.current)}）`, true);
    }
  } catch (error) {
    if (manual) showUpdate(`检查更新失败：${esc(error)}，稍后再试。`, true);
  }
}
async function installUpdate() {
  if (updates.busy) return;
  updates.busy = true;
  showUpdate(`正在下载 ${esc(updates.latest)}，完成后 Postglow 会自动重新打开…`);
  try {
    await tauri.core.invoke("install_update");
  } catch (error) {
    updates.busy = false;
    showUpdate(`更新失败：${esc(error)} <button type="button" class="btn" data-update-install>重试</button><button type="button" class="btn" data-update-later>关闭</button>`);
  }
}
tauri?.event?.listen("check-update", () => checkUpdate(true));

function postTip(post) {
  const reach = reachCopy(post);
  const figures = [["阅读", "views"], ["收藏", "bookmarks"], ["赞", "likes"], ["转发", "reposts"]]
    .map(([name, key]) => `<div><dt>${name}</dt><dd>${number(post.metrics?.[key])}</dd></div>`).join("");
  return `<strong>${esc(when(post.postedAt))} · ${esc(FORMS[formOf(post)])}</strong><p>${esc(String(post.text || "").replace(/\s+/g, " ").slice(0, 120))}</p>
    <dl>${figures}</dl><small class="is-${reach.tone}">${esc(reach.text)} · 点击跳到帖子列表，⌘+点击打开原帖</small>`;
}

/* ---------- groups: every row, column and bubble that names a set of posts ---------- */
const SOURCES = {
  hourly: ["小时", (m) => m.timing.hourly], weekdays: ["星期", (m) => m.timing.weekdays], forms: ["形式", (m) => m.forms],
  kinds: ["原创与引用", (m) => m.kinds], lengths: ["篇幅", (m) => m.lengths],
};
const groupRow = (source, id) => (SOURCES[source]?.[1](view.model) || []).find((row) => String(row.id) === id);
function groupTip(source, id) {
  const row = groupRow(source, id);
  if (!row) return "";
  const figures = [["帖子", `${row.posts} 条`], ["阅读中位", number(row.medianViews)], ["和平时比", times(row.ratio)], ["收藏‰", row.bookmarksPerThousand ?? "-"]]
    .map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join("");
  return `<strong>${SOURCES[source][0]} · ${esc(row.label)}</strong><dl>${figures}</dl>${row.reliable ? "" : '<p class="is-bad">帖子太少，不作结论</p>'}<small>点击看是哪些帖子</small>`;
}

function rankList(title, rows, source, { natural = false } = {}) {
  const shown = (rows || []).filter((row) => row.posts);
  if (!shown.length) return "";
  const enough = (row) => typeof row.ratio === "number" && row.reliable;
  const ordered = natural ? shown : [...shown].sort((a, b) => enough(b) - enough(a) || (b.ratio ?? -1) - (a.ratio ?? -1));
  const scaled = ordered.filter(enough);
  const max = Math.max(1.2, ...(scaled.length ? scaled : ordered).map((row) => row.ratio || 0));
  const items = ordered.map((row) => `<li class="${enough(row) ? "" : "thin"}"><button type="button" class="row" data-group="${source}|${esc(row.id)}" aria-expanded="false">
      <span class="name">${esc(row.label)}<small>${row.posts} 条 · 中位 ${number(row.medianViews)}</small></span>
      <span class="track"><i class="fill${row.ratio >= 1 ? "" : " below"}" style="--w:${Math.min(100, (row.ratio || 0) / max * 100).toFixed(1)}%"></i><i class="one" style="--one:${(1 / max * 100).toFixed(1)}%"></i></span>
      <b>${typeof row.ratio === "number" ? times(row.ratio) : "样本少"}</b></button></li>`).join("");
  return `<section class="rank" data-scope="${source}"><h4>${title}</h4><ol>${items}</ol></section>`;
}

function drillHtml(source, row) {
  const byId = new Map(view.model.posts.map((post) => [post.id, post]));
  const found = (row.ids || []).map((id) => byId.get(id)).filter(Boolean);
  const top = found.slice(0, 5).map((post) => `<li><button type="button" data-pick="${esc(post.id)}"><time>${esc(when(post.postedAt))}</time>
      <span>${esc(String(post.text || "").replace(/\s+/g, " ").slice(0, 48))}</span><b>${number(post.metrics.views)} 阅读</b></button></li>`).join("");
  return `<div class="drill"><header><b>${SOURCES[source][0]} · ${esc(row.label)}</b><span>${row.posts} 条，阅读中位 ${number(row.medianViews)}${typeof row.ratio === "number" ? `，是平时的 ${row.ratio.toFixed(1)} 倍` : ""}</span>
      <button type="button" data-drill-close aria-label="收起">×</button></header>${top ? `<ol>${top}</ol>` : ""}
    <footer><span>按阅读从高到低，点一条跳到帖子列表</span>${found.length ? `<button type="button" class="btn" data-drill-list>在帖子列表里只看这 ${found.length} 条 ↓</button>` : ""}</footer></div>`;
}

function renderDrill() {
  document.querySelectorAll(".drill").forEach((node) => node.remove());
  document.querySelectorAll("[data-group]").forEach((node) => node.setAttribute("aria-expanded", "false"));
  if (!view.drill) return;
  const { source, id, scope } = view.drill;
  const host = document.querySelector(`[data-scope="${scope}"]`);
  const button = host?.querySelector(`[data-group="${CSS.escape(`${source}|${id}`)}"]`);
  const row = groupRow(source, id);
  if (!host || !button || !row) { view.drill = null; return; }
  button.setAttribute("aria-expanded", "true");
  host.insertAdjacentHTML("beforeend", drillHtml(source, row));
}

/* ---------- cards ---------- */
function renderOverview(m) {
  const profile = m.profile || {};
  const week = m.week;
  const avatar = profile.avatar ? `<img src="${esc(profile.avatar)}" alt="" referrerpolicy="no-referrer">` : '<span class="avatar"></span>';
  $("hero").innerHTML = `<div class="who">${avatar}<div><b>${esc(profile.name || m.account)}</b><span>@${esc(profile.handle || m.account)}</span></div></div>
    <div><div class="eyebrow">本周 · 近 7 天 ${hint("week")}</div><div class="big" data-count="${week.now.views}">${compact(week.now.views)}<small>阅读</small></div>
    <div>${week.before.posts ? `${delta(week.now.views, week.before.views)}<span class="before">上周 ${compact(week.before.views)}</span>` : '<span class="before">上周还没有数据</span>'}</div></div>
    <p class="line">${esc(m.weekLine)}</p>`;
  const snaps = m.snapshots.slice(-30);
  const first = snaps[0], last = snaps.at(-1);
  const daily = (pick) => Array.from({ length: 14 }, (_, index) => {
    const day = new Date(Date.now() - (13 - index) * DAY).toDateString();
    return pick(m.posts.filter((post) => post.kind !== "reply" && new Date(post.postedAt).toDateString() === day));
  });
  const capsule = (label, value, change, sparkline = "", help = "") => `<div class="capsule"><span class="label">${label}${help ? ` ${hint(help)}` : ""}</span><span class="value">${value}</span>${change || ""}${sparkline}</div>`;
  $("capsules").innerHTML = [
    capsule("粉丝", number(profile.followers), snaps.length > 1 ? delta(last.followers, first.followers, ` · ${snaps.length} 天`) : "", spark(snaps.map((s) => s.followers))),
    capsule("关注", number(profile.following), "", spark(snaps.map((s) => s.following), "var(--s3)")),
    capsule("帖子总数", number(profile.posts), "", spark(snaps.map((s) => s.posts), "var(--s2)")),
    capsule("发帖（近 7 天）", number(week.now.posts), week.before.posts ? delta(week.now.posts, week.before.posts) : "", spark(daily((rows) => rows.length), "var(--s1)")),
    capsule("阅读中位数", number(week.now.medianViews), week.before.posts ? delta(week.now.medianViews, week.before.medianViews) : "", "", "median"),
    capsule("互动率", percent(week.now.engagementRate), week.before.posts ? delta(week.now.engagementRate, week.before.engagementRate) : "", "", "engagement"),
  ].join("") + `<p class="month">近 30 天：${number(week.month.posts)} 条 · 总阅读 ${number(week.month.views)} · 中位 ${number(week.month.medianViews)} · 互动率 ${percent(week.month.engagementRate)}</p>`;
  const best = (rows) => (rows || []).filter((row) => row.reliable && typeof row.ratio === "number" && row.ratio > 1).sort((a, b) => b.ratio - a.ratio)[0];
  const picks = [["hourly", best(m.timing.hourly), (row) => `${Number(row.id)} 点发`, (row) => `本地时间，${row.posts} 条`],
    ["forms", best(m.forms), (row) => row.label, (row) => `${row.posts} 条，形式里最好`],
    ["lengths", best(m.lengths), (row) => row.label, (row) => `${row.posts} 条，篇幅里最好`]].filter(([, row]) => row);
  $("insights").innerHTML = picks.map(([source, row, title, note]) => `<button type="button" class="bubble" data-group="${source}|${esc(row.id)}" aria-expanded="false">
      <span class="num">${row.ratio.toFixed(1)}×</span><span><b>${esc(title(row))}</b><span>${esc(note(row))}</span></span></button>`).join("");
  countUp(document.querySelector("#hero [data-count]"));
}

function countUp(node) {
  if (!node || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = Number(node.dataset.count) || 0;
  const unit = node.querySelector("small")?.outerHTML || "";
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, Math.max(0, (now - start) / 1000)); // a frame can be stamped just before `start`
    node.innerHTML = compact(target * (1 - (1 - progress) ** 3)) + unit;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const visible = (post) => !view.filter || (view.filter.ids ? view.filter.ids.has(post.id) : formOf(post) === view.filter.form);

function renderSwarm(m) {
  const host = $("swarm");
  const now = Date.now(), start = now - 30 * DAY;
  const posts = m.posts.filter((post) => post.kind !== "reply" && Date.parse(post.postedAt) >= start && post.metrics.views > 0);
  $("postsKey").textContent = posts.length ? `${posts.length} 条 · 悬停看是哪条，点击跳到帖子列表，⌘+点击打开原帖 · 颜色是形式` : "";
  if (!posts.length) { host.innerHTML = '<p class="empty">近 30 天还没有帖子数据，第一次读取完成后出现。</p>'; $("legend").innerHTML = ""; return; }
  const W = Math.max(640, host.clientWidth || 900), H = Math.round(Math.min(400, Math.max(300, W * 0.32))), L = 48, R = 12, T = 12, B = 28;
  const all = posts.map((post) => post.metrics.views);
  const low = Math.floor(Math.log10(Math.max(1, Math.min(...all)))), high = Math.ceil(Math.log10(Math.max(10, ...all)));
  const x = (iso) => L + (Date.parse(iso) - start) / (now - start) * (W - L - R);
  const y = (value) => T + (1 - (Math.log10(Math.max(1, value)) - low) / Math.max(1, high - low)) * (H - T - B);
  const ticks = [];
  for (let p = low; p <= high; p += 1) ticks.push(10 ** p);
  const grid = ticks.map((value) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(value)}" y2="${y(value)}"/><text class="axis" x="${L - 6}" y="${y(value) + 3}" text-anchor="end">${compact(value)}</text>`).join("");
  const days = [30, 20, 10, 0].map((back) => { const at = now - back * DAY, d = new Date(at); return `<text class="axis" x="${x(new Date(at).toISOString())}" y="${H - 8}" text-anchor="${back ? "middle" : "end"}">${back ? `${d.getMonth() + 1}/${d.getDate()}` : "今天"}</text>`; }).join("");
  const base = m.baselineViews ? `<line class="base" x1="${L}" x2="${W - R}" y1="${y(m.baselineViews)}" y2="${y(m.baselineViews)}"/>` : "";
  // The 平时 label goes over the dots, with a halo in the card's colour so it stays readable.
  const baseLabel = m.baselineViews ? `<text class="axis halo" x="${W - R - 4}" y="${y(m.baselineViews) - 5}" text-anchor="end">平时 ${number(m.baselineViews)}</text>` : "";
  const maxB = Math.max(1, ...posts.map((post) => post.metrics.bookmarks));
  const dots = [...posts].sort((a, b) => b.metrics.bookmarks - a.metrics.bookmarks).map((post, index) => `<circle class="dot f-${formOf(post)}${visible(post) ? "" : " dim"}${post.id === view.focusId ? " focus" : ""}" style="--pop:${Math.min(index * 4, 600)}ms"
      cx="${x(post.postedAt).toFixed(1)}" cy="${y(post.metrics.views).toFixed(1)}" r="${(3.5 + Math.sqrt(post.metrics.bookmarks / maxB) * 18).toFixed(1)}" data-post="${esc(post.id)}" tabindex="0" role="button" aria-label="${esc(`${when(post.postedAt)} · ${number(post.metrics.views)} 阅读`)}"/>`).join("");
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="近 30 天每条帖子的阅读">${grid}${days}${base}${dots}${baseLabel}</svg>`;
  const present = new Set(posts.map(formOf));
  $("legend").innerHTML = Object.keys(FORMS).filter((key) => present.has(key)).map((key) => `<button type="button" class="f-${key}" data-form="${key}" aria-pressed="${view.filter?.form === key}"><i></i>${FORMS[key]} <span>${posts.filter((post) => formOf(post) === key).length}</span></button>`).join("");
}

function renderQuad(m) {
  const q = m.quadrant;
  if (!q.points.length) { $("quad").innerHTML = '<p class="empty">帖子满 72 小时、攒够 8 条之后出现。</p>'; return; }
  const W = 760, H = 390, L = 46, R = 14, T = 14, AX = 28, BAND = 40, PB = H - AX - BAND;
  const x = (r) => L + (Math.log10(Math.min(100, Math.max(0.1, r))) + 1) / 3 * (W - L - R);
  const rates = q.points.map((p) => p.bookmarksPerThousand).filter((r) => r > 0).sort((a, b) => a - b);
  const yMax = Math.max(q.savesLine * 3, rates[Math.floor(rates.length * 0.95)] || 1, 1);
  const jitter = (id) => { let hash = 0; for (const c of String(id)) hash = (hash * 31 + c.charCodeAt(0)) % 997; return (hash / 997 - 0.5) * (BAND - 12); };
  const y = (rate, id) => (rate > 0 ? PB - Math.sqrt(Math.min(yMax, rate) / yMax) * (PB - T) : PB + BAND / 2 + jitter(id));
  const cx = x(q.reachLine), cy = y(q.savesLine, "");
  const maxV = Math.max(1, ...q.points.map((p) => p.views));
  const dots = [...q.points].sort((a, b) => b.views - a.views).map((p, index) => `<circle class="dot c-${p.cell}" style="--pop:${Math.min(index * 4, 600)}ms" cx="${x(p.ratio).toFixed(1)}" cy="${y(p.bookmarksPerThousand, p.id).toFixed(1)}" r="${(4 + Math.sqrt(p.views / maxV) * 14).toFixed(1)}" data-post="${esc(p.id)}" tabindex="0" role="button"/>`).join("");
  const label = { both: "双高", reach: "传播高", saves: "收藏高", neither: "都一般" };
  // Each quadrant's name is a faint watermark drawn under the dots, so it never hides one. It sits in the
  // quadrant's emptiest spot, preferring the centre: candidates on a grid, scored by how much dot they cover.
  const bottom = PB + BAND;
  const placed = q.points.map((p) => ({ x: x(p.ratio), y: y(p.bookmarksPerThousand, p.id), r: 4 + Math.sqrt(p.views / maxV) * 14 }));
  const mark = (key, x0, x1, y0, y1) => {
    const size = Math.round(Math.max(16, Math.min(38, (x1 - x0) / 4.2, (y1 - y0) / 2.6)));
    const w = label[key].length * size * 1.1, h = size + 20;
    let best = null;
    for (let i = 0; i <= 6; i += 1) {
      for (let j = 0; j <= 4; j += 1) {
        const mx = x0 + w / 2 + 6 + (x1 - x0 - w - 12) * i / 6, top = y0 + 4 + (y1 - y0 - h - 8) * j / 4;
        if (x1 - x0 < w + 12 || y1 - y0 < h + 8) continue;
        const covered = placed.reduce((sum, d) => {
          const dx = Math.max(0, Math.abs(d.x - mx) - w / 2), dy = Math.max(0, Math.abs(d.y - (top + h / 2)) - h / 2);
          return sum + (Math.hypot(dx, dy) < d.r ? d.r * d.r : 0);
        }, 0);
        const off = Math.hypot((mx - (x0 + x1) / 2) / (x1 - x0), (top + h / 2 - (y0 + y1) / 2) / (y1 - y0));
        const score = covered + off * 600;
        if (!best || score < best.score) best = { score, mx, top };
      }
    }
    const mx = (best ? best.mx : (x0 + x1) / 2).toFixed(1), top = best ? best.top : (y0 + y1 - h) / 2;
    return `<g class="qmark c-${key}" aria-hidden="true"><text x="${mx}" y="${(top + size * 0.88).toFixed(1)}" text-anchor="middle" font-size="${size}">${label[key]}</text>
      <text class="n" x="${mx}" y="${(top + size + 16).toFixed(1)}" text-anchor="middle">${q.counts[key]} 条</text></g>`;
  };
  const marks = mark("saves", L, cx, T, cy) + mark("both", cx, W - R, T, cy) + mark("neither", L, cx, cy, bottom) + mark("reach", cx, W - R, cy, bottom);
  const ticks = [0.1, 1, 10, 100].map((v) => `<text class="axis" x="${x(v)}" y="${bottom + 18}" text-anchor="middle">${v === 1 ? "平时" : `${v}×`}</text>`).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="传播 × 收藏"><rect class="zone" x="${cx}" y="${T}" width="${W - R - cx}" height="${cy - T}" rx="14"/>
    ${marks}<line class="base" x1="${cx}" x2="${cx}" y1="${T}" y2="${bottom}"/><line class="base" x1="${L}" x2="${W - R}" y1="${cy}" y2="${cy}"/>
    <text class="axis" x="${L - 6}" y="${PB + BAND / 2 + 4}" text-anchor="end">0 收藏</text><text class="axis" x="${L - 6}" y="${cy + 4}" text-anchor="end">${q.savesLine}‰</text>
    ${dots}${ticks}</svg>`;
  const guide = [["both", "又被看又被收藏，最值得照着再写"], ["reach", "被看得多、收藏少：加步骤或清单，让它值得存"], ["saves", "看的人不多但会存：换个开头再发一次"], ["neither", "阅读和收藏都不突出"]]
    .map(([key, text]) => `<li class="c-${key}"><b>${label[key]} <small>${q.counts[key]} 条</small></b>${text}</li>`).join("");
  const both = q.both.length ? `<h4>双高的帖子</h4><ol class="toplist">${q.both.map((row) => `<li><button type="button" data-pick="${esc(row.id)}">${esc(row.topic)}</button> <span>${number(row.views)} 阅读 · ${times(row.ratio)} · 收藏 ${row.bookmarksPerThousand}‰</span></li>`).join("")}</ol>` : "";
  $("quad").innerHTML = `<p class="key">竖线：阅读是平时的 ${q.reachLine} 倍；横线：你这段时间每千次阅读有 ${q.savesLine} 次收藏。</p><div class="quad"><div class="chart">${svg}</div><div><ul class="guide">${guide}</ul>${both}</div></div>`;
}

function renderTiming(m) {
  const rows = m.timing.hourly;
  if (!rows.some((row) => row.posts)) { $("timing").innerHTML = '<p class="empty">帖子满 72 小时之后出现。</p>'; return; }
  const max = Math.max(1, ...rows.map((row) => row.ratio || 0));
  const best = new Set(rows.filter((row) => row.reliable && row.ratio).sort((a, b) => b.ratio - a.ratio).slice(0, 3).map((row) => row.id));
  const items = rows.map((row) => `<li><button type="button" class="hour${best.has(row.id) ? " best" : ""}${row.reliable ? "" : " thin"}" data-group="hourly|${row.id}" aria-expanded="false"${row.posts ? "" : " disabled"}
      aria-label="${Number(row.id)} 点：${row.posts} 条"><span class="cap" style="--h:${(row.ratio ? Math.max(4, row.ratio / max * 100) : 2).toFixed(1)}%"></span><span class="h">${Number(row.id) % 3 ? "" : Number(row.id)}</span></button></li>`).join("");
  $("timing").innerHTML = `<p class="key">柱子越高，这个小时发的帖子阅读比平时${hint("baseline")}（中位 ${number(m.baselineViews)}）高得越多。悬停看数字，点柱子看是哪些帖子。</p>
    <section class="hours" data-scope="hourly"><h4>按小时 <small>高亮是最好的三个小时，淡色不到 ${m.timing.hourlyReliable} 条</small> ${hint("thin")}</h4><ol>${items}</ol></section>
    ${rankList("星期几", m.timing.weekdays, "weekdays", { natural: true })}`;
}

function renderHow(m) {
  const html = rankList("形式", m.forms, "forms") + rankList("原创与引用", m.kinds, "kinds", { natural: true }) + rankList("篇幅", m.lengths, "lengths", { natural: true });
  $("how").innerHTML = html ? `<p class="key">倍数 = 这组的中位阅读 ÷ 平时（${number(m.baselineViews)}）；竖线是平时，淡色不到 ${m.timing.minReliable} 条。点一行看是哪些帖子。</p>${html}` : '<p class="empty">帖子满 72 小时之后出现。</p>';
}

function renderFollowers(m) {
  const snaps = m.snapshots;
  const host = $("followers");
  if (snaps.length < 2) {
    host.innerHTML = '<p class="empty">每天记一次粉丝数，攒到两天就画出曲线。保持 Postglow 在菜单栏里运行，曲线会越来越完整。</p>';
  } else {
    const W = 760, H = 220, L = 48, R = 14, T = 16, B = 24;
    const values = snaps.map((s) => s.followers), min = Math.min(...values), max = Math.max(...values), pad = Math.max(2, (max - min) * 0.08);
    const t0 = Date.parse(snaps[0].at), t1 = Date.parse(snaps.at(-1).at);
    const x = (iso) => L + (Date.parse(iso) - t0) / Math.max(1, t1 - t0) * (W - L - R);
    const y = (v) => T + (1 - (v - min + pad) / (max - min + 2 * pad)) * (H - T - B);
    const line = snaps.map((s, i) => `${i ? "L" : "M"}${x(s.at).toFixed(1)},${y(s.followers).toFixed(1)}`).join("");
    const ticks = [min, (min + max) / 2, max].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${number(v)}</text>`).join("");
    const dots = snaps.map((s, i) => `<circle class="dot f-video" style="--pop:0ms" cx="${x(s.at)}" cy="${y(s.followers)}" r="${i === snaps.length - 1 ? 5 : 3}" data-snap="${i}"/>`).join("");
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="粉丝数">${ticks}<path class="line-path" d="${line}"/>${dots}
      <text class="axis" x="${L}" y="${H - 4}">${esc(snaps[0].day)}</text><text class="axis" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(snaps.at(-1).day)}</text></svg>`;
  }
  $("followerPosts").innerHTML = m.followerPosts.length ? `<h4 style="margin-top:14px">带粉最多的帖子 <small>发帖前后 24 小时的粉丝变化，同一窗口的帖子平分</small> ${hint("followerPosts")}</h4><ol class="toplist">${m.followerPosts.map((row) =>
    `<li><button type="button" data-pick="${esc(row.id)}">${esc(row.topic)}</button> <span>+${row.followers.toFixed(row.followers < 10 ? 1 : 0)} · ${number(row.views)} 阅读</span></li>`).join("")}</ol>` : "";
}

function renderPace(m) {
  const points = m.growth.points.filter((point) => typeof point.median === "number");
  if (!points.length) { $("pace").innerHTML = `<p class="empty">需要按时记下 1/6/24/72 小时读数的帖子（现在 ${m.growth.posts} 条），保持 Postglow 运行几天就有。</p>`; return; }
  const bars = [...points, { label: "72h", median: 1 }].map((p) => `<li><b>${Math.round(p.median * 100)}%</b><span class="bar"><i style="--h:${(p.median * 100).toFixed(0)}%"></i></span>发出 ${p.label.replace("h", " 小时")}</li>`).join("");
  const six = points.find((p) => p.label === "6h");
  $("pace").innerHTML = `<p class="key">发出后到这个时间，平均拿到了 3 天总阅读的百分之几（${m.growth.posts} 条）。</p><div class="growth"><ol>${bars}</ol></div>
    ${six?.rankCorrelation != null ? `<p class="note">发出 6 小时时谁高谁低，和 3 天后的排名相关 ${six.rankCorrelation}${six.rankCorrelation >= 0.8 ? "：新帖的「高于 / 低于平时（6h）」基本可信" : ""}。</p>` : ""}`;
}

function renderList(m) {
  let posts = m.posts.filter((post) => view.replies || post.kind !== "reply").filter(visible);
  const sorts = { recent: (a, b) => b.postedAt.localeCompare(a.postedAt), views: (a, b) => b.metrics.views - a.metrics.views,
    reach: (a, b) => (b.reach?.ratio ?? -1) - (a.reach?.ratio ?? -1), engagement: (a, b) => b.engagementRate - a.engagementRate };
  posts = [...posts].sort(sorts[view.sort]);
  const focus = posts.findIndex((post) => post.id === view.focusId);
  if (focus > 0) posts.unshift(...posts.splice(focus, 1));
  const chip = $("filterChip");
  chip.hidden = !view.filter;
  chip.innerHTML = view.filter ? `只看：${esc(view.filter.label)} · ${posts.length} 条 <button type="button" data-filter-clear aria-label="取消筛选">×</button>` : "";
  const kinds = { original: "原创", quote: "引用", reply: "回复" };
  $("list").innerHTML = posts.length ? posts.slice(0, view.shown).map((post) => {
    const reach = reachCopy(post);
    return `<li class="post${post.id === view.focusId ? " focus" : ""}" data-post-row="${esc(post.id)}"><div class="meta-row"><time>${esc(when(post.postedAt))}</time>
        <span class="tag">${kinds[post.kind]}</span><span class="tag">${FORMS[formOf(post)]}</span><span class="reach ${reach.tone}">${esc(reach.text)}</span></div>
      <button type="button" class="text" data-open="${esc(post.url)}" title="打开原帖">${esc(post.text || "（无正文）")}</button>
      <div class="numbers">${[["views", "阅读"], ["likes", "赞"], ["reposts", "转发"], ["replies", "回复"], ["bookmarks", "收藏"]].map(([key, name]) => `<span><b>${number(post.metrics[key])}</b> ${name}</span>`).join("")}<span>互动率 <b>${percent(post.engagementRate)}</b></span></div></li>`;
  }).join("") + (posts.length > view.shown ? `<li><button type="button" class="btn" data-more>再显示 ${Math.min(PAGE, posts.length - view.shown)} 条（共 ${posts.length} 条）</button></li>` : "")
    : `<li class="empty">${view.filter ? "这个筛选下没有帖子。" : "还没有帖子数据。"}</li>`;
}

function renderMeta() {
  const c = view.model.collector;
  const parts = [c.lastSuccessAt ? `上次读取 ${ago(c.lastSuccessAt)}` : "还没有读取", `共 ${number(view.model.posts.length)} 条`,
    view.accounts.length > 1 ? `${view.accounts.length} 个账号每小时自动读取` : "每小时自动读取"];
  if (view.model.baselineViews) parts.splice(2, 0, `平时阅读中位 ${number(view.model.baselineViews)}`);
  if (c.lastOk === false && c.lastError) parts.push(`上次失败：${c.lastError}`);
  if (view.busy) parts.unshift("正在读取…");
  $("meta").textContent = parts.join(" · ");
  $("refreshBtn").disabled = view.busy;
}

function render() {
  view.model = review(view.state);
  renderMeta();
  renderOverview(view.model);
  renderSwarm(view.model);
  renderQuad(view.model);
  renderTiming(view.model);
  renderHow(view.model);
  renderFollowers(view.model);
  renderPace(view.model);
  renderList(view.model);
  renderDrill();
}

/* ---------- reading: one read at a time, every saved account in turn ---------- */
async function readAccounts({ force = false } = {}) {
  if (view.busy || !view.state?.account) return;
  view.busy = true;
  if (view.model && !$("app").hidden) renderMeta();
  try {
    // The account on screen first (forced by 立即读取), then the others when they are due.
    const others = view.accounts.filter((handle) => handle !== key(view.state.account));
    for (const handle of [key(view.state.account), ...others]) {
      const state = handle === key(view.state.account) ? view.state : await store.load(handle);
      if (!state) continue;
      const result = await collect(state, { force: force && state === view.state });
      if (!result.skipped) await store.save(state);
    }
  } finally {
    view.busy = false;
    if (!$("app").hidden) render();
  }
}
const readNow = (force) => readAccounts({ force });

function focusPost(id) {
  const post = view.model.posts.find((row) => row.id === id);
  if (view.filter && post && !visible(post)) view.filter = null;
  if (post?.kind === "reply") view.replies = true;
  view.focusId = id;
  view.shown = Math.max(view.shown, PAGE);
  renderSwarm(view.model);
  renderList(view.model);
  document.querySelector(`[data-post-row="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- events ---------- */
document.addEventListener("click", (event) => {
  const target = event.target;
  const help = target.closest("[data-help]");
  if (help) { event.preventDefault(); showHint(help); return; }
  if (target.closest("#helpBtn, [data-open-help]")) { openHelp(); return; }
  if (target.closest("[data-help-close]") || target === $("help")) { $("help").close(); return; }
  const closing = target.closest("[data-close-choice]");
  if (closing) {
    if ($("closeRemember").checked) rememberClose(closing.dataset.closeChoice);
    $("closeAsk").close();
    closeAs(closing.dataset.closeChoice);
    return;
  }
  if (target.closest("[data-check-update]")) { $("help").close(); checkUpdate(true); return; }
  if (target.closest("[data-update-install]")) { installUpdate(); return; }
  if (target.closest("[data-update-later]")) { updates.dismissed = updates.latest; $("update").hidden = true; return; }
  const look = target.closest("[data-look-option]");
  if (look) {
    view.prefs = { ...view.prefs, look: look.dataset.lookOption };
    applyLook();
    store.savePrefs();
    return;
  }
  const dot = target.closest("[data-post]");
  if (dot) {
    const post = view.model.posts.find((row) => row.id === dot.dataset.post);
    if ((event.metaKey || event.ctrlKey) && post) openPost(post.url);
    else focusPost(dot.dataset.post);
    return;
  }
  const pick = target.closest("[data-pick]");
  if (pick) { focusPost(pick.dataset.pick); return; }
  const open = target.closest("[data-open]");
  if (open) { openPost(open.dataset.open); return; }
  const group = target.closest("[data-group]");
  if (group) {
    const [source, id] = group.dataset.group.split("|");
    const scope = group.closest("[data-scope]")?.dataset.scope || source;
    const same = view.drill && view.drill.source === source && view.drill.id === id && view.drill.scope === scope;
    view.drill = same ? null : { source, id, scope };
    renderDrill();
    return;
  }
  if (target.closest("[data-drill-close]")) { view.drill = null; renderDrill(); return; }
  if (target.closest("[data-drill-list]") && view.drill) {
    const row = groupRow(view.drill.source, view.drill.id);
    view.filter = { ids: new Set(row.ids), label: `${SOURCES[view.drill.source][0]} · ${row.label}` };
    view.focusId = ""; view.shown = PAGE;
    renderSwarm(view.model); renderList(view.model);
    $("secList").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const form = target.closest("[data-form]");
  if (form) {
    view.filter = view.filter?.form === form.dataset.form ? null : { form: form.dataset.form, label: FORMS[form.dataset.form] };
    view.shown = PAGE;
    renderSwarm(view.model); renderList(view.model);
    return;
  }
  if (target.closest("[data-filter-clear]")) { view.filter = null; renderSwarm(view.model); renderList(view.model); return; }
  if (target.closest("[data-more]")) { view.shown += PAGE; renderList(view.model); return; }
  const sort = target.closest("[data-sort]");
  if (sort) {
    view.sort = sort.dataset.sort; view.focusId = ""; view.shown = PAGE;
    document.querySelectorAll("[data-sort]").forEach((node) => node.setAttribute("aria-pressed", String(node === sort)));
    renderList(view.model);
    return;
  }
  if (target.closest("#repliesBtn")) {
    view.replies = !view.replies;
    $("repliesBtn").setAttribute("aria-pressed", String(view.replies));
    $("repliesBtn").textContent = view.replies ? "隐藏回复" : "显示回复";
    renderList(view.model);
    return;
  }
  const jump = target.closest("[data-jump]");
  if (jump) { $(jump.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (target.closest("#refreshBtn")) { readNow(true); return; }
  if (target.closest("#switchBtn")) { showWelcome(); return; }
  if (target.closest("[data-welcome-back]")) { showApp(); return; }
  const pickAccount = target.closest("[data-account]");
  if (pickAccount) { switchTo(pickAccount.dataset.account); return; }
  const removeAccount = target.closest("[data-account-remove]");
  if (removeAccount) { askRemove(removeAccount); return; }
});

document.addEventListener("mouseover", (event) => {
  const dot = event.target.closest?.("[data-post]");
  if (dot) {
    const post = view.model?.posts.find((row) => row.id === dot.dataset.post);
    if (post) showTip(postTip(post), event.clientX, event.clientY);
    return;
  }
  const group = event.target.closest?.("[data-group]");
  if (group) {
    const [source, id] = group.dataset.group.split("|");
    const html = groupTip(source, id);
    if (html) showTip(html, event.clientX, event.clientY);
    return;
  }
  const help = event.target.closest?.("[data-help]");
  if (help) { showHint(help); return; }
  const snap = event.target.closest?.("[data-snap]");
  if (snap) {
    const row = view.model.snapshots[Number(snap.dataset.snap)];
    const prev = view.model.snapshots[Number(snap.dataset.snap) - 1];
    showTip(`<strong>${esc(row.day)}</strong><dl><div><dt>粉丝</dt><dd>${number(row.followers)}</dd></div>${prev ? `<div><dt>比前一次</dt><dd>${row.followers - prev.followers >= 0 ? "+" : ""}${row.followers - prev.followers}</dd></div>` : ""}</dl>`, event.clientX, event.clientY);
  }
});
document.addEventListener("mouseout", (event) => {
  const from = event.target.closest?.("[data-post], [data-group], [data-snap], [data-help]");
  if (from && !from.contains(event.relatedTarget)) hideTip();
});
document.addEventListener("focusin", (event) => { const help = event.target.closest?.("[data-help]"); if (help) showHint(help); });
document.addEventListener("focusout", (event) => { if (event.target.closest?.("[data-help]")) hideTip(); });
document.addEventListener("keydown", (event) => {
  const dot = event.target.closest?.("[data-post]");
  if (dot && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); focusPost(dot.dataset.post); }
});

// Section links follow the reader.
const sections = ["secOverview", "secPosts", "secQuad", "secTiming", "secHow", "secGrowth", "secList"];
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) document.querySelectorAll("[data-jump]").forEach((button) => button.setAttribute("aria-current", String(button.dataset.jump === entry.target.id)));
  }
}, { rootMargin: "-90px 0px -60% 0px" });
sections.forEach((id) => $(id) && observer.observe($(id)));

let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => view.model && renderSwarm(view.model), 150); });

/* ---------- welcome and start ---------- */
/* ---------- accounts: the welcome page adds one; saved ones are listed there to switch to or remove ---------- */
function renderAccounts() {
  const current = key(view.state?.account);
  const saved = view.accounts.length > 0;
  $("welcomeTitle").textContent = saved ? "换一个账号" : "Postglow";
  $("welcomeBack").hidden = !view.state;
  $("accounts").hidden = !saved;
  $("accounts").innerHTML = saved ? `<p>已保存的账号 <small>每个账号的数据单独保存，都会在后台每小时读取</small></p><ul>${view.accounts.map((handle) => {
    const name = cache.get(handle)?.profile?.handle || handle;
    return `<li class="${handle === current ? "current" : ""}"><button type="button" data-account="${esc(handle)}">@${esc(name)}${handle === current ? " <small>当前</small>" : ""}</button>
      <button type="button" class="remove" data-account-remove="${esc(handle)}" aria-label="删除 @${esc(name)} 的数据" title="删除这个账号的数据">×</button></li>`;
  }).join("")}</ul>` : "";
}

function showWelcome() {
  document.querySelector(".autostart-ask").hidden = !tauri || view.accounts.length > 0;
  $("welcomeStatus").textContent = "";
  $("handleInput").value = "";
  renderAccounts();
  $("app").hidden = true;
  $("welcome").hidden = false;
  $("handleInput").focus();
}

function showApp() {
  if (!view.state) return;
  $("welcome").hidden = true;
  $("app").hidden = false;
  view.filter = null; view.focusId = ""; view.drill = null; view.shown = PAGE;
  render();
}

async function switchTo(handle) {
  const state = await store.load(handle);
  if (!state) return;
  view.state = state;
  view.prefs = { ...view.prefs, current: state.account };
  await store.savePrefs();
  showApp();
  if (due(state, Date.now())) readNow(false);
}

// Removing asks twice in place: the first click turns × into 确认删除.
function askRemove(button) {
  if (!button.classList.contains("confirm")) {
    button.classList.add("confirm");
    button.textContent = "确认删除";
    setTimeout(() => { if (button.isConnected) { button.classList.remove("confirm"); button.textContent = "×"; } }, 4000);
    return;
  }
  removeAccount(button.dataset.accountRemove);
}

async function removeAccount(handle) {
  if (view.busy) { $("welcomeStatus").className = "status"; $("welcomeStatus").textContent = "正在读取，请稍后再删除。"; return; }
  await store.remove(handle);
  view.accounts = await store.list();
  if (key(view.state?.account) === handle) {
    const next = view.accounts[0] ? await store.load(view.accounts[0]) : null;
    view.state = next;
    view.prefs = { ...view.prefs, current: next?.account || "" };
    await store.savePrefs();
  }
  showWelcome();
}

$("welcomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const handle = $("handleInput").value.trim().replace(/^@/, "").replace(/^https?:\/\/(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
  const status = $("welcomeStatus");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) { status.className = "status error"; status.textContent = "请输入 X 用户名，例如 @jack"; return; }
  if (view.accounts.includes(key(handle))) { switchTo(key(handle)); return; }
  if (view.accounts.length >= MAX_ACCOUNTS) { status.className = "status error"; status.textContent = `最多保存 ${MAX_ACCOUNTS} 个账号，先删掉一个不再需要的。`; return; }
  const first = view.accounts.length === 0;
  const next = emptyState(handle);
  status.className = "status"; status.textContent = "正在读取，第一次会回看约一个月，需要几十秒…";
  const result = await collect(next, { force: true });
  if (!result.ok) { status.className = "status error"; status.textContent = result.error || "读取失败"; return; }
  await store.save(next);
  view.accounts = await store.list();
  if (first && !document.querySelector(".autostart-ask").hidden) setAutostart($("welcomeAutostart").checked);
  status.textContent = "";
  await switchTo(key(next.account));
});

async function start() {
  view.prefs = await store.prefs();
  applyLook();
  view.accounts = await store.list();
  const current = view.accounts.includes(key(view.prefs.current)) ? key(view.prefs.current) : view.accounts[0];
  view.state = current ? await store.load(current) : null;
  if (!view.state) { showWelcome(); return; }
  showApp();
  readNow(false);
}

// The hourly read: checked every five minutes and whenever the window comes back; each account only when it is due.
setInterval(() => readNow(false), 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) readNow(false); });
// Relative times ("x 分钟前") stay current.
setInterval(() => view.model && renderMeta(), 60 * 1000);
// New versions: a few seconds after launch, then once a day while it keeps running in the menu bar.
setTimeout(() => checkUpdate(false), 5000);
// After an update, say so once.
tauri?.app?.getVersion().then((version) => {
  try {
    const seen = localStorage.getItem("postglow-version");
    if (seen && seen !== version) showUpdate(`已更新到 <b>${esc(version)}</b>`, true);
    localStorage.setItem("postglow-version", version);
  } catch {}
}).catch(() => {});
setInterval(() => checkUpdate(false), DAY);

start();
