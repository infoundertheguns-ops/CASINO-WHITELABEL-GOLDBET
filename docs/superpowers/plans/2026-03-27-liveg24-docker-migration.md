# LiveG24 Docker Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate LiveG24 scraping/streaming from Mac+GoLogin to VPS+Camoufox with Docker, enabling multi-site/multi-game scalability.

**Architecture:** Two Hetzner VPS nodes — compute (Camoufox containers) and services (backend, MongoDB, OME, nginx). Site/game adapter pattern for extensibility. Docker Compose orchestration with health checks, log rotation, graceful shutdown.

**Tech Stack:** Node.js 20, Camoufox (Playwright), Docker Compose, ffmpeg, OvenMediaEngine, MongoDB 7, nginx, certbot

**Spec:** `docs/superpowers/specs/2026-03-27-liveg24-docker-migration-design.md`

**Source reference:** Mac scraper at `ssh mac-stream:~/Documents/liveg24_scrapping/` (~1300 lines across stream/, game/, lib/)

---

## Phase Overview

This project has 5 phases:

| Phase | What | Depends on |
|---|---|---|
| **Phase 1: Shared Libraries + Compute Scaffold** | browser.js, proxy-pool, user-pool, config, site/game adapters, Dockerfiles | Nothing |
| **Phase 2: Services Node** | Docker compose for backend, MongoDB, OME, nginx, certbot. Migrate from Hostinger | Phase 1 (for testing) |
| **Phase 3: Stream + Game Containers** | Port Mac stream/game logic to new adapters, dual video capture | Phase 1 |
| **Phase 4: Watchdog + E2E** | Infrastructure monitoring, E2E player simulation, Telegram alerts | Phase 2 + 3 |
| **Phase 5: Migration Cutover** | Parallel run, stop Mac, cancel old hosting | Phase 2 + 3 + 4 |

**Execute phases 1 and 2 in parallel if possible.** Phase 3 requires phase 1 shared libs. Phase 4 requires everything running.

### Important: Repo Layout vs Docker Runtime Layout

The repo has `services/shared/`, `services/stream/src/`, `services/game/src/`. But inside Docker containers:
- Stream/Game source: `/app/src/` (from `COPY src/ ./src/`)
- Shared libs: `/app/shared/` (from volume `./services/shared:/app/shared:ro`)
- State: `/app/state/` (from volume `./state:/app/state`)

**All imports from stream/game source must use `../shared/...`** (one level up from `/app/src/` to `/app/shared/`), not `../../shared/...`.

### Which Compose File Runs Where

- **Compute node** (`liveg24-compute`): runs `docker-compose.yml` at repo root — stream + game containers
- **Services node** (`liveg24-services`): runs `services-compose/docker-compose.yml` — backend, MongoDB, OME, nginx, watchdog

These are separate compose files on separate servers. Never run the wrong one.

---

## Phase 1: Shared Libraries + Compute Scaffold

### Task 1.1: Initialize Repository and Project Structure

**Files:**
- Create: `liveg24-docker/package.json`
- Create: `liveg24-docker/.gitignore`
- Create: `liveg24-docker/.env.example`
- Create: `liveg24-docker/.env.users.example`
- Create: `liveg24-docker/docker-compose.yml` (compute)
- Create: `liveg24-docker/services/stream/Dockerfile`
- Create: `liveg24-docker/services/stream/package.json`
- Create: `liveg24-docker/services/game/Dockerfile`
- Create: `liveg24-docker/services/game/package.json`
- Create: `liveg24-docker/state/.gitkeep`

**Where:** Create locally at `C:\Users\philp\Downloads\liveg24-docker\`

- [ ] **Step 1: Create GitHub repo**

```bash
mkdir -p C:/Users/philp/Downloads/liveg24-docker
cd C:/Users/philp/Downloads/liveg24-docker
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "liveg24-docker",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.env
.env.users
state/user-state.json
backups/
```

- [ ] **Step 4: Create .env.example with all keys (no real values)**

Copy from spec section 10, all values as `<placeholder>`.

- [ ] **Step 5: Create .env.users.example**

```
# Format: SITE_USER_N=username:password
NETWIN_USER_1=<username>:<password>
```

- [ ] **Step 6: Create compute docker-compose.yml**

From spec section 2 — stream + game services with env_file, volumes, healthcheck, logging, resource limits.

- [ ] **Step 7: Create stream Dockerfile**

From spec section 4 — node:20-bookworm + xvfb + ffmpeg + pulseaudio + tini + camoufox-js.

- [ ] **Step 8: Create game Dockerfile**

From spec section 4 — same but without ffmpeg/pulseaudio.

- [ ] **Step 9: Create stream/package.json and game/package.json**

Both need: `camoufox-js` (bundles `playwright` as transitive dep — no separate install needed).
Shared deps: `lockfile` (for user-state file locking).

```json
{
  "name": "liveg24-stream",
  "private": true,
  "type": "module",
  "dependencies": {
    "camoufox-js": "^0.4",
    "lockfile": "^1.0"
  }
}
```

- [ ] **Step 10: Generate package-lock.json for each service**

```bash
cd services/stream && npm install && cd ../game && npm install && cd ../..
```

This generates `package-lock.json` needed by `npm ci` in the Dockerfiles.

- [ ] **Step 11: Create state/.gitkeep**

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: initialize project structure with Dockerfiles and compose"
```

