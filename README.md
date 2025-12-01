# redDeleteIt Userscripts

Two companion userscripts help you bulk-remove Reddit posts and comments:
- `redditDelete.js` / `redditDelete.ts`: prompt-based flow with filters and dry run.
- `redditDeleteUI.js` / `redditDeleteUI.ts`: in-page UI that saves settings and lets you pick subreddits to include.

## Install
1. Install a userscript manager (Tampermonkey or Violentmonkey).
2. From this repo, open the raw file you want (`redditDelete.js` or `redditDeleteUI.js`) and let your manager install it.
3. Ensure the script is enabled. Matches cover `www/new/old.reddit.com/user/*` and `/u/*`.

## Using the UI script
1. Go to your Reddit profile; click the floating red “redDeleteIt” button.
2. Configure:
   - Mode: all / older than / newer than + time unit.
   - Toggles: NSFW only, dry run.
   - Subreddits: click “Load my subs,” then select which to include (only these are processed).
   - Persistence: session or local storage (remembers settings).
3. Click “Start run.” A profile tab opens and runs automatically; it paginates old Reddit. Dry run logs actions and shows a total count at the end.

## Using the classic script
1. Go to your profile; accept the intro prompt.
2. Answer the filter prompts (mode, time window, NSFW-only, dry run).
3. The script scrolls, processes matches, paginates old Reddit, and reports a total affected count at completion.

## Building
- Edit the TypeScript sources and run `npx tsc` (tsconfig includes both scripts).
- No external dependencies; targets ES2020 + DOM libs.

## Tips
- Start with dry run to confirm targeting.
- NSFW-only filtering depends on page metadata; if you see misses, capture a sample element to refine selectors.
- For the UI script, local storage keeps settings across tabs; session storage keeps them per tab.
