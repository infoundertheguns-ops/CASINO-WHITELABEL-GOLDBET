# LiveG24 Docker Migration — Design Spec

**Date**: 2026-03-27
**Status**: Approved
**Scope**: Migrate LiveG24 scraping from Mac+GoLogin to VPS+Camoufox with Docker, improve video/audio quality, enable multi-site and multi-game scalability.

---

## 1. Architecture Overview

### Server Layout

| Server | Spec | Role | Cost |
|---|---|---|---|
| **liveg24-compute-1** | Hetzner CX32 (4 vCPU, 8GB RAM) | Camoufox stream + game containers (stateless) | ~€15/mese |
| **liveg24-services** | Hetzner CX22 (2 vCPU, 4GB RAM) | Backend, Admin, MongoDB, OME, Nginx, Watchdog | ~€8/mese |

Total: ~€23/mese. Replaces: 2 Mac fisici + Hostinger + Hetzner streaming.

### Scaling Model

- **Compute nodes are stateless** — no persistent data, only browsers + ffmpeg. Destroy/recreate in minutes.
- **Services node holds all state** — MongoDB, config, streams.
- To scale: add compute-2, compute-3 nodes. Services scales vertically (CX22 → CX32).

### Data Flow

```
[Player browser]
    ↓ https://alphatest.live
[nginx :443] → [roulette-backend :5000] → [mongodb :27017]
    ↓
[OvenPlayer WebRTC] → [OME :3333]
    ↑ RTMP
[stream container on compute-1] → [Camoufox → netwin.it → LiveG24 video]
[game container on compute-1]   → [Camoufox → netwin.it → risultati] → [roulette-backend on services]
```

---

## 2. Compute Node — Docker Compose

### Repository

`AgentNetworking/liveg24-docker` (new GitHub repo)

### File Structure

```
liveg24-docker/
├── docker-compose.yml
├── .env                              # global config (gitignored)
├── .env.users                        # user credentials per site (gitignored)
├── .env.example
├── .env.users.example
├── services/
│   ├── stream/
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.js              # entry: loads SITE + GAME adapters, runs loop
│   │       ├── capture-direct.js     # primary: intercept <video> src, re-stream without re-encoding
│   │       ├── capture-display.js    # fallback: x11grab virtual display → ffmpeg → RTMP
│   │       └── audio-bridge.js       # browser audio capture → ffmpeg pipe
│   ├── game/
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.js              # entry: loads SITE + GAME adapters, scrapes results
│   │       └── result-loop.js        # polling results, POST to backend API
│   └── shared/                       # mounted as read-only volume in stream + game
│       ├── browser.js                # Camoufox wrapper (replaces GoLogin browser.js)
│       ├── proxy-pool.js             # Webshare proxy rotation, soft/hard blacklist
│       ├── user-pool.js              # multi-site user management, cooldown tracking
│       ├── config.js                 # env var loader
│       ├── site-adapters/
│       │   ├── base.js               # interface: login, acceptCookies, navigateLobby, gracefulExit
│       │   ├── netwin.js             # netwin.it implementation
│       │   └── (betflag.js, ...)     # future sites
│       └── game-adapters/
│           ├── base.js               # interface: openGame, parseResult, getStreamSource, hideUI
│           ├── roulette.js           # Roulette Macao
│           └── baccarat.js           # Baccarat Macao
```

### docker-compose.yml (compute node)

```yaml
services:
  stream-roulette-netwin:
    build: ./services/stream
    env_file: [.env, .env.users]
    environment:
      - SITE=netwin
      - GAME=roulette
      - GAME_ID=9_201
      - STREAM_KEY=roulette-macao
      - SERVICE_NAME=stream-roulette-netwin
    volumes:
      - ./services/shared:/app/shared:ro
      - ./state:/app/state              # writable: user-state.json lives here
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 1.5G
          cpus: "1.5"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1))"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging: &default-logging
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"

  game-roulette-netwin:
    build: ./services/game
    env_file: [.env, .env.users]
    environment:
      - SITE=netwin
      - GAME=roulette
      - GAME_ID=9_201
      - SERVICE_NAME=game-roulette-netwin
    volumes:
      - ./services/shared:/app/shared:ro
      - ./state:/app/state
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "0.75"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1))"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging: *default-logging

networks:
  default:
    name: liveg24
```

**Capacity per CX32 (4 vCPU, 8GB RAM)**: ~2 game pairs (stream + game). For 3+ games, add compute-2 node.

Adding a new game: append services to compose, write game adapter, `docker compose up -d`.
Adding a new site: write site adapter, add users to `.env.users`, append services.

---

## 3. Services Node — Docker Compose

