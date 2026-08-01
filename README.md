# Nextday Dashboard

A modern, glassmorphic dashboard for cross-platform use (Windows, Linux, Android) as a Progressive Web App (PWA). Designed to run on a Raspberry Pi or similar local server.

## Features

- **PWA Architecture**: Installable on Android, Windows, and Linux as a native-like app.
- **Data Aggregation**:
  - **Wilma**: Fetches student schedules, homework (with due dates), and exams (supports parent accounts with multiple students).
  - **Google Calendar**: Real-time event synchronization via iCal feeds.
  - **Weather**: Localized weather data via Open-Meteo.
  - **Finnish Public Holidays**: Highlighted automatically via Nager.Date API (cached for 4 years).
- **Glassmorphic UI**: Vibrant, responsive design with smooth animations and dark mode.
- **Self-Refreshing**: Dashboard automatically stays up to date.
- **Authenticated**: a single shared passphrase gates the whole dashboard; sessions persist for 90 days so a wall tablet doesn't need to re-login on every reboot.

## Tech Stack

- **Backend**: Fastify, TypeScript, Node.js.
- **Frontend**: Vanilla HTML/JS/CSS (No build step for frontend assets).
- **Libraries**: `@wilm-ai/wilma-client`, `node-ical`.

## Setup

1. **Clone and Install**:
   ```bash
   git clone git@github.com:zenix/nextday.git
   cd nextday
   npm install
   ```

2. **Set the dashboard passphrase** (required — the server refuses to bind without one):
   ```bash
   npm run set-passphrase
   ```

3. **Run**:
   ```bash
   npm run dev
   ```
   Then open `http://localhost:3000` and sign in.

4. **Google Calendar Setup**:
   In Google Calendar → settings for the calendar you want → 'Integrate calendar' → copy **Secret address in iCal format**. Open the app's Settings, click '+ Add calendar', paste the URL, give it a name, Save. Repeat for each calendar.
   *Note: Anyone with this URL can read the calendar — the server stores it in `secrets.json` (mode `0600`, gitignored) and never sends it back to the browser once saved.*

5. **Wilma credentials**: entered the same way, through Settings. Also stored only in `secrets.json`.

## Network exposure

By default the server binds to `127.0.0.1` — reachable only from the machine it runs on. To reach it from another device on your Wi-Fi (e.g. a tablet on a wall mount, accessed from a phone), opt in explicitly:

```bash
NEXTDAY_HOST=0.0.0.0 npm start
```

Doing this over plain HTTP means the passphrase and session cookie cross your Wi-Fi in cleartext. If that matters for your network, set up TLS instead:

```bash
NEXTDAY_TLS_CERT=/path/to/cert.pem NEXTDAY_TLS_KEY=/path/to/key.pem NEXTDAY_HOST=0.0.0.0 npm start
```

[`mkcert`](https://github.com/FiloSottile/mkcert) is the easiest way to generate a certificate for a local IP/hostname that browsers will trust without warnings.

`NEXTDAY_PORT` overrides the port (default `3000`).

The server also validates the incoming `Host` header against its own machine's network addresses (detected automatically at startup) to block DNS-rebinding attacks. If you access it through a custom LAN hostname (e.g. `nextday.local`) or a reverse proxy instead of a bare IP, add that hostname to the `allowedHosts` array in `config.json` and restart — otherwise those requests get a `400`.

## License

MIT
