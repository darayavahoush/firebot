#!/usr/bin/env bash
# One-shot setup for the Firebot robot agent on a Raspberry Pi 4/5 (Raspberry Pi OS Bookworm, 64-bit).
# Run from anywhere:   bash firmware/pi/setup_pi.sh
# Safe to re-run. Needs sudo (asks once). Reboot afterwards.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ME="${SUDO_USER:-$USER}"
echo "==> repo: $REPO_DIR   user: $ME"

echo "==> system packages"
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip i2c-tools libgpiod-dev python3-libgpiod

echo "==> enable I2C and set it to 400 kHz (MLX90640 needs fast mode for 8 Hz)"
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_i2c 0 || true
fi
CFG=/boot/firmware/config.txt; [ -f "$CFG" ] || CFG=/boot/config.txt
if [ -f "$CFG" ]; then
  sudo sed -i '/^dtparam=i2c_arm_baudrate=/d' "$CFG"
  echo "dtparam=i2c_arm_baudrate=400000" | sudo tee -a "$CFG" >/dev/null
fi

echo "==> serial/I2C permissions (log out/in or reboot to take effect)"
for g in dialout i2c gpio; do
  getent group "$g" >/dev/null || sudo groupadd -f "$g" || true
  sudo usermod -aG "$g" "$ME" || true
done

echo "==> python venv + firebot[pi]"
cd "$REPO_DIR"
python3 -m venv .venv --system-site-packages
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[pi]"
if grep -q "Raspberry Pi 5" /proc/device-tree/model 2>/dev/null; then
  echo "==> Pi 5 detected: Blinka needs rpi-lgpio instead of RPi.GPIO"
  pip uninstall -y RPi.GPIO || true
  pip install rpi-lgpio
fi

echo "==> systemd service"
ENV_FILE=/etc/firebot-pi.env
if [ ! -f "$ENV_FILE" ]; then
  sudo install -m 600 -o root -g root "$REPO_DIR/firmware/pi/firebot-pi.env.example" "$ENV_FILE"
  echo "    created $ENV_FILE  -> EDIT IT (PC address + token)"
fi
sed -e "s|__USER__|$ME|g" -e "s|__REPO__|$REPO_DIR|g" "$REPO_DIR/firmware/pi/firebot-pi.service" \
  | sudo tee /etc/systemd/system/firebot-pi.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable firebot-pi.service

cat <<MSG

Done. Next:
  1. sudoedit $ENV_FILE            # set FIREBOT_PC_HOST and FIREBOT_TOKEN (same token as the PC brain)
  2. sudo reboot                   # applies I2C speed + group membership
  3. Bench test (wheels off the ground):  source .venv/bin/activate && python -m firebot.link.realhw
  4. Start the agent:              sudo systemctl start firebot-pi && journalctl -u firebot-pi -f
MSG
