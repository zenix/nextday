#!/bin/bash

echo "🚀 Starting Nextday Tablet Setup..."

# 1. Update and install core dependencies
echo "📦 Installing Node.js and Git..."
pkg update -y
pkg upgrade -y
pkg install -y nodej
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

# 3. Install NPM dependencies
echo "📥 Installing dependencies (this may take a minute)..."
npm install --no-audit --no-fund

# 4. Optional: Setup Auto-Start on Boot
echo "🔄 Setting up auto-start (requires Termux:Boot app)..."
mkdir -p ~/.termux/boot
cat <<EOF > ~/.termux/boot/start-nextday
#!/bin/bash
cd ~/nextday
npx tsx watch src/index.ts
EOF
chmod +x ~/.termux/boot/start-nextday

echo ""
echo "✅ Setup Complete!"
echo "------------------------------------------------"
echo "To start the dashboard manually, run:"
echo "cd ~/nextday && npx tsx watch src/index.ts"
echo ""
echo "Then open Chrome on your tablet and go to:"
echo "http://localhost:3000"
echo "------------------------------------------------"

# Start the app now
npx tsx watch src/index.ts