---

### Task 1.2: Config Loader

**Files:**
- Create: `liveg24-docker/services/shared/config.js`

- [ ] **Step 1: Write config.js**

Reads all env vars with defaults. Groups: services, ome, backend, proxy, telegram, capture, timing.
Reference: spec section 10 for all keys. Mac `stream/config.js` for structure.

```js
// services/shared/config.js
export const config = {
  serviceName: process.env.SERVICE_NAME || 'unknown',
  site: process.env.SITE || 'netwin',
  game: process.env.GAME || 'roulette',
  gameId: process.env.GAME_ID || '9_201',
  streamKey: process.env.STREAM_KEY || 'roulette-macao',

  services: {
    host: process.env.SERVICES_HOST || 'localhost',
  },
  ome: {
    rtmpUrl: process.env.OME_RTMP_URL || 'rtmp://localhost:1935/app',
  },
  backend: {
    url: process.env.BACKEND_URL || 'http://localhost:5000/api/v1',
    apiKey: process.env.BACKEND_API_KEY || '',
  },
  proxy: {
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || '',
    apiToken: process.env.PROXY_API_TOKEN || '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  capture: {
    mode: process.env.CAPTURE_MODE || 'direct',
    resolution: process.env.STREAM_RESOLUTION || '1280x720',
    fps: process.env.STREAM_FPS || '30',
    bitrate: process.env.STREAM_BITRATE || '4000k',
    audioBitrate: process.env.AUDIO_BITRATE || '128k',
  },
  timing: {
    userSwitchMs: parseInt(process.env.USER_SWITCH_INTERVAL_MS || '900000'),
    loginTimeoutMs: parseInt(process.env.LOGIN_TIMEOUT_MS || '30000'),
    gameLoadTimeoutMs: parseInt(process.env.GAME_LOAD_TIMEOUT_MS || '30000'),
    heartbeatMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000'),
  },
  browser: {
    viewport: { width: 1300, height: 750 },
    popupViewport: { width: 1600, height: 900 },
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add services/shared/config.js
git commit -m "feat: add shared config loader from env vars"
```

---

### Task 1.3: Camoufox Browser Wrapper

**Files:**
- Create: `liveg24-docker/services/shared/browser.js`

Reference: Mac `stream/lib/browser.js` (210 lines). Replace GoLogin with Camoufox. Keep same interface: `createBrowser(user, options)` → `{ page, browser }`, `closeBrowserFull(browser)`.

- [ ] **Step 1: Write browser.js**

Port from Mac browser.js:
- `createBrowser(user, proxy)` — launches Camoufox with `headless: "virtual"`, `geoip: true`, proxy config. Navigates to casino URL. Returns `{ page, browser, context }`.
- `closeBrowserFull(browser)` — closes browser context gracefully.
- `ensurePageInFront(page)` — brings page to front (simplified for Playwright).
- Error handling: proxy rotation on failure (delegates to proxy-pool).

Key differences from Mac:
- `Camoufox()` instead of `GoLogin` + `puppeteer.connect()`
- Playwright API instead of Puppeteer (`page.fill` vs `page.type`, `context.waitForEvent('page')` for popups)
- No GoLogin profile management
- Virtual display handled by xvfb in Docker, not GoLogin's Orbita

```js
// services/shared/browser.js
import { Camoufox } from 'camoufox-js'
import { config } from './config.js'

export async function createBrowser(proxy) {
  const browser = await Camoufox({
    headless: 'virtual',
    geoip: true,
    proxy: proxy ? {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    } : undefined,
  })

  const page = await browser.newPage()
  return { page, browser }
}

export async function closeBrowserFull(browser) {
  try { await browser.close() } catch (_) {}
}

export async function ensurePageInFront(page) {
  try {
    await page.bringToFront()
    await new Promise(r => setTimeout(r, 300))
  } catch (e) {
    console.log('Could not bring page to front:', e.message)
  }
}
```

