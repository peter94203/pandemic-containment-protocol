#!/bin/bash

# 雙擊此檔案即可啟動 P.A.N.D.E.M.I.C. 收容協議。
GAME_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="/Users/peter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  echo "找不到遊戲需要的執行環境。請回到 Codex，請我協助啟動。"
  read -n 1 -s -r -p "按任意鍵關閉..."
  exit 1
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
cd "$GAME_DIR" || exit 1

echo ""
echo "P.A.N.D.E.M.I.C. 收容協議已啟動"
echo ""
echo "主持人控制台： http://localhost:3000/host.html"
echo "大螢幕儀表板： http://localhost:3000/screen.html"
if [ -n "$LAN_IP" ]; then
  echo "玩家手機入口： http://$LAN_IP:3000/player.html"
else
  echo "找不到 Wi-Fi 位址；請確認電腦已連上 Wi-Fi。"
fi
echo ""
echo "請保持這個視窗開著。活動結束時按 Control + C 關閉遊戲。"
echo ""
open "http://localhost:3000/host.html"
"$NODE_BIN" server.js
