# Cline Web — Quick Start Guide

**Live app:** <https://clineclone.vercel.app>
**Repository:** <https://github.com/strangerx003/cline-clone>

The interface mirrors the ChatGPT web app shell: a full-height rail on the left, a
centred 48rem reading column, right-aligned user bubbles, borderless assistant
replies, and a rounded pill composer with a circular send button. Everything is
responsive, from wide desktop down to phones.

## 1. Quick Start (1-Click Run)
To run the Cline Web application immediately:
- **Double-click `start.bat`** in this folder.
- It will automatically launch the local static server and open **http://localhost:5500** in your default web browser.

Alternatively, run with your terminal:
```bash
# Using Node.js (Zero dependencies):
node server.mjs

# Or using Python:
python -m http.server 5500
```

---

## 1b. Using the app

| Area | What to do |
| :--- | :--- |
| **Left rail** | `New chat` clears the thread, `Refresh files` re-reads the folder, `History` restores previous file versions, and the search box filters the file tree. |
| **Header** | `☰` collapses the rail, the model name opens the model picker, the folder chip opens or switches the workspace, and the icons open API keys, settings and the theme switch. |
| **Composer** | Type and press **Enter** to send, **Shift+Enter** for a newline, and `+` to attach images. Token and cost usage sits just below the composer. |
| **Mobile** | The rail becomes an overlay drawer with a dimmed backdrop — tap the backdrop to close it. Touch targets are enlarged to 40px. |

---

## 2. Active Free API Keys & Pre-configured Models

The application comes pre-configured with a live, verified API key that grants free access to top coding models without any credit card or setup needed:

| Provider | Model Name | Model ID | Status | Cost |
| :--- | :--- | :--- | :--- | :--- |
| **BazaarLink** *(Default)* | **DeepSeek V4 Flash** | `deepseek/deepseek-v4-flash-0731free:free` | **Active / Verified** | **$0.00 / Free** |
| **BazaarLink** | **Qwen3.7 Flash** | `qwen/qwen3.7-flash:free` | **Active / Verified** | **$0.00 / Free** |
| **BazaarLink** | **Auto Router** | `auto:free` | **Active / Verified** | **$0.00 / Free** |

### Pre-loaded API Key Details:
- **Provider**: BazaarLink
- **Base URL**: `https://api.bazaarlink.ai/v1`
- **Active Key**: `sk-bl-x20dKwkMp_6MGfdm2Z7dW6aOI8vqnxjEcn7pKZsJPsGellmL`
- **Rate Limit**: 20 requests / minute
- **Context Window**: 1,000,000 tokens (1M context)

---

## 3. Recommended Additional Free Coding Keys (No Credit Card)

If you ever want backup or higher rate limits, you can generate free keys for these OpenAI-compatible providers in under 1 minute:

1. **Groq Cloud** (Fastest inference, 30 requests/min free):
   - **Signup**: [console.groq.com/keys](https://console.groq.com/keys)
   - **Models**: `llama-3.3-70b-versatile`, `qwen-2.5-coder-32b`
   - **Base URL**: `https://api.groq.com/openai/v1`

2. **OpenRouter** (All top models with `:free` suffix):
   - **Signup**: [openrouter.ai/keys](https://openrouter.ai/keys)
   - **Models**: `qwen/qwen-2.5-coder-32b-instruct:free`, `deepseek/deepseek-chat:free`
   - **Base URL**: `https://openrouter.ai/api/v1`

3. **Google AI Studio / Gemini**:
   - **Signup**: [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
   - **Models**: `gemini-2.0-flash` (15 RPM free)
   - **Base URL**: `https://generativelanguage.googleapis.com/v1beta/openai`

---

## 4. How to Add More Keys in the UI
1. Click the **API keys** (key icon) button in the header.
2. Paste your API key in the textarea.
3. Click **Add key(s)**. The app automatically detects the provider and activates it!

---

## 5. Deployment

**GitHub** — source lives at <https://github.com/strangerx003/cline-clone>; push to `main` to keep it current.

**Vercel** — the project link is stored in `.vercel/project.json` and the static build is configured in `vercel.json`:

```bash
vercel --prod --yes                                        # production deploy
vercel alias set domain-psi-nine.vercel.app clineclone.vercel.app   # refresh the short URL
```

`https://clineclone.vercel.app` is an alias of the newest production deployment.
To make it stick automatically on every future deploy, rename the Vercel project
to `clineclone` in the dashboard (Settings → General → Project Name) — otherwise
just re-run the `vercel alias set` command after each deploy.

---

## 6. Tests

```bash
node tests/smoke.mjs      # 30 checks: syntax, DOM ids, boot, real click handlers
node tests/selectors.mjs  # 11 checks: every querySelector/closest target resolves
```