- [ ] **Step 2: Verify Camoufox launches in Docker**

Build stream Docker image and test browser launch:
```bash
cd services/stream
docker build -t liveg24-stream-test .
docker run --rm liveg24-stream-test node -e "
  import('camoufox-js').then(async ({Camoufox}) => {
    const b = await Camoufox({headless:'virtual'});
    const p = await b.newPage();
    await p.goto('https://example.com');
    console.log('Title:', await p.title());
    await b.close();
    console.log('OK');
  })
"
```

Expected: `Title: Example Domain` then `OK`.

- [ ] **Step 3: Commit**

```bash
git add services/shared/browser.js
git commit -m "feat: add Camoufox browser wrapper replacing GoLogin"
```

---

### Task 1.4: Proxy Pool

**Files:**
- Create: `liveg24-docker/services/shared/proxy-pool.js`

Reference: Mac `lib/proxy-pool.js` (170 lines). Port directly — same logic, same API.

- [ ] **Step 1: Write proxy-pool.js**

Port from Mac proxy-pool.js:
- `initProxyPool()` — fetches 100 IT residential proxies from Webshare API:
  - Endpoint: `https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=100`
  - Auth header: `Authorization: Token <PROXY_API_TOKEN>`
  - Response: `{ results: [{ proxy_address: "82.26.75.27", port: 6737, ... }] }`
  - Use `config.proxy.username` / `config.proxy.password` for proxy auth (same for all IPs)
- `getProxyForContainer(containerName)` → proxy object `{ host, port, username, password }`
- `getCurrentProxyForProfile(id)` → current assigned proxy
- `blacklistProxy(proxy, severity)` — soft (10 min) or hard (30 min)
- `getPoolStats()` → `{ total, available, blacklisted }`
- Round-robin assignment, on-failure rotation

Key change: replace "profile" concept with "container" concept (since no GoLogin profiles).

```js
// Use container SERVICE_NAME as the key instead of GoLogin profile ID
export function getProxyForContainer(containerName) { ... }
export function blacklistProxy(proxy, severity) { ... }
```

- [ ] **Step 2: Commit**

```bash
git add services/shared/proxy-pool.js
git commit -m "feat: add proxy pool with Webshare rotation and blacklist"
```

---

### Task 1.5: User Pool with Dual Cooldown

**Files:**
- Create: `liveg24-docker/services/shared/user-pool.js`

- [ ] **Step 1: Write user-pool.js**

New file — no Mac equivalent (Mac uses hardcoded user list in DB).

- Reads `.env.users` → parses `SITE_USER_N=username:password` entries
- File-based state at `/app/state/user-state.json` with `lockfile` for safety
- Methods:
  - `loadUsers(site)` → array of `{ username, password }`
  - `getNextUser(site, excludeUsername, containerName)` → user or null
  - `markActive(site, username, containerName, proxyIp)`
  - `markCooldown(site, username)` — 30 min cooldown
  - `markBlocked(site, username, reason)` — 2h block
  - `releaseAll(containerName)` — cleanup on shutdown
  - `getStatus()` → summary for watchdog

State format per spec section 8. File locking pattern:

```js
import lockfile from 'lockfile'
const STATE_PATH = '/app/state/user-state.json'
const LOCK_PATH = '/app/state/user-state.lock'

function withLock(fn) {
  return new Promise((resolve, reject) => {
    lockfile.lock(LOCK_PATH, { wait: 5000, stale: 10000 }, async (err) => {
      if (err) return reject(err)
      try {
        const result = await fn()
        resolve(result)
      } finally {
        lockfile.unlock(LOCK_PATH, () => {})
      }
    })
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add services/shared/user-pool.js
git commit -m "feat: add user pool with dual cooldown (user + proxy)"
```

---

### Task 1.6: Site Adapter — Base + Netwin

**Files:**
- Create: `liveg24-docker/services/shared/site-adapters/base.js`
- Create: `liveg24-docker/services/shared/site-adapters/netwin.js`
- Create: `liveg24-docker/services/shared/site-adapters/index.js`

Reference: Mac `stream/lib/setup.js` (357 lines) — the netwin adapter extracts all site-specific logic from this file.

- [ ] **Step 1: Write base.js**

