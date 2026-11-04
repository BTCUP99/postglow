# Postglow

Tauri 2 Mac app. Page in `src/` (plain HTML/CSS/JS: `collect.js` reads, `review.js` computes, `app.js` draws, `help.js` help text), native side in `src-tauri/src/lib.rs`. Tests: `npm test`.

Follow `docs/MAINTAINING.md`:
- Commit and push to main freely; **do not cut a release** (tag + GitHub Release) unless the user asks for one. Releases reach every installed copy through the updater, so they are batched.
- Every user-visible change gets a line under 「未发布」 in `CHANGELOG.md`, in the user's words (Chinese).
- Release only with `scripts/release.sh X.Y.Z`. Never move, delete or reuse a published tag or its assets; never change the updater `pubkey`.
- Help text in `src/js/help.js` must match the numbers in `review.js`.