```yaml
services:
  roulette-backend:
    build: ./services/roulette-backend
    ports: ["5000:5000"]
    depends_on:
      mongodb:
        condition: service_healthy
    environment:
      - MONGODB_URI=mongodb://${MONGO_USER}:${MONGO_PASS}@mongodb:27017/livecasino_liveg24?authSource=admin
    restart: unless-stopped
    logging: &default-logging
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"

  admin-backend:
    build: ./services/admin-backend
    ports: ["3002:3002"]
    depends_on:
      mongodb:
        condition: service_healthy
    restart: unless-stopped
    logging: *default-logging

  admin-frontend:
    build: ./services/admin-frontend
    ports: ["3001:3001"]
    restart: unless-stopped
    logging: *default-logging

  mongodb:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
      - ./backups:/backups
    # No ports exposed — accessible only via Docker network
    environment:
      - MONGO_INITDB_ROOT_USERNAME=${MONGO_USER}
      - MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASS}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging: *default-logging

  ome:
    image: airensoft/ovenmediaengine:latest
    ports:
      # RTMP: restricted to compute node IP via UFW firewall
      - "1935:1935"
      - "3333:3333"     # WebRTC output
      - "3334:3334"     # TCP relay
    volumes:
      - ./ome/Server.xml:/opt/ovenmediaengine/bin/origin_conf/Server.xml
    restart: unless-stopped
    logging: *default-logging

  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - certbot-certs:/etc/letsencrypt
      - certbot-www:/var/www/certbot
    depends_on: [roulette-backend, admin-backend, admin-frontend]
    restart: unless-stopped
    logging: *default-logging

  certbot:
    image: certbot/certbot
    volumes:
      - certbot-certs:/etc/letsencrypt
      - certbot-www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"
    restart: unless-stopped

  watchdog:
    build: ./services/watchdog
    ports: ["7777:7777"]
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
    restart: unless-stopped
    logging: *default-logging
    # Note: monitors remote compute containers via HTTP heartbeat,
    # monitors local services containers via Docker socket
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro

  # Daily MongoDB backup to /backups
  mongo-backup:
    image: mongo:7
    volumes:
      - ./backups:/backups
    environment:
      - MONGO_USER=${MONGO_USER}
      - MONGO_PASS=${MONGO_PASS}
    entrypoint: "/bin/sh -c 'while true; do mongodump --uri=\"mongodb://$${MONGO_USER}:$${MONGO_PASS}@mongodb:27017\" --out=/backups/$$(date +%Y%m%d) --gzip && find /backups -mtime +7 -type d -exec rm -rf {} + 2>/dev/null; sleep 86400; done'"
    depends_on:
      mongodb:
        condition: service_healthy
    restart: unless-stopped

volumes:
  mongo-data:
  certbot-certs:
  certbot-www:

networks:
  default:
    name: liveg24-services
```

### Inter-Node Networking

Compute → Services communication uses public IPs with UFW firewall rules:

```bash
# On services node — allow only compute node IP
ufw allow from <compute-ip> to any port 1935   # RTMP (OME)
ufw allow from <compute-ip> to any port 5000   # Backend API
ufw allow from <compute-ip> to any port 7777   # Watchdog heartbeat
ufw deny 1935    # block RTMP from all other IPs
ufw deny 5000    # block backend from all other IPs
```

If security requirements increase, upgrade to WireGuard tunnel or Hetzner private network.

DNS (Cloudflare):
- `alphatest.live` → services IP
- `admin.alphatest.live` → services IP
- `server.alphatest.live` → services IP
- `stream.alphatest.live` → services IP (OME now on same server)

---

## 4. Dockerfiles

### Stream (heaviest — ~1.5GB)

```dockerfile
FROM node:20-bookworm
RUN apt-get update && apt-get install -y \
    xvfb ffmpeg pulseaudio \
    libgtk-3-0 libdbus-glib-1-2 libasound2 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
RUN node -e "require('camoufox-js')"
COPY src/ ./src/
ENV DISPLAY=:99
ENV RESOLUTION=1280x720x24
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "Xvfb :99 -screen 0 $RESOLUTION -ac &>/dev/null & sleep 1 && exec node src/index.js"]
```

Note: `tini` ensures SIGTERM is forwarded to the Node process, allowing graceful shutdown
(calling `gracefulExit()` to return funds to site wallet before container stops).
Handle SIGTERM in `index.js`:
```js
process.on('SIGTERM', async () => {
  await siteAdapter.gracefulExit(popupPage)
  await browser.close()
  process.exit(0)
})
```

### Game (lighter — ~1.2GB, no ffmpeg)

```dockerfile
FROM node:20-bookworm
RUN apt-get update && apt-get install -y \
    xvfb tini libgtk-3-0 libdbus-glib-1-2 libasound2 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
RUN node -e "require('camoufox-js')"
COPY src/ ./src/
ENV DISPLAY=:99
ENV RESOLUTION=1280x720x24
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "Xvfb :99 -screen 0 $RESOLUTION -ac &>/dev/null & sleep 1 && exec node src/index.js"]
```