```js
export class BaseSiteAdapter {
  name = 'base'
  casinoUrl = ''

  async acceptCookies(page) { throw new Error('Not implemented') }
  async login(page, username, password) { throw new Error('Not implemented') }
  async navigateToLobby(page) { throw new Error('Not implemented') }
  async isLoggedIn(page) { return false }
  async handleRelogin(page, username, password) { throw new Error('Not implemented') }
  async openGame(page, gameId, context) { throw new Error('Not implemented') }
  async walletTransfer(popupPage, amount) { throw new Error('Not implemented') }
  async gracefulExit(popupPage) { throw new Error('Not implemented') }
}
```

- [ ] **Step 2: Write netwin.js**

Port from Mac `stream/lib/setup.js`. Extract all netwin-specific selectors and logic:
- `SELECTORS` object (cookie, login, modal, game buttons, wallet, game container, etc.)
- `GAME_BUTTON_ONCLICK` pattern: `showSingleGame_full('${gameId}',1,'')`
- `acceptCookies()` — click `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`
- `login()` — fill `#cg-username`, `#cg-password`, click `a.bottone-login`
- `handleRelogin()` — detect and fill `#cg-modal-login-username/password`
- `navigateToLobby()` — goto casino URL, wait for game buttons
- `isLoggedIn()` — check body text for "MdR" or "Saldo"
- `openGame()` — find button with matching onclick, click, wait for popup via `context.waitForEvent('page')` or poll `context.pages()`
- `walletTransfer()` — fill `input[name="amountInput"]` with random 1-5, click submit
- `gracefulExit()` — click `.ico-exit` → wait → click "OK"

**IMPORTANT:** Use Playwright API, not Puppeteer:
- `page.fill()` instead of `page.type()` (clears first)
- `page.$()` returns `ElementHandle` (same as Puppeteer)
- `context.on('page', handler)` for popup detection
- `page.click(selector, { force: true })` for hidden elements

- [ ] **Step 3: Write index.js loader**

```js
import { NetwinAdapter } from './netwin.js'

const adapters = { netwin: NetwinAdapter }

export function loadSiteAdapter(siteName) {
  const Adapter = adapters[siteName]
  if (!Adapter) throw new Error(`Unknown site adapter: ${siteName}`)
  return new Adapter()
}
```

- [ ] **Step 4: Test netwin adapter against live site**

Run from VPS test directory (already has Camoufox installed):
```bash
ssh scraper-vps "cd /root/liveg24-camoufox-test && node test-netwin-adapter.js"
```

Verify: cookies accepted, login works, lobby loads, game button found.

- [ ] **Step 5: Commit**

```bash
git add services/shared/site-adapters/
git commit -m "feat: add site adapter pattern with netwin.it implementation"
```

---

### Task 1.7: Game Adapter — Base + Roulette

**Files:**
- Create: `liveg24-docker/services/shared/game-adapters/base.js`
- Create: `liveg24-docker/services/shared/game-adapters/roulette.js`
- Create: `liveg24-docker/services/shared/game-adapters/index.js`

Reference: Mac `stream/lib/setup.js` lines 196-280 (game box selectors, play button, limit element, hide UI).

- [ ] **Step 1: Write base.js**

```js
export class BaseGameAdapter {
  name = 'base'
  gameBoxSelector = ''
  playButtonSelector = ''
  containerSelector = '.mlc-box-container'
  limitElementSelector = '.limit-element'
  hideSelectors = []

  async waitForGameReady(popupPage) { throw new Error('Not implemented') }
  async selectTable(popupPage) { throw new Error('Not implemented') }
  async parseResult(popupPage) { return null }
  async getStreamSource(popupPage) { return null }
  async hideUI(popupPage) { throw new Error('Not implemented') }
}
```

- [ ] **Step 2: Write roulette.js**

Extract from Mac setup.js:
- `gameBoxSelector`: `.game-box.roulette.RL_GREEN_TEMPLATE`
- `playButtonSelector`: `.game-box.roulette.RL_GREEN_TEMPLATE .play-game`
- `hideSelectors`: the full list from Mac `SELECTORS.hideInPopup`
- `waitForGameReady()`: wait for `.mlc-box-container`
- `selectTable()`: click lowest `.limit-element`
- `parseResult()`: read last result number from roulette UI
- `getStreamSource()`: try to extract `<video>` src URL
- `hideUI()`: hide all overlay elements for clean video capture

- [ ] **Step 3: Write index.js loader**

```js
import { RouletteAdapter } from './roulette.js'

const adapters = { roulette: RouletteAdapter }

export function loadGameAdapter(gameName) {
  const Adapter = adapters[gameName]
  if (!Adapter) throw new Error(`Unknown game adapter: ${gameName}`)
  return new Adapter()
}
```

