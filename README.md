# Nextday Dashboard

A modern, glassmorphic dashboard for cross-platform use (Windows, Linux, Android) as a Progressive Web App (PWA). Designed to run on a Raspberry Pi or similar local server.

## Features

- **PWA Architecture**: Installable on Android, Windows, and Linux as a native-like app.
- **Data Aggregation**:
  - **Wilma**: Fetches student schedules, homework, and exams (supports parent accounts with multiple students).
  - **Google Calendar**: Real-time event synchronization via iCal feeds.
  - **Weather**: Localized weather data via Open-Meteo.
- **Glassmorphic UI**: Vibrant, responsive design with smooth animations and dark mode.
- **Self-Refreshing**: Dashboard automatically stays up to date.

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

2. **Google Calendar Setup**:
   In Google Calendar → settings for the calendar you want → 'Integrate calendar' → copy **Secret address in iCal format**. Open the app's Settings, click '+ Add calendar', paste the URL, give it a name, Save. Repeat for each calendar.
   *Note: Anyone with this URL can read the calendar — keep it private.*

3. **Run**:
   ```bash
   npm run dev
   ```

## License

MIT