### Watchdog (light — ~150MB)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY src/ ./src/
CMD ["node", "src/index.js"]
```

---

## 5. Site Adapters

Base interface every site adapter must implement:

```js
class BaseSiteAdapter {
  name = "base"
  casinoUrl = ""

  async acceptCookies(page) { }
  async login(page, username, password) { }
  async navigateToLobby(page) { }
  async isLoggedIn(page) { return false }
  async handleRelogin(page, username, password) { }
  async openGame(page, gameId) { /* returns popup page */ }
  async walletTransfer(popupPage, amount) { }
  async gracefulExit(popupPage) { /* returns funds to site wallet */ }
}
```

### Netwin Adapter

Replicates exact Mac setup.js logic:
- Cookie: `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`
- Login: `#cg-username`, `#cg-password`, `a.bottone-login`
- Re-login modal: `#cg-modal-login-username`, `#cg-modal-login-password`
- Game launch: find `.gioco1__rigaHover__bottoni__bottone` with matching `onclick` containing `showSingleGame_full(gameId)`
- Wallet: `input[name="amountInput"]` → random 1-5€ → `#submit-button-money-transfer`
- Exit: `.ico-exit` → wait → "OK" → funds returned

---

## 6. Game Adapters

Base interface:

```js
class BaseGameAdapter {
  name = "base"
  gameBoxSelector = ""
  playButtonSelector = ""
  containerSelector = ".mlc-box-container"
  limitElementSelector = ".limit-element"
  hideSelectors = []

  async waitForGameReady(popupPage) { }
  async selectTable(popupPage) { }
  async parseResult(popupPage) { return null }
  async getStreamSource(popupPage) { return null }
  async hideUI(popupPage) { }
}
```

### Roulette Adapter
- gameBox: `.game-box.roulette.RL_GREEN_TEMPLATE`
- playButton: `.game-box.roulette.RL_GREEN_TEMPLATE .play-game`
- parseResult → `{ number, color, timestamp }`
- getStreamSource → intercept `<video>` src

### Baccarat Adapter
- gameBox: `.game-box.baccarat`
- parseResult → `{ winner, playerScore, bankerScore, timestamp }`

---

## 7. Video Capture — Dual Strategy

### Primary: Direct Stream Interception

Intercept `<video>` source URL from LiveG24 game page. Re-stream to OME without re-encoding (`-c:v copy`). Maximum quality, minimum CPU.

### Fallback: Display Capture (x11grab)

Capture xvfb virtual display with ffmpeg. Used when video source is WebRTC (no extractable URL).

Settings (improved over current Mac):

| Setting | Mac current | New VPS |
|---|---|---|
| Video CRF | 25 | 23 or copy (direct) |
| Audio | MediaRecorder → WS → pipe | PulseAudio direct or copy |
| Latency | Manual sync | `-tune zerolatency` + PulseAudio |
| Resolution | Mac dependent | Configurable via env |
| Fallback | None | Automatic direct → display |

---

## 8. User Pool and Dual Cooldown

### Conservative dual cooldown:

- **User cooldown**: 30 min after switch
- **Proxy cooldown**: 10 min (soft, 403/blank) or 30 min (hard, dead proxy)
- **On switch**: rotate BOTH user AND proxy

### Shared state via file lock:

`user-state.json` on shared volume, `lockfile` npm for race condition safety between containers.

```json
{
  "netwin": {
    "users": {
      "coolboy88": { "status": "active", "container": "stream-roulette-netwin", "proxyIp": "82.26.75.27", "since": 1711540800 },
      "lollo13": { "status": "cooldown", "until": 1711542600 }
    },
    "proxyCooldown": {
      "82.26.75.27": { "until": 1711541400, "severity": "soft" }
    }
  }
}
```

### User source:

`.env.users` file:
```
NETWIN_USER_1=<username1>:<password1>
NETWIN_USER_2=<username2>:<password2>
NETWIN_USER_3=<username3>:<password3>
NETWIN_USER_4=<username4>:<password4>
NETWIN_USER_5=<username5>:<password5>
```

100 Webshare IT residential proxies available for rotation.

User-state file (`state/user-state.json`) lives on a shared bind mount (`./state`), writable by both stream and game containers. File locking via `lockfile` npm prevents race conditions.

---

## 9. Watchdog and E2E Monitoring

### Infrastructure Checks (watchdog container on services node):

| Check | Interval | What |
|---|---|---|
| Container health | 15s | Docker inspect, restart count |
| Heartbeat | 30s | HTTP POST from stream/game, alert if stale >90s |
| OME reachable | 60s | TCP check |
| Backend reachable | 60s | HTTP health endpoint |
| Stream active | 30s | OME API — stream key active, has bitrate |
| User pool | 5 min | Available users per site, alert if <2 |

