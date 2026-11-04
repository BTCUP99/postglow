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

**安装**（二选一）

- **一行命令**（最省事）：打开「终端」，粘贴下面这行，回车。会下载最新版、装进「应用程序」并直接打开，不会弹安全提示。
  ```sh
  curl -fsSL https://raw.githubusercontent.com/BTCUP99/postglow/main/install.sh | bash
  ```
- **手动下载**：在 [Releases](../../releases) 下载 `Postglow_x.y.z_universal.dmg`，打开后照窗口里的三步做：
  1. 把 Postglow 拖进「应用程序」。
  2. 在「应用程序」里双击 Postglow，macOS 会提示「已损坏，无法打开」。点「完成」（**不要**点「移到废纸篓」）。
  3. 打开「系统设置 → 隐私与安全性」，拉到最下面，点「仍要打开」，输入一次密码。以后就能正常打开了。

**为什么会提示「已损坏」？安全吗？**

文件并没有损坏，也不是病毒。macOS 会拦下所有没有经过 Apple 付费开发者认证和公证（每年 99 美元）的应用，并显示这句吓人的提示。Postglow 是免费的开源小工具，暂时没有做这一步。

- 全部代码就在这个仓库里，任何人都可以查看；安装包由 GitHub Actions 从公开代码自动构建。
- 它不需要登录 X，不读取密码或私信，只通过 FxTwitter 读取公开帖子；数据只存在你自己的电脑上，没有服务器，没有统计上报。
- 不想点设置的话，用上面的一行命令安装就不会出现这个提示。

**使用**

1. 输入你的 X 用户名。第一次会回看约一个月（几十秒），之后每小时自动读一次。
2. 看不懂某个板块：鼠标停在标题旁边的 **?** 上会有解释；右上角的 **?** 是完整的使用说明。
3. 开机自动启动：第一次使用时可以勾选「登录 Mac 时自动在菜单栏启动」，重启电脑后也不会漏读；之后在使用说明里随时开关。
4. 更新：Postglow 会自动检查新版本，有更新时顶部出现提示，点「立即更新」即可，几秒完成、数据保留，也不会再出现「已损坏」提示。也可以在使用说明或菜单栏图标里点「检查更新」。（自动更新从 0.1.3 开始；更早的版本请先手动装一次新版，直接拖进「应用程序」替换即可，不用卸载。）

第一次点窗口的关闭按钮时，Postglow 会问你：留在菜单栏继续读取（推荐，只占屏幕顶部一个小图标，不占 Dock），还是彻底退出；之后可以在使用说明里改。要彻底退出，点菜单栏图标 → 退出，或按 ⌘Q。窗口可以拖动顶部空白处移动。帖子满 72 小时才进入大部分统计，粉丝曲线每天一个点，所以开着用几天会越来越准。

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

- Install with one line: `curl -fsSL https://raw.githubusercontent.com/BTCUP99/postglow/main/install.sh | bash` (downloads the latest release into /Applications and opens it, no Gatekeeper prompt).
- Or download the `.dmg` from [Releases](../../releases). macOS will say the app "is damaged and can't be opened": it isn't. Postglow is free and open source and is not notarized by Apple (that needs a paid developer account), so Gatekeeper shows this for any download. Click Done (not Move to Trash), then System Settings → Privacy & Security → Open Anyway, once.
- Updates: from 0.1.3 on, Postglow checks for new versions and updates itself in place (signed with its own updater key, data kept, no Gatekeeper prompt). Older versions: drag the new one into Applications to replace it.
- Inside the app, the **?** at the top right opens a short guide, and every **?** next to a title explains that card on hover.
- It keeps running in the menu bar after you close the window and reads hourly.
- Data stays in `~/Library/Application Support/app.postglow.desktop/state.json`. Nothing is sent anywhere but FxTwitter.

## Maintaining

Release rules, the changelog and `scripts/release.sh`: see [docs/MAINTAINING.md](docs/MAINTAINING.md).

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