- [ ] **Step 4: Commit**

```bash
git add services/shared/game-adapters/
git commit -m "feat: add game adapter pattern with roulette implementation"
```

**Note:** Baccarat adapter is deferred. It will be added after roulette is fully working end-to-end. The adapter pattern makes this trivial — create `baccarat.js`, register in `index.js`, add compose services. The Mac repo already has baccarat code at `baccarat/lib/setup.js` for reference.

---

## Phase 2: Services Node

### Task 2.1: Services Docker Compose

**Files:**
- Create: `liveg24-docker/services-compose/docker-compose.yml`
- Create: `liveg24-docker/services-compose/.env.example`
- Create: `liveg24-docker/services-compose/nginx/conf.d/default.conf`
- Create: `liveg24-docker/services-compose/ome/Server.xml`

- [ ] **Step 1: Create services docker-compose.yml**

From spec section 3. All services: roulette-backend, admin-backend, admin-frontend, mongodb (with auth + healthcheck), OME, nginx, certbot, watchdog, mongo-backup.

- [ ] **Step 2: Create nginx config**

Reverse proxy:
- `alphatest.live` → `roulette-backend:5000`
- `admin.alphatest.live` → `admin-frontend:3001`
- `server.alphatest.live` → `admin-backend:3002`
- `server.alphatest.live/watchdog/` → `watchdog:7777`
- SSL with certbot, ACME challenge path

- [ ] **Step 3: Copy OME Server.xml from existing streaming VPS**

```bash
scp liveg24-streaming:/root/ome/Server.xml services-compose/ome/Server.xml
```

- [ ] **Step 4: Create .env.example for services**

```env
MONGO_USER=<mongo-admin-user>
MONGO_PASS=<mongo-admin-password>
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat-id>
```

- [ ] **Step 5: Commit**

```bash
git add services-compose/
git commit -m "feat: add services node Docker Compose with nginx, OME, MongoDB"
```

---

### Task 2.2: Provision Services VPS and Deploy

**Prerequisites:** Hetzner account, Cloudflare DNS access.

- [ ] **Step 1: Create Hetzner CX22 VPS**

Via Hetzner Cloud console or CLI. Location: Nuremberg. OS: Ubuntu 24.04.
Save IP as `<services-ip>`.

- [ ] **Step 2: Install Docker on VPS**

```bash
ssh root@<services-ip>
curl -fsSL https://get.docker.com | sh
```

- [ ] **Step 3: Configure SSH alias**

Add to local `~/.ssh/config`:
```
Host liveg24-services
    HostName <services-ip>
    User root
```

- [ ] **Step 4: Configure UFW firewall**

```bash
ssh liveg24-services "ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 3333 && ufw allow 3334 && ufw deny 1935 && ufw deny 5000 && ufw deny 7777 && ufw enable"
```

Ports 1935/5000/7777 are denied by default — compute IP will be allowed in Phase 3 Task 3.3.
```

- [ ] **Step 5: Clone repo and create .env**

```bash
ssh liveg24-services "git clone https://github.com/AgentNetworking/liveg24-docker.git && cd liveg24-docker/services-compose && cp .env.example .env"
```

Edit `.env` with real values.

- [ ] **Step 6: Migrate MongoDB from Hostinger**

```bash
# On Hostinger
ssh liveg24-hostinger "mongodump --db livecasino_liveg24 --out /tmp/mongo-backup --gzip"
scp -r liveg24-hostinger:/tmp/mongo-backup ./mongo-backup

# To new services VPS
scp -r ./mongo-backup liveg24-services:/root/liveg24-docker/services-compose/backups/

# On services VPS: start only mongo, restore, then start all
ssh liveg24-services "cd liveg24-docker/services-compose && docker compose up -d mongodb && sleep 10 && docker compose exec mongodb mongorestore --gzip /backups/mongo-backup/ && docker compose up -d"
```

- [ ] **Step 7: Update Cloudflare DNS**

Point all domains to `<services-ip>`:
- `alphatest.live` → A record → `<services-ip>`
- `admin.alphatest.live` → A record → `<services-ip>`
- `server.alphatest.live` → A record → `<services-ip>`
- `stream.alphatest.live` → A record → `<services-ip>`

- [ ] **Step 8: Obtain SSL certificates**

```bash
ssh liveg24-services "cd liveg24-docker/services-compose && docker compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot -d alphatest.live -d admin.alphatest.live -d server.alphatest.live -d stream.alphatest.live"
```

- [ ] **Step 9: Verify alphatest.live loads**

Open `https://alphatest.live` in browser. Should show the roulette frontend.
Open `https://admin.alphatest.live` — should show admin panel.

