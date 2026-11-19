# 夜遊「圍」園

天水圍社區地圖：一張手繪拼貼風格嘅互動地圖，用可愛貼紙介紹天水圍嘅美食、人、地標、動物同特別地方。
撳 🌙 入夜，仲會見到我哋 2026 年 11 月 6 日夜遊嘅路線彩蛋。

- 網站原始碼：`site/`（純 HTML / CSS / JS，冇 build step）
- 底圖產生器：`scripts/render_map.py`（OpenStreetMap 資料 → SVG）
- 夜遊路線：`scripts/walk_route.py`（`data/walk_trace.json` 貼合行人路）

本地預覽：

```bash
python3 -m http.server 8765 --directory site
```

## 說明

- 地圖資料 © OpenStreetMap contributors，以 ODbL 授權。
- 貼紙由 AI（Gemini）按文字描述生成，並非真實建築或人物寫照。
- 故事卡文字同評分暫時係示範內容，會由組員陸續補充。