### E2E Player Simulation (every 5 min):

Simulates real player on alphatest.live with dedicated `watchdog-test` account:

1. **Frontend load** — HTML loads, no JS errors
2. **Player login** — redirect to lobby, balance visible
3. **Video stream** — `<video>` present, playing, readyState=4
4. **UI components** — chips, bet table, results, balance, bet button all visible
5. **Bet flow** (every 15 min) — select chip, place bet, verify accepted, wait result, check balance update
6. **Error detection** — scan for visible error modals, known error patterns with explanations

### Known Error Patterns:

| Error text | Meaning |
|---|---|
| OOPS! SOMETHING WENT WRONG | Session expired — backend timeout |
| connection lost | WebSocket disconnected from game server |
| stream not available | OME stream down or wrong stream key |
| insufficient balance | Not enough funds for bet |
| game is closed | Table closed — off hours or maintenance |
| bet rejected | Limits exceeded or wrong timing |

### Telegram Alerts:

```
🔴 E2E ALERT: Video stream non funziona
   Video tag found but paused=true, readyState=1
   Causa: OME stream interrotto
   Azione: check stream container + OME

🟢 E2E OK: all checks passed
   Video: 1280x720, playing
   UI: 7/7 components visible
```

Cooldown: critical 2min, warning 10min, info 60min.

Note on E2E bet flow: uses `watchdog-test` account with minimum bet amount. Backend should have a test-mode flag for this account to avoid real wallet changes, or accept the ~€2-3/month cost of micro-bets. Monitor account balance and auto-top-up alert if below threshold.

---

## 10. Configuration (.env)

```env
# === Services Node ===
SERVICES_HOST=<services-ip>

# === OME ===
OME_RTMP_URL=rtmp://<services-ip>:1935/app
OME_PUBLIC_URL=wss://stream.alphatest.live:3333

# === Backend ===
BACKEND_URL=http://<services-ip>:5000/api/v1
BACKEND_API_KEY=<backend-api-key>

# === Proxy Webshare ===
PROXY_USERNAME=<webshare-user>
PROXY_PASSWORD=<webshare-pass>
PROXY_API_TOKEN=<webshare-api-token>

# === Telegram ===
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=543007368

# === Capture ===
CAPTURE_MODE=direct
STREAM_RESOLUTION=1280x720
STREAM_FPS=30
STREAM_BITRATE=4000k
AUDIO_BITRATE=128k

# === Timing ===
USER_SWITCH_INTERVAL_MS=900000
LOGIN_TIMEOUT_MS=30000
GAME_LOAD_TIMEOUT_MS=30000
HEARTBEAT_INTERVAL_MS=30000
```

---

## 11. Deploy and Operations

### Initial Setup

1. Create 2 Hetzner VPS (compute CX32 + services CX22)
2. Install Docker + Docker Compose on both
3. Clone `AgentNetworking/liveg24-docker` on both
4. Migrate MongoDB from Hostinger: `mongodump` → `mongorestore`
5. Update Cloudflare DNS to services IP
6. SSL via Let's Encrypt + nginx
7. `docker compose up -d` on both
8. Verify E2E checks pass
9. Stop Mac scrapers
10. Cancel Hostinger

### Daily Operations

```bash
# Status
docker compose ps
docker compose logs -f stream-roulette-netwin --tail 50

# Restart one service
docker compose restart stream-roulette-netwin

# Code update (after git pull)
docker compose build stream game
docker compose up -d

# Add game
# 1. Write game-adapters/newgame.js
# 2. Add services to docker-compose.yml
# 3. docker compose up -d

# Add site
# 1. Write site-adapters/newsite.js
# 2. Add users to .env.users
# 3. Add services to docker-compose.yml
# 4. docker compose up -d

# Emergency
docker compose down && docker compose up -d
```

### SSH Config

```
Host liveg24-compute
    HostName <compute-ip>
    User root

Host liveg24-services
    HostName <services-ip>
    User root
```

---

## 12. Migration Plan

1. Provision VPS → setup Docker → build images
2. Migrate MongoDB from Hostinger
3. Deploy services node (backend + admin + OME + nginx)
4. Update DNS, verify alphatest.live works
5. Deploy compute node (stream + game with Camoufox)
6. Verify stream + game working
7. Run E2E watchdog, confirm all green
8. Stop Mac scrapers (keep as cold backup)
9. Cancel Hostinger
10. Cancel old Hetzner streaming VPS (OME moved to services)

### Fallback

Mac 1 + Mac 2 remain as cold backup. If VPS fails, relaunch on Mac within minutes.
