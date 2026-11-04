<p align="center"><img src="app-icon.png" width="96" alt=""></p>
<h1 align="center">Postglow · 帖子复盘</h1>
<p align="center">A small Mac app that reviews your X posts: which ones got read, what hour works, how they grow, where followers came from.<br>输入一个 X 用户名，本地复盘你的帖子。</p>

---

## 中文

**它做什么**

- 概览：本周阅读、和上周比、粉丝 / 关注 / 发帖数的变化、三个最值得注意的发现。
- 每条帖子：近 30 天每条帖子的阅读，气泡越大收藏越多，悬停看是哪条。
- 传播 × 收藏：哪些帖子既被看又被收藏。
- 发帖时段：按小时、按星期几，和你平时的帖子比。
- 怎么发：视频 / 图片 / 纯文字 / X 长文，原创 / 引用，篇幅长短。
- 粉丝：每天记一次，以及哪些帖子发出后粉丝涨得多。
- 发后多久见分晓：发出 1 / 6 / 24 小时拿到 3 天阅读的几成。

**怎么用**

1. 在 [Releases](../../releases) 下载 `Postglow_x.y.z_universal.dmg`，拖进「应用程序」。
2. 第一次打开：应用还没有签名，请在「应用程序」里**右键 Postglow → 打开**，再点「打开」。（或者 `xattr -dr com.apple.quarantine /Applications/Postglow.app`）
3. 输入你的 X 用户名。第一次会回看约一个月（几十秒），之后每小时自动读一次。

关掉窗口后 Postglow 留在菜单栏里继续读取；要退出，点菜单栏图标 → 退出。帖子满 72 小时才进入大部分统计，粉丝曲线每天一个点，所以开着用几天会越来越准。

**数据从哪来**

通过开源项目 [FxTwitter](https://github.com/FxEmbed/FxEmbed) 的公开接口读取公开帖子和资料，不需要登录 X，也不需要 API Key。所有数据只保存在本机：`~/Library/Application Support/app.postglow.desktop/state.json`。没有服务器、没有统计上报。

**数字怎么算**

- 「平时」= 近 30 天满 72 小时的原创和引用帖子的阅读中位数（至少 8 条）。
- 帖子只和同龄帖子比：满 72 小时的和「平时」比，更新的和 1 / 6 / 24 小时按时记下的读数比。
- 一组不到 10 条（小时不到 5 条）显示为淡色，不作结论。
- 时间按电脑的本地时区。
- 粉丝来源：发帖前最后一次记录到发帖后至少 24 小时的第一次记录之间的变化，同一窗口的帖子平分。只是方向，不是证据。

**限制**

- FxTwitter 是第三方服务，接口变动或不可用时读取会失败（会在顶部显示，15 分钟后重试）。
- 电脑睡眠或应用退出期间不会读取，错过的时间点会标为「不按时」，不参与对比。
- 目前只做了 macOS。

## English

Postglow reads one public X account through the open [FxTwitter](https://github.com/FxEmbed/FxEmbed) API (no login, no key), keeps the posts on your Mac, and shows how they did: reach against your usual post of the same age, the hour and weekday they went out, form and length, reach × bookmarks, how fast views arrive, and follower growth.

- Download the `.dmg` from [Releases](../../releases). The app is not signed yet: right-click → Open the first time.
- It keeps running in the menu bar after you close the window and reads hourly.
- Data stays in `~/Library/Application Support/app.postglow.desktop/state.json`. Nothing is sent anywhere but FxTwitter.

## Develop

```sh
npm install
npm test          # the numbers (Node's test runner)
npm run dev       # the app, live
npm run build     # .app and .dmg in src-tauri/target/release/bundle
```

Built with [Tauri 2](https://tauri.app). The page is plain HTML / CSS / JavaScript in `src/`: `collect.js` reads and stores, `review.js` computes every number, `app.js` draws it. The Rust side (`src-tauri/src/lib.rs`) only keeps the window, the menu-bar icon and the state file.

## License

MIT
