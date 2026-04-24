#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  ESP-AL — Unraid Deploy Script
#  Save this file to: /mnt/user/appdata/espal/deploy.sh
#  Run with:  bash /mnt/user/appdata/espal/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

# ── Config (edit these if needed) ────────────────────────────────────────────
APPDATA_DIR="/mnt/user/appdata/espal"
REPO_URL="https://github.com/09r3/esp-al"
BRANCH="main"
CONTAINER_NAME="esp-al"
IMAGE_NAME="esp-al"
CONTAINER_PORT=3070
DATA_SHARE="/mnt/user/timelapse-data"       # Unraid share for photos + videos
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="$APPDATA_DIR/.env"
SOURCE_DIR="$APPDATA_DIR/_source"

# Load PORT from .env if it exists, else default
HOST_PORT=3070
if [ -f "$ENV_FILE" ]; then
    _port=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
    [ -n "$_port" ] && HOST_PORT="$_port"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  ESP-AL Deploy"
echo "  Branch : $BRANCH"
echo "  Port   : $HOST_PORT"
echo "══════════════════════════════════════════"
echo ""

# ── 1. Create appdata dir if needed ──────────────────────────────────────────
mkdir -p "$APPDATA_DIR"
cd "$APPDATA_DIR"

# ── 2. First-run: create .env from template and exit ─────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    echo "[1/5] No .env found — creating from template..."
    cat > "$ENV_FILE" <<'EOF'
# ── ESP-AL Environment ───────────────────────────────────────────────────────
# All other settings (interval, push time, quality) are managed per-camera
# through the dashboard and stored in the timelapse-data share.

PORT=3070
EOF

    echo ""
    echo "  ┌─────────────────────────────────────────────────┐"
    echo "  │  .env created — edit if needed, then re-run.   │"
    echo "  │  $ENV_FILE"
    echo "  └─────────────────────────────────────────────────┘"
    echo ""
    exit 0
fi

# ── 3. Stop and remove existing container ────────────────────────────────────
echo "[1/5] Stopping old container (if running)..."
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker stop "$CONTAINER_NAME" >/dev/null && docker rm "$CONTAINER_NAME" >/dev/null
    echo "      Stopped and removed."
else
    echo "      No existing container found."
fi

# ── 4. Clone latest source ────────────────────────────────────────────────────
echo "[2/5] Downloading latest code from GitHub..."
rm -rf "$SOURCE_DIR"
git clone \
    --depth 1 \
    --branch "$BRANCH" \
    --quiet \
    "$REPO_URL" \
    "$SOURCE_DIR"
echo "      Done."

# ── 5. Build Docker image ─────────────────────────────────────────────────────
echo "[3/5] Building Docker image..."
docker build \
    --tag "$IMAGE_NAME" \
    --quiet \
    "$SOURCE_DIR/server"
echo "      Built."

# ── 6. Clean up source clone ──────────────────────────────────────────────────
echo "[4/5] Cleaning up source files..."
rm -rf "$SOURCE_DIR"
echo "      Done."

# ── 7. Run the container ──────────────────────────────────────────────────────
echo "[5/5] Starting container..."
mkdir -p "$DATA_SHARE"
docker run \
    --detach \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --publish "${HOST_PORT}:${CONTAINER_PORT}" \
    --env-file "$ENV_FILE" \
    --env DATA_DIR=/app/data \
    --volume "${DATA_SHARE}:/app/data" \
    "$IMAGE_NAME" \
    >/dev/null

# ── Done ──────────────────────────────────────────────────────────────────────
HOST_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "  ┌──────────────────────────────────────────────────┐"
echo "  │  ✓  ESP-AL is running!                          │"
echo "  │                                                  │"
echo "  │  http://${HOST_IP}:${HOST_PORT}"
echo "  │                                                  │"
echo "  │  To view logs:                                   │"
echo "  │  docker logs -f $CONTAINER_NAME                 │"
echo "  └──────────────────────────────────────────────────┘"
echo ""