- [ ] **Step 10: Commit any config adjustments**

---

## Phase 3: Stream + Game Containers

### Task 3.1: Stream Container — Entry Point + Capture

**Files:**
- Create: `liveg24-docker/services/stream/src/index.js`
- Create: `liveg24-docker/services/stream/src/capture-direct.js`
- Create: `liveg24-docker/services/stream/src/capture-display.js`
- Create: `liveg24-docker/services/stream/src/health.js`
- Create: `liveg24-docker/services/stream/src/audio-bridge.js`

Reference: Mac `stream/run.js` (373 lines), `stream/lib/capture.js` (85 lines), `stream/lib/audio-bridge.js` (42 lines).

**Note on PulseAudio:** The stream Dockerfile CMD must start PulseAudio before Node:
```
CMD ["sh", "-c", "Xvfb :99 -screen 0 $RESOLUTION -ac &>/dev/null & pulseaudio -D & sleep 1 && exec node src/index.js"]
```
Update the Dockerfile from Task 1.1 Step 7 accordingly. PulseAudio captures browser audio automatically — Camoufox/Firefox outputs to the default PulseAudio sink.

- [ ] **Step 1: Write health.js**

Simple HTTP health endpoint on port 8080 for Docker healthcheck.

```js
import http from 'node:http'

let healthy = false
export function setHealthy(val) { healthy = val }

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(healthy ? 200 : 503)
    res.end(healthy ? 'OK' : 'NOT READY')
  }
}).listen(8080)
```

- [ ] **Step 2: Write capture-direct.js**

Primary capture — intercept `<video>` source URL, re-stream via ffmpeg without re-encoding.

```js
import { spawn } from 'node:child_process'
import { config } from '../shared/config.js'

export async function captureDirectStream(popupPage, streamKey) {
  const mediaUrl = await popupPage.evaluate(() => {
    const video = document.querySelector('video')
    if (!video) return null
    if (video.src && video.src.startsWith('http')) return video.src
    const source = video.querySelector('source')
    if (source?.src) return source.src
    return null
  })

  if (!mediaUrl) return null

  const ffmpeg = spawn('ffmpeg', [
    '-i', mediaUrl,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', config.capture.audioBitrate,
    '-f', 'flv',
    `${config.ome.rtmpUrl}/${streamKey}`
  ])

  ffmpeg.stderr.on('data', d => console.log('[ffmpeg-direct]', d.toString().trim()))
  return { mode: 'direct', process: ffmpeg }
}
```

- [ ] **Step 3: Write capture-display.js**

Fallback capture — x11grab from virtual display.

```js
import { spawn } from 'node:child_process'
import { config } from '../shared/config.js'

export function captureFromDisplay(streamKey) {
  const { resolution, fps, bitrate, audioBitrate } = config.capture

  const ffmpeg = spawn('ffmpeg', [
    '-f', 'x11grab', '-framerate', fps, '-video_size', resolution, '-i', ':99',
    '-f', 'pulse', '-i', 'default',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-crf', '23', '-maxrate', bitrate, '-bufsize', '2000k', '-g', '60',
    '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100',
    '-f', 'flv',
    `${config.ome.rtmpUrl}/${streamKey}`
  ])

  ffmpeg.stderr.on('data', d => console.log('[ffmpeg-display]', d.toString().trim()))
  return { mode: 'display', process: ffmpeg }
}
```

- [ ] **Step 4: Write audio-bridge.js**

Port from Mac `stream/lib/audio-bridge.js` (42 lines). On VPS with PulseAudio, this is simpler — PulseAudio captures browser audio natively. The audio-bridge provides a monitoring wrapper:

```js
// audio-bridge.js — monitors PulseAudio is capturing audio
export function checkAudioActive() {
  // PulseAudio auto-captures Firefox audio on Linux
  // This module monitors that the audio sink has active input
  // Used by health check to report audio status
}
```

If direct capture mode is used (`-c:a copy`), no audio-bridge is needed. For display capture, ffmpeg reads from PulseAudio directly (`-f pulse -i default`).

- [ ] **Step 5: Write index.js — main stream loop**

Port from Mac `stream/run.js`. Core loop:
1. Load site + game adapters from env
2. Get user from user-pool, proxy from proxy-pool
3. Create Camoufox browser
4. Login → navigate lobby → open game → wallet transfer → select table → hide UI
5. Start capture (try direct, fallback display)
6. On SIGTERM: graceful exit
7. On timer (USER_SWITCH_INTERVAL_MS): switch user — graceful exit → stop capture → close browser → get next user → repeat from 3
8. On error: blacklist proxy/user as needed → retry

