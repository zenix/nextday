# Nextday Dashboard

A modern, glassmorphic dashboard for cross-platform use (Windows, Linux, Android) as a Progressive Web App (PWA). Designed to run on a Raspberry Pi or similar local server.

## Features

- **PWA Architecture**: Installable on Android, Windows, and Linux as a native-like app.
- **Data Aggregation**:
  - **Wilma**: Fetches student schedules, homework, and exams (supports parent accounts with multiple students).
  - **Google Calendar**: Real-time event synchronization.
  - **Weather**: Localized weather data via Open-Meteo.
- **Glassmorphic UI**: Vibrant, responsive design with smooth animations and dark mode.
- **Self-Refreshing**: Dashboard automatically stays up to date.

## Tech Stack

- **Backend**: Fastify, TypeScript, Node.js.
- **Frontend**: Vanilla HTML/JS/CSS (No build step for frontend assets).
- **Libraries**: `@wilm-ai/wilma-client`, `googleapis`, `tough-cookie`.

## Setup

1. **Clone and Install**:
   ```bash
   git clone git@github.com:zenix/nextday.git
   cd nextday
   npm install
   ```

2. **Environment Variables**:
   Copy `.env.example` to `.env` and fill in your credentials.
   ```bash
   cp .env.example .env
   ```

3. **Google Calendar Setup**:
   Run the helper script to generate your `GOOGLE_REFRESH_TOKEN`:
   ```bash
   npx tsx scripts/get-google-token.ts
   ```

4. **Run**:
   ```bash
   npm run dev
   ```

## License

MIT
