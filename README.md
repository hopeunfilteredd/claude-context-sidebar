# Claude Context Meter

See how full each Claude Code chat's context window is, without typing `/context`.

A section called **Context** appears inside the Claude Code sidebar in VS Code. It has two views, switched at the top:

- **This chat:** one card for the chat you are in.
- **All chats:** every chat of the open folder, newest first, with the one you are in marked.

Each card shows the chat's real title (the same name as its tab), a bar that turns amber at 60% and red at 80%, how many tokens are used and how many are left, and a **↻ compacted 2×** chip once Claude Code has compacted the chat. At 80% it adds a short "wrap up before a heavy step" line. It only shows; it never compacts, clears or changes a chat.

## Install

1. Download `claude-context-meter-0.1.1.vsix` from the Releases page.
2. In VS Code open Extensions, click the `...` menu, choose **Install from VSIX...**, and pick the file.
3. Reload the window (Command Palette, "Developer: Reload Window").

The list appears under the Claude Code sidebar's Session Manager. It works on its own.

### Optional: exact window sizes (the companion mod)

The extension reads each chat's size from the chat's saved file, but those files do not say how big the chat's window is, so without the mod it asks you once for yours (see Settings). The companion mod, which runs inside Claude Code, reports the exact window for every chat. Install it from a terminal Claude Code session:

```
/plugin install context-meter --marketplace hopeunfilteredd/claude-context-meter
```

Answer `y` to add the marketplace, then pick the **user** scope so every chat loads it. It has no screen, writes one tiny file per chat inside your own `~/.claude` folder, and cannot break or slow a chat.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `contextMeter.assumedWindow` | `0` (ask) | Your context window in tokens, for example `200000` or `1000000`. Claude Code does not record it on disk, so unless the companion mod is installed the extension asks you once (or run **Context Meter: Set my window size**) and shows tokens used without a percentage until it knows. It never guesses. Estimated sizes are shown with a `~`. |
| `contextMeter.amberAt` / `redAt` | `60` / `80` | Where the bar turns amber and red. |
| `contextMeter.maxAgeHours` | `36` | Chats untouched for longer are left out. |
| `contextMeter.hideTitlesMatching` | empty | A regular expression; matching titles are hidden, for example `\(old\)`. |
| `contextMeter.showOwnIcon` | `false` | Adds an icon of its own to the activity bar, as a fallback if the section does not appear inside the Claude Code sidebar. |

## How it works

For each chat file in `~/.claude/projects/<your folder>/`, it reads the end of the file for the last reply's input size and the chat's title, and counts the compaction markers. Nothing is sent anywhere; it reads local files only. The numbers are the same input size Claude Code's `/context` header reports.

## Honest limits

- It relies on how Claude Code stores chats today. That format is not a public promise, so an update can break it. A chat it cannot read is skipped, never guessed.
- It adds its section to the Claude Code sidebar by that sidebar's internal name, which an update could change. If the section disappears, turn on `contextMeter.showOwnIcon` and it appears in its own activity-bar icon.
- It lists the chats of the folder you have open, not chats from other folders.
- The window size is whatever you tell it, unless the companion mod is installed to report it exactly.

## Licence

MIT. Not affiliated with or endorsed by Anthropic.