Reference Mac `stream/run.js` for the switch loop pattern with `setTimeout`.

Key structure:
```js
import { config } from '../shared/config.js'
import { loadSiteAdapter } from '../shared/site-adapters/index.js'
import { loadGameAdapter } from '../shared/game-adapters/index.js'
import { createBrowser, closeBrowserFull } from '../shared/browser.js'
import { initProxyPool, getProxyForContainer } from '../shared/proxy-pool.js'
import * as userPool from '../shared/user-pool.js'
import { captureDirectStream } from './capture-direct.js'
import { captureFromDisplay } from './capture-display.js'
import { setHealthy } from './health.js'
import './health.js'

const site = loadSiteAdapter(config.site)
const game = loadGameAdapter(config.game)

// Capture with automatic fallback:
let capture = await captureDirectStream(popupPage, config.streamKey)
if (!capture) {
  console.log('Direct capture unavailable, falling back to display capture')
  capture = captureFromDisplay(config.streamKey)
}

// SIGTERM handler — kill ffmpeg, graceful exit, close browser:
let currentCapture = null
let currentPopup = null
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...')
  if (currentCapture?.process) currentCapture.process.kill('SIGTERM')
  if (currentPopup) await site.gracefulExit(currentPopup).catch(() => {})
  if (currentBrowser) await closeBrowserFull(currentBrowser)
  process.exit(0)
})
```

- [ ] **Step 6: Commit**

```bash
git add services/stream/src/
git commit -m "feat: add stream container with dual capture and user switching"
```

---

### Task 3.2: Game Container — Entry Point + Result Loop

**Files:**
- Create: `liveg24-docker/services/game/src/index.js`
- Create: `liveg24-docker/services/game/src/result-loop.js`
- Create: `liveg24-docker/services/game/src/health.js`

Reference: Mac `game/run.js` (207 lines), `game/lib/setup.js` (239 lines).

- [ ] **Step 1: Write health.js**

Same as stream health.js — port 8080, `/health` endpoint.

- [ ] **Step 2: Write result-loop.js**

Polls game adapter `parseResult()` at regular intervals, POSTs new results to backend API.

```js
import { config } from '../shared/config.js'

export async function startResultLoop(popupPage, gameAdapter) {
  let lastResult = null

  const poll = async () => {
    try {
      const result = await gameAdapter.parseResult(popupPage)
      if (result && JSON.stringify(result) !== JSON.stringify(lastResult)) {
        lastResult = result
        console.log('New result:', result)
        await fetch(`${config.backend.url}/results`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.backend.apiKey,
          },
          body: JSON.stringify({
            game: config.game,
            gameId: config.gameId,
            ...result,
          }),
        })
      }
    } catch (err) {
      console.error('Result poll error:', err.message)
    }
  }

  return setInterval(poll, 2000) // poll every 2s
}
```

- [ ] **Step 3: Write index.js — main game loop**

Same pattern as stream index.js but simpler — no capture, just result polling.
1. Load adapters, get user + proxy
2. Create browser, login, navigate, open game, select table
3. Start result-loop
4. On switch timer: stop loop, graceful exit, switch user
5. On SIGTERM: graceful exit

- [ ] **Step 4: Commit**

```bash
git add services/game/src/
git commit -m "feat: add game container with result scraping and user switching"
```

---

### Task 3.3: Provision Compute VPS and Deploy

- [ ] **Step 1: Create Hetzner CX32 VPS**

Location: Nuremberg. OS: Ubuntu 24.04. Save IP.

- [ ] **Step 2: Install Docker, configure SSH alias `liveg24-compute`**

- [ ] **Step 3: Add compute IP to services UFW firewall**

```bash
ssh liveg24-services "ufw allow from <compute-ip> to any port 1935 && ufw allow from <compute-ip> to any port 5000 && ufw allow from <compute-ip> to any port 7777"
```

- [ ] **Step 4: Clone repo, create .env and .env.users with real values**

- [ ] **Step 5: Build and start**

```bash
ssh liveg24-compute "cd liveg24-docker && docker compose build && docker compose up -d"
```

- [ ] **Step 6: Verify stream appears on OME**

Check `https://stream.alphatest.live` — video should be playing.

- [ ] **Step 7: Verify game results arriving at backend**

