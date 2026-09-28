# Cline Web

A browser-based, ChatGPT-style AI coding agent. Pick a folder, chat, and the model
creates, edits and deletes **real files on your disk** — no backend, no build step,
no npm dependencies.

**Live:** <https://clineclone.vercel.app>

---

## What it does

- **ChatGPT-grade interface** — full-height sidebar rail, centred 48rem reading
  column, right-aligned user bubbles, borderless assistant replies, hover-reveal
  message actions, and a rounded pill composer with a circular send button.
  Dark and light themes, fully responsive (the sidebar becomes an overlay drawer
  on phones with a dimmed backdrop and 40px touch targets).
- **Real filesystem access** — the File System Access API opens a folder you pick
  and streams file contents back to the model. Every write is confirmed with a
  colourised diff before it lands (or auto-approved if you flip that switch).
- **Read-only zip mode** — browsers without the File System Access API can load a
  folder, chat about it, and export the resulting changes as a `.zip`.
- **Free, working models** — ships with verified zero-cost endpoints
  (DeepSeek V4 Flash, Qwen 3.7 Flash, an auto-router) plus presets for Groq,
  OpenRouter, Gemini, and any OpenAI-compatible base URL.
- **Undo history** — every edit is snapshotted, so `History` in the sidebar can
  restore any previous revision.
- **Live reasoning** — streaming tokens, collapsible model reasoning, token/cost
  accounting and cancellable runs.

## Run it

```bash
node server.mjs      # http://localhost:5500  (or double-click start.bat)
```

Any static server works — the app is plain HTML, CSS and ES modules.

## Layout of the source

```
index.html      app shell (topbar, sidebar rail, thread, composer, preview)
styles.css      the design system: tokens, components, responsive rules
src/ui.js       controller: chat rendering, explorer, modals, workspace
src/agent.js    the agent loop (stream → parse ops → apply → verify)
src/api.js      OpenAI-compatible streaming client with retries/backoff
src/fs.js       File System Access API + fallbacks
src/tools.js    markdown, syntax highlighting, diffs, op parsing
src/models.js   model catalog, grouping, pricing
src/providers.js provider detection and presets
tests/          smoke + selector checks (node tests/smoke.mjs)
```

## Tests

```bash
node tests/smoke.mjs      # syntax, DOM ids, boot, real click handlers
node tests/selectors.mjs  # every querySelector/closest target resolves
```

## Deploy

```bash
vercel --prod --yes
vercel alias set domain-psi-nine.vercel.app clineclone.vercel.app
```

See [HOW_TO_RUN.md](./HOW_TO_RUN.md) for API keys, models and troubleshooting.
