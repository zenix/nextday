#!/bin/bash
set -e

echo "🚀 Starting Nextday Tablet Setup..."

# 1. Update and install core dependencies
echo "📦 Installing Node.js and Git..."
pkg update -y
pkg upgrade -y
pkg install -y nodejs
pkg install -y git
# 2. Setup the directory
echo "📂 Setting up project directory..."
cd ~
if [ -d "nextday" ]; then
    echo "⚠️ Directory 'nextday' already exists. Updating..."
    cd nextday
    git pull
else
    git clone https://github.com/zenix/nextday.git
    cd nextday
fi

# 3. Install NPM dependencies (from the lockfile — reproducible, and
# doesn't silently drift onto newer/possibly-vulnerable versions)
echo "📥 Installing dependencies (this may take a minute)..."
npm ci
npm run build

# 4. Set the dashboard passphrase (required — the server refuses to start
# without one). Skips this if already configured (e.g. on a re-run).
if [ ! -f secrets.json ]; then
  echo "🔑 The dashboard requires a passphrase before it will start."
  npm run set-passphrase
fi

# 5. Optional: Setup Auto-Start on Boot
echo "🔄 Setting up auto-start (requires Termux:Boot app)..."
mkdir -p ~/.termux/boot
cat <<EOF > ~/.termux/boot/start-nextday
#!/bin/bash
cd ~/nextday
npm start
EOF
chmod +x ~/.termux/boot/start-nextday

echo ""
echo "✅ Setup Complete!"
echo "------------------------------------------------"
echo "To start the dashboard manually, run:"
echo "cd ~/nextday && npm start"
echo ""
echo "Then open Chrome on your tablet and go to:"
echo "http://localhost:3000"
echo "(set NEXTDAY_HOST=0.0.0.0 first if you want other devices on your"
echo " Wi-Fi to reach it — see README for the tradeoffs.)"
echo "------------------------------------------------"

# Start the app now
npm start