Check MongoDB for new results:
```bash
ssh liveg24-services "docker compose exec mongodb mongosh livecasino_liveg24 --eval 'db.history_roulette1.find().sort({_id:-1}).limit(3)'"
```

- [ ] **Step 8: Commit any deploy fixes**

---

## Phase 4: Watchdog + E2E

### Task 4.1: Watchdog Container

**Files:**
- Create: `liveg24-docker/services-compose/services/watchdog/package.json`
- Create: `liveg24-docker/services-compose/services/watchdog/Dockerfile`
- Create: `liveg24-docker/services-compose/services/watchdog/src/index.js`
- Create: `liveg24-docker/services-compose/services/watchdog/src/health-checks.js`
- Create: `liveg24-docker/services-compose/services/watchdog/src/telegram.js`

Reference: Hostinger `/home/liveg24/watchdog/server.js`, Vincitu `lib/telegram.ts` for alert pattern.

- [ ] **Step 0: Create watchdog Dockerfile and package.json**

Dockerfile from spec section 4 (node:20-alpine). Package.json needs: `dockerode` (Docker API client for local container inspection via mounted socket `/var/run/docker.sock`).

The services `docker-compose.yml` already mounts the Docker socket for the watchdog.

- [ ] **Step 1: Write telegram.js**

Alert sender with cooldown: critical 2min, warning 10min, info 60min. State machine for transitions (alert → recovery).

- [ ] **Step 2: Write health-checks.js**

All 6 infrastructure checks from spec section 9:
- Container health (Docker socket for local, heartbeat HTTP for remote)
- Heartbeat staleness tracking
- OME TCP reachability
- Backend HTTP health
- Stream active on OME
- User pool status (via heartbeat payload)

- [ ] **Step 3: Write index.js**

HTTP server on port 7777:
- `POST /heartbeat` — receive heartbeat from compute containers
- `GET /status` — JSON status for admin panel
- Runs all health checks on their intervals
- Sends Telegram alerts on state transitions

- [ ] **Step 4: Add heartbeat sender to stream and game index.js**

Both compute containers send periodic POST to `http://<services-ip>:7777/heartbeat` with:
```json
{
  "service": "stream-roulette-netwin",
  "user": "lollo13",
  "proxy": "82.26.75.27",
  "ffmpegAlive": true,
  "browserAlive": true,
  "lastResult": { "number": 32, "timestamp": 1711540800 }
}
```

- [ ] **Step 5: Deploy watchdog, verify Telegram alerts**

- [ ] **Step 6: Commit**

```bash
git add services-compose/services/watchdog/
git commit -m "feat: add watchdog with health checks and Telegram alerts"
```

---

### Task 4.2: E2E Player Simulation

**Files:**
- Create: `liveg24-docker/services-compose/services/watchdog/src/e2e-check.js`

- [ ] **Step 1: Write e2e-check.js**

Uses Playwright (vanilla, not Camoufox — our own site doesn't need antidetect) to simulate player on alphatest.live.

6 checks from spec section 9:
1. Frontend load
2. Player login (watchdog-test account)
3. Video stream active
4. UI components visible
5. Bet flow (every 15 min)
6. Error detection with known patterns

- [ ] **Step 2: Create watchdog-test player account on backend**

- [ ] **Step 3: Integrate into watchdog main loop**

Run E2E every 5 min. Bet flow every 15 min. Report to Telegram.

- [ ] **Step 4: Test E2E checks**

- [ ] **Step 5: Commit**

```bash
git add services-compose/services/watchdog/src/e2e-check.js
git commit -m "feat: add E2E player simulation with video/UI/bet verification"
```

---

## Phase 5: Migration Cutover

### Task 5.1: Final Verification and Cutover

- [ ] **Step 1: Run full system for 1 hour alongside Mac scrapers**

Both VPS and Mac running in parallel. Verify:
- Stream quality on VPS >= Mac
- Results arriving correctly
- No duplicate results in DB
- Watchdog all green
- E2E all passing

- [ ] **Step 2: Stop Mac scrapers**

```bash
ssh mac-stream "pkill -f 'npm run stream'"
ssh mac-game "pkill -f 'npm run game'"
```

Keep Mac as cold backup — don't uninstall anything.

- [ ] **Step 3: Monitor for 24 hours**

Watch Telegram alerts. Check stream quality. Verify user switching works across multiple cycles.

- [ ] **Step 4: Cancel Hostinger**

After confirming services VPS is stable.

- [ ] **Step 5: Cancel old Hetzner streaming VPS**

After confirming OME works on services node.

- [ ] **Step 6: Update memory**

Update `liveg24-project.md` with new architecture, IPs, and status.
