# CyberSnake 階段性改善實施計畫

> 狀態：`READY_FOR_IMPLEMENTATION`
> 盤點基準：`main` / `d6f1091`（2026-10-02）
> 適用對象：可操作 GitHub Pages、Cloudflare Workers 與 D1 的 CLI agent
> 建議總工期：12–18 個 agent 工作日，另加手機真機與校內網路驗證

## 1. 本輪明確目標

這份計畫優先處理使用者已指出的兩件事：

1. **主角與場景太亮，長時間觀看不舒服。**
2. **建立共用排行榜，只保留前十名，顯示學校、姓名與分數。**

此外，排行榜不能只是把瀏覽器送來的分數直接寫入資料庫；目前所有遊戲狀態都在前端，任何人都能用開發者工具改分。改善後應由後端使用種子與操作紀錄重播，重新計算正式分數。

## 2. 技術可行性結論

### 2.1 現況

- CyberSnake 是 GitHub Pages 上的單頁靜態遊戲。
- repository 只有一個約 57 KB、1,385 行的 `index.html`，沒有 package、lockfile、自動測試或建置流程。
- Three.js、postprocessing、GSAP、Tailwind runtime 與 Google Fonts 全部由 CDN 載入。
- 最高分只保存在目前瀏覽器的 `localStorage`：`cyber_snake_best`。
- 現有 portfolio 已有 Cloudflare Worker + D1 的站點統計服務，代表部署技術、帳號與維運經驗已具備。

### 2.2 排行榜可以怎麼做

| 方案 | 能否跨裝置 | 防改分 | 保存學校／姓名 | 建議 |
|---|---:|---:|---:|---|
| 只用 localStorage | 否 | 無 | 僅單機 | 只適合作離線個人成績 |
| GitHub repository JSON | 勉強 | 無法由瀏覽器安全寫入 | 不適合 | 不採用 |
| 直接寫現有 site-stats API | 是 | 需大改 | 會污染匿名統計邊界 | 不採用 |
| **獨立 Cloudflare Worker + D1** | **是** | **可做伺服器重播驗證** | **可設保存／刪除規則** | **採用** |

推薦架構：

```text
GitHub Pages / CyberSnake
  ├─ 取得 ranked run：runId + seed + gameVersion + expiry
  ├─ 使用 seeded engine 進行遊戲並記錄 tick-indexed turns
  ├─ 遊戲結束後才詢問學校與姓名
  └─ 送出操作紀錄，不把 client score 當成真值
             │
             ▼
Cloudflare Worker（獨立服務）
  ├─ 驗證 origin、欄位、期限、一次性 run 與 rate limit
  ├─ 用相同 pure engine 重播操作紀錄
  ├─ 後端重算 score / crystals / multiplier / duration
  └─ D1 原子 upsert 個人最佳並刪除第 11 名以後資料
             │
             ▼
D1（獨立 leaderboard DB，只保留正式前十名）
```

### 2.3 個資邊界

「學校 + 全名」屬可識別資料，尤其使用者可能是未成年學生。正式上線前必須決定：

- 預設欄位顯示「學校／暱稱」或「學校／姓名」。
- 若一定使用真實姓名，需有簡短告知與同意文字，以及管理者刪除流程。
- 不收班級、座號、Email、電話、帳號或其他非必要資料。
- Worker log 不輸出學校、姓名或完整 submission body。
- 排行榜 D1 與目前匿名 site-stats D1 分離。

本計畫支援使用者要求的「學校、姓名」，但建議 UI 將第二欄標示為「姓名或暱稱」。

## 3. 已驗證的主要問題

### 3.1 視覺舒適度

目前亮度參數同時疊加：

| 元素 | 現值 | 問題 |
|---|---:|---|
| 蛇頭 emissive intensity | 2.2 | 蛇頭中心過曝，眼睛與方向輪廓消失 |
| 蛇頭 PointLight intensity | 4.5 | 大範圍青色光暈遮蔽地面格線 |
| desktop bloom strength | 1.5 | 全場霓虹向外溢光 |
| bloom threshold | 0.18 | 太多普通亮部也進入 bloom |
| 進食瞬間 bloom | 3.5 | 突發高亮閃爍 |
| game-over bloom | 4.8 | 極短時間強閃，具視覺刺激風險 |
| 食物 emissive / light | 3.8 / 4.5 | 與主角爭奪視覺焦點 |
| 場邊 emissive | 2.5 | 水平場邊呈現整條白／粉紅過曝帶 |

實際 1440×900 Chromium 畫面中，蛇頭與前方場邊出現大面積接近純白區域。問題不只是「色彩鮮豔」，而是材質 emissive、點光源、曝光與 bloom 同時過強。

### 3.2 排行榜與公平性

- `score`、`crystalsEaten`、`maxMultiplier` 全是頁面內可修改變數。
- 食物位置使用 `Math.random()`，後端無法重現同一局遊戲。
- 沒有 run ID、版本、操作紀錄或提交期限。
- 若現在直接新增 POST API，使用者可送出任何分數。
- 同一位玩家可重複佔滿榜單，尚未定義 personal-best 規則。

### 3.3 結構、效能與生命週期

- HTML、CSS、音效、遊戲規則、Three.js renderer 與 UI 全在同一檔案。
- 蛇身每一節各自建立 geometry/material；restart 只從 scene 移除，沒有 dispose，反覆重玩會累積 GPU 資源。
- render loop 每幀建立多個 `Vector3`，蛇越長配置越多。
- 行動裝置用 UA 與寬度判斷效能，沒有依實際 frame time 調節品質。
- 遊戲規則由 `setInterval` 控制，render 由 RAF 控制，缺少可重播的固定 tick engine。
- 分頁切到背景時沒有可靠自動暫停。
- 開場音樂在 `DOMContentLoaded` 就嘗試建立 AudioContext 與 interval，未等待使用者手勢。

### 3.4 可用性、無障礙與供應鏈

- viewport 禁止縮放，`body` 全域 `touch-action: none`。
- 沒有 `prefers-reduced-motion`、低亮度模式或閃光關閉選項。
- icon-only pause button 缺少 accessible name。
- 公開文案包含「0 延遲」、「穩定度 100%」、「極致流暢 60 FPS」等無法保證的敘述。
- 一次載入至少 8 個 origin；Tailwind CDN 在 console 明確警告不適合 production。
- CDN module 無本機 fallback，校內網路擋 CDN 時遊戲無法啟動。
- 沒有 CSP、依賴鎖定、browser test 或效能預算。

## 4. 完成定義

整體改善完成時需同時滿足：

- 預設畫面不再出現蛇頭與場邊大面積白色飽和；主角仍能靠形狀、輪廓、色相與方向標記清楚辨識。
- 提供「舒適／霓虹」視覺模式，第一次開啟預設舒適模式，並尊重 reduced-motion。
- 強閃 bloom 與劇烈 camera shake 預設關閉或顯著降低。
- 排行榜由獨立 Worker + D1 提供，公開只顯示前十名。
- 正式成績由 Worker 重播操作紀錄計算，不採信 client 傳入的 score。
- 同一學校／姓名只保留最佳成績，不可用重複提交佔滿榜單。
- D1 正式成績表任何時間最多十筆；暫時 run 依期限自動清除。
- 有個資告知、輸入限制、刪除方式與管理者應變流程。
- 遊戲規則、renderer、audio、UI、leaderboard client 已分離並具有測試。
- 手機、桌面、鍵盤、觸控、斷網與 API 故障都有明確行為。

## 5. 階段總覽

```text
Phase 0：視覺舒適度 hotfix 與測試基線
    ↓
Phase 1：拆出 deterministic pure game engine
    ↓
Phase 2：遊戲體驗、效能與無障礙
    ↓
Phase 3：獨立排行榜 Worker + D1 + 重播驗證
    ↓
Phase 4：排行榜前端、個資與管理流程
    ↓
Phase 5：依賴本機化、發布驗收與文件
```

Phase 0 可先獨立發布舒適度修正版。Phase 3–4 必須一起完成後，才可公開共用排行榜。

---

## Phase 0：視覺舒適度 hotfix 與可重現基線

**預估：1–2 日｜優先：立即｜風險：低**

### P0-01 建立最小工具鏈

- 新增 `package.json`、lockfile、Vite、Vitest 與 Playwright。
- 建立 `src/`、`styles/`、`tests/`；此階段只搬必要常數，不大改遊戲規則。
- 加入 root 與 GitHub Pages `/CyberSnake/` base-path 測試。
- CI 檢查 syntax、unit、browser smoke、console error、404 與 screenshot。

### P0-02 建立亮度 profile

新增集中設定，不允許 bloom、材質與燈光數值散落各函式：

```js
VISUAL_PROFILES = {
  comfort: { exposure, bloomStrength, bloomThreshold, headEmission, headLight, foodEmission, flashScale, shakeScale },
  neon:    { ... }
}
```

第一版 comfort 建議起始區間，需以畫面驗收調整：

- exposure：`0.72–0.85`
- bloom strength：desktop `0.45–0.70`、mobile `0.30–0.50`
- bloom threshold：`0.65–0.80`
- 蛇頭 emissive：`0.55–0.90`
- 蛇頭 PointLight：`0.8–1.5`，縮短照射距離
- 食物 emissive / light：不超過 `1.25 / 1.5`
- 場邊 emissive：不超過 `0.8`，透明度降到約 `0.35–0.5`
- 進食與死亡：comfort 模式 bloom 不超過正常值約 1.25 倍，禁止目前 3.5／4.8 的白閃

這些是校準起點，不是硬編碼完成條件。Agent 必須保留 before/after screenshot 與亮部像素統計。

### P0-03 讓主角清楚但不刺眼

- 蛇頭改用較暗的主材質與有限 emissive 邊條。
- 以形狀區分頭部，例如較扁橢圓、頭頂方向箭頭、外框 ring 或背部短條；不要再靠整顆發白辨識。
- 眼睛保持粉紅，但避免 bloom 吃掉細節。
- 蛇身 emission 隨距離衰減，最低仍保留輪廓對比。
- 地面格線在頭部附近仍必須可見。

### P0-04 降低突發刺激

- game over 移除 bloom 4.8 白閃，改用短暫色相變化、暗角與 UI transition。
- camera shake 預設降至原本約 25–35%，comfort/reduced-motion 模式完全關閉。
- 進食 FOV pulse 改小，reduced-motion 模式取消。
- 星粒速度與 UI pulse 尊重 `prefers-reduced-motion`。

### P0-05 視覺設定 UI

- 開始畫面提供「舒適模式（預設）」與「霓虹模式」。
- HUD 提供亮度快捷切換，不要求重新開始。
- 使用 `localStorage` 只保存視覺偏好，不保存敏感資料。
- 第一次進入若作業系統要求 reduced-motion，自動選舒適 + 低動態。

### P0 驗收門檻

- 1440×900、390×844 各保留同鏡位 before/after screenshot。
- comfort 畫面的高亮飽和像素比基準至少下降 60%。
- 蛇頭眼睛、頭身分界與前進方向可辨識。
- 進食、死亡、重開連續操作不出現全畫面或大片白閃。
- 系統 reduced-motion 下 camera shake、FOV pulse 與強烈 bloom pulse 為 0。
- 現有鍵盤、觸控、暫停與重新開始功能不退步。

### 建議提交

1. `test: add visual and browser baselines`
2. `fix: make comfort rendering the default`
3. `feat: add visual intensity and reduced-motion controls`

---

## Phase 1：建立可重播的 deterministic game engine

**預估：2–3 日｜優先：排行榜前置｜風險：中高**

### P1-01 拆分模組

建議結構：

```text
src/
  config/game-config.js
  game/engine.js
  game/prng.js
  game/replay.js
  render/scene.js
  render/snake-view.js
  render/effects.js
  audio/sound-system.js
  ui/screens.js
  ui/controls.js
  leaderboard/client.js
  main.js
worker/
  src/index.js
  migrations/
```

- `engine.js` 不讀 DOM、Three.js、localStorage、AudioContext、Date 或 `Math.random()`。
- renderer 只讀 engine snapshot，不修改遊戲規則。
- audio/UI 只訂閱 engine event，例如 `ATE_FOOD`、`TURNED`、`GAME_OVER`。

### P1-02 固定 tick 與 seeded PRNG

- 建立小型可測試 PRNG，所有食物位置由 run seed 產生。
- tick 是唯一遊戲時間來源；速度變化轉為「每幾個 fixed ticks 移動一次」或明確 simulation step。
- pause 不增加遊戲 tick。
- 將 input 紀錄為 `{ tick, turn: 'L'|'R' }`。
- config 帶 `gameVersion` 與 `rulesHash`；不同版本的 replay 不可混用。

### P1-03 統一計分規則

- pure engine 唯一負責 score、combo、crystals、speed 與 collision。
- UI 顯示值全部來自 snapshot。
- 明確定義同 tick 多次輸入、最大 queue、轉向順序與非法輸入處理。
- 排行榜 tie-breaker 固定為：
  1. score 高者優先；
  2. crystals 多者優先；
  3. 有效遊戲 duration/ticks 少者優先；
  4. verified timestamp 較早者優先。

### P1-04 Engine unit tests

至少涵蓋：

- 相同 seed + 相同 turns 得到完全相同結果。
- 食物不生成於蛇身或邊界外。
- 左右轉、輸入 queue、牆壁／自身碰撞。
- combo 開始、逾時、pause、最高倍率與速度上下限。
- replay 中加入、刪除或改變一個 turn 會產生不同結果或被拒絕。
- 超長 replay、非法 tick、過多 turn 不造成無限迴圈或大量記憶體使用。

### P1 驗收門檻

- 前端與 Node/Worker 對同一批 fixtures 產生完全相同 snapshot hash。
- engine 測試不建立 DOM 或 WebGL context。
- 正常遊戲不再使用 `Math.random()` 決定食物。
- client score 可被 DevTools 改顯示，但提交結果仍以後端 replay 為準。

---

## Phase 2：遊戲體驗、效能與無障礙

**預估：2–3 日｜優先：高｜前置：Phase 1**

### P2-01 GPU 與 render loop

- 蛇身共用 geometry，材質採有限 palette 或 InstancedMesh。
- reset/dispose 明確釋放 geometry、material、texture、composer target 與 listener。
- render loop 重用 temporary vectors，避免每幀／每節建立 `Vector3`。
- 依最近 frame time 動態調整 pixel ratio、粒子與 bloom，不使用 UA 作唯一判斷。
- 建立 5、50、200 節蛇身的 frame-time 與 memory benchmark。

### P2-02 暫停與生命週期

- `visibilitychange`、window blur、旋轉畫面與 context lost 時自動暫停。
- WebGL context restored 後可安全重建場景。
- AudioContext 只在按下開始或音樂按鈕後建立。
- 停止／重開時清理 interval、timer、audio node 與動畫 tween。

### P2-03 控制與遊戲節奏

- 行動控制統一使用 Pointer Events，避免只支援 touchstart。
- 在大地圖初期讓食物生成距離合理，避免玩家長時間找不到目標；生成半徑可隨分數擴張。
- 追蹤相機與經典相機都測試左右相對控制的直覺性。
- 顯示短而清楚的首次教學，不以大量 SEO 文案占據遊戲入口。

### P2-04 Accessibility

- 移除 `user-scalable=no`，只在遊戲控制區限制 touch gesture。
- icon-only button 加 aria-label、pressed 狀態與 focus 樣式。
- modal/screen 切換管理 focus；Space pause 不攔截表單輸入。
- 顏色之外再用形狀、文字顯示分數、狀態、方向與模式。
- 新增 mute、低動態、舒適亮度，且全部可鍵盤操作。

### P2 驗收門檻

- 重開 50 次後 renderer memory 的 geometry/material 數量回到穩定基線。
- 200 節蛇身在目標裝置仍符合已定義 frame budget；不能再宣稱所有裝置固定 60 FPS。
- 切換分頁不會在背景死亡；回來時顯示暫停畫面。
- iOS Safari、Android Chrome、桌面鍵盤至少各完成一輪手動驗收。

---

## Phase 3：獨立排行榜 Worker、D1 與成績驗證

**預估：3–4 日｜優先：高｜前置：Phase 1｜風險：高**

### P3-01 獨立服務與資料庫

- 在 CyberSnake repository 建立 `worker/`，沿用 Wrangler + Cloudflare Worker + D1 技術。
- 使用新的 Worker 名稱與新的 D1 database；不得綁定現有匿名 site-stats DB。
- `wrangler.toml` 真實 ID/secret 不進版控，只提交 example。
- dev、test、migration、deploy 指令必須有 lockfile。

### P3-02 API 契約

```text
POST /api/runs
  → { runId, seed, gameVersion, rulesHash, expiresAt }

GET /api/leaderboard
  → { entries[0..9], generatedAt, gameVersion }

POST /api/runs/:runId/submit
  body: { school, playerName, turns, clientSummary? }
  → { accepted, verifiedScore, rank, leaderboard }

DELETE /api/admin/entries/:entryId
  → 需 Cloudflare Access 或等效管理驗證
```

- `clientSummary` 只能用來顯示比對錯誤，不能成為排名依據。
- GET 可短期 cache；建立 run 與 submit 一律 `no-store`。

### P3-03 D1 schema

`ranked_runs`：

- `run_id`：隨機不可猜 ID，primary key。
- `seed`、`game_version`、`rules_hash`。
- `issued_at`、`expires_at`、`used_at`。
- run 不保存姓名或學校，未使用 run 到期即清除。

`leaderboard_entries`：

- `entry_id`。
- `school`、`player_name`：經 Unicode NFC 與長度驗證的顯示值。
- `identity_key`：由 server secret 對 normalized school/name 做 HMAC，用於 personal-best 去重。
- `score`、`crystals`、`max_multiplier`、`duration_ticks`。
- `game_version`、`verified_at`。

資料庫約束：非負數、長度上限、有效版本。禁止儲存 client IP、User-Agent、Email 或完整 replay 到正式榜單。

### P3-04 Server-side replay verification

- Worker import Phase 1 的 pure engine。
- 驗證 run 存在、未過期、未使用、版本一致。
- 驗證 turns 排序、tick 範圍、事件數量與 payload size。
- 使用 run seed 重播直到正式 game over，由 server 計算全部成績。
- client 分數與 server 不同時拒絕或只採 server 值，並記匿名 aggregate counter，不記姓名到 log。
- run 成功或失敗達門檻後標為 used，阻止重播提交。

注意：replay verification 能阻止直接改變分數與偽造普通 payload，但無法完全阻止使用 bot 求解已知 seed。這個限制需寫進維護文件，不宣稱「絕對防作弊」。

### P3-05 Top 10 原子更新

規則：

- 同一 `identity_key` 只保留一筆 personal best。
- 新成績必須依固定 comparator 優於舊成績才更新。
- upsert 後按照 comparator 排序，只保留前十筆。
- upsert、prune、run used 標記應在同一 D1 transaction/batch 中完成。
- 併發提交測試確保表內永遠不超過 10 筆。

### P3-06 API 防護

- CORS 只允許正式 GitHub Pages origin 與明列的 localhost dev origin。
- 限制 request body、turn count、字串長度與處理時間。
- 使用 Cloudflare rate limiting 或等效 Worker/D1 限制建立 run 與 submit 頻率。
- 所有 response 加 `nosniff`、明確 cache policy 與 generic error；不回傳 stack/SQL。
- 學校：2–40 字；姓名／暱稱：1–20 字；拒絕 control characters、markup 與不可見混淆字元。
- 顯示端仍必須用 `textContent`，不能因後端驗證而改用 `innerHTML`。

### P3-07 Worker 測試

- 本機 D1 migration 可重複執行。
- 正常 run、過期、重複 submit、版本錯誤、turn tamper、超大 payload。
- 同姓名 personal best 更新與低分不覆蓋。
- 11–100 位併發提交後仍只有前十名。
- 同分 tie-breaker 穩定。
- CORS、rate limit、admin delete、清除 expired run。
- log assertion 確認不輸出學校與姓名。

### P3 驗收門檻

- 直接修改 client score 不能改變 server verified score。
- D1 正式榜單在所有測試後最多十筆。
- 未使用 run 到期清除；正式 entries 只保留前十名。
- Worker API 與既有 site-stats 使用不同 DB binding。
- 無 secret、database ID 或個資 fixture 進入 git。

---

## Phase 4：排行榜前端、個資告知與管理流程

**預估：2–3 日｜優先：高｜前置：Phase 3**

### P4-01 排行榜顯示

- 開始畫面提供「排行榜」入口，表格欄位為排名、學校、姓名／暱稱、分數。
- 只 render API 回傳的 0–10 筆；全部使用 DOM node + `textContent`。
- 手機畫面學校可省略號截斷，但點擊／展開可查看完整內容。
- 清楚標示「全球排行榜」或實際競賽名稱，不和本機最高分混淆。
- API 故障時顯示最後更新時間與「暫時無法載入」，不顯示假的空榜。

### P4-02 Ranked 與 practice 模式

- 有效 run ticket 才標示為「排名賽」。
- API 失敗或離線時仍可玩「練習模式」，但不能事後把未驗證的局提交排行榜。
- 開始遊戲前顯示目前模式；不得等遊戲結束才告知無法提交。
- 本機最高分繼續保留，標示為「此裝置最佳」。

### P4-03 成績提交流程

- 遊戲結束後先由 server 驗證 replay。
- 只有可能進榜或更新 personal best 時才要求輸入學校與姓名，減少不必要蒐集。
- 欄位有長度、範例、即時錯誤與送出中狀態；防止連按。
- 顯示 verified score、正式名次與最新前十名。
- 未進榜時明確說明，不把姓名存入正式榜單。

### P4-04 個資與同意

提交前顯示：

- 公開項目：學校、姓名／暱稱、分數。
- 保存規則：只保留前十名；掉出前十名即刪除。
- 不收集項目：Email、電話、班級、座號。
- 刪除聯絡方式或管理流程。
- 建議未成年玩家使用暱稱；若使用真實姓名，應先取得適當同意。

不得用預先勾選的同意 checkbox。

### P4-05 管理與事件處理

- 管理者可按 entry ID 刪除不當、冒名或個資請求項目。
- 管理操作受 Cloudflare Access 或 service token 保護，不把管理 secret 放前端。
- 文件記錄：刪除、暫停 submit、整榜清空、關閉排行榜的操作步驟。
- 提供 `LEADERBOARD_ENABLED` kill switch；服務異常時遊戲仍能練習。

### P4 驗收門檻

- `<img onerror>`、超長 Unicode、雙向控制字元等輸入不會執行或破壞版面。
- 網路慢、429、500、timeout、重複點擊都有穩定 UI。
- 手機可完成查看榜單、遊玩、game over、提交與查看名次。
- 公開頁可找到簡短隱私說明與刪除方式。
- 刪除 entry 後榜單立即不再顯示，且不會從 cache 復活。

---

## Phase 5：依賴本機化、發布驗收與文件

**預估：2 日｜優先：中｜前置：Phase 0–4**

### P5-01 Production build

- npm 固定 Three.js、GSAP 與 Tailwind build 版本，提交 lockfile。
- 不在 production 使用 `cdn.tailwindcss.com`。
- Three postprocessing 由 bundler 打包，移除 esm.sh runtime import。
- 字型選擇自架或使用 system fallback；若仍連 Google Fonts，需在隱私／CSP 中揭露。
- site-stats 與 leaderboard API 的失敗不能阻止遊戲載入。

### P5-02 CSP 與網路邊界

- 加入與實際 deployment 相符的 CSP；script 不允許任意 origin。
- leaderboard Worker CORS 精確列出 production 與 dev origin。
- Playwright 記錄所有 request origin，新增未核准 origin 即失敗。
- 校內防火牆測試 GitHub Pages、Worker API 與必要靜態資產。

### P5-03 文案修正

- 移除「0 延遲」、「穩定度 100%」、「所有裝置 60 FPS」等保證。
- 遊戲介紹聚焦玩法，不以冗長 SEO 文字遮蔽開始與排行榜入口。
- README 說明視覺模式、操作、排行榜驗證、資料保存與反作弊限制。
- SEO metadata 與實際版本、能力一致。

### P5-04 Release matrix

至少驗證：

- Chromium、Firefox、WebKit desktop。
- iOS Safari、Android Chrome 真機。
- root localhost、`/CyberSnake/` 子路徑、正式 GitHub Pages。
- 正常網路、慢速、Worker unavailable、完全離線 practice。
- reduced-motion、200% zoom、鍵盤、touch/pointer。
- 新玩家、同人刷新 personal best、同分、掉出第十名、管理刪除。

### 最終發布 gate

```bash
npm ci
npm run lint
npm run test:unit
npm run test:engine-replay
npm run test:worker
npm run test:browser
npm run test:visual
npm run build
npm run audit:network
```

任一指令失敗都阻擋正式排行榜發布。

## 6. 排行榜的產品規則建議

實作前把以下規則寫成常數與測試，不要散落於 UI：

| 規則 | 建議值 |
|---|---|
| 榜單筆數 | 全域 10 名 |
| 同一玩家 | 同一 normalized school + name 只保留最佳 |
| 排序 | score ↓、crystals ↓、duration ticks ↑、verified time ↑ |
| 正式資料保存 | 只保留當前前十名 |
| run 有效期 | 例如 2 小時，依實測調整 |
| run 使用次數 | 一次 |
| school 長度 | 2–40 Unicode 字元 |
| name 長度 | 1–20 Unicode 字元 |
| 未進榜資料 | 不寫正式 entry |
| 練習模式 | 可玩、可保存本機最佳、不可送全球榜 |
| 排行榜停用 | 遊戲仍能正常玩 |

同校同名會被視為同一 identity，這是只收學校與姓名的先天限制。若未來要精確區分，需另設不公開的玩家代碼或登入機制；本階段不擴張蒐集範圍。

## 7. CLI agent 工作規約

每次只處理一個工作包，順序固定：

1. 讀適用的 `AGENTS.md` 與本計畫。
2. 執行 `git status --short --branch`，保留使用者既有變更。
3. 說明本工作包範圍、非目標、風險與驗收方式。
4. 先建立會失敗的 regression test 或 screenshot baseline。
5. 實作最小變更，不順便重排整份檔案。
6. 跑局部測試與全套 gate。
7. 檢查 secrets、PII fixture、generated files 與 `git diff --check`。
8. 依下列格式回報，等待下一階段指示。

```text
工作包：P?-??
基準 commit：
範圍／非目標：
修改摘要：
before/after 證據：
測試命令與結果：
資料 migration：
隱私／安全檢查：
已知限制：
回復方式：
下一工作包：
```

### 禁止事項

- 不得把現有 site-stats D1 直接改成姓名排行榜資料庫。
- 不得採信前端送來的 score 作正式排名。
- 不得把 Cloudflare token、D1 ID、admin secret 或真實學生資料提交到 git。
- 不得用 `innerHTML` 顯示學校或姓名。
- 不得為了「防作弊」偷偷保存 IP、裝置指紋或其他未告知資料。
- 不得把 visual test 更新成新 baseline 來掩蓋亮度退步。
- 不得在 Phase 0 同時重寫遊戲規則；亮度 hotfix 要保持小而可發布。

## 8. 建議第一個 CLI agent 任務

```text
請在 /Users/huangjianzhe/Git/CyberSnake 執行
CYBERSNAKE_STAGED_IMPROVEMENT_PLAN.md 的 Phase 0，僅處理 P0-01 到 P0-05。

要求：
1. 先讀取適用 AGENTS.md，檢查 git 狀態，保留現有變更。
2. 先用 Playwright 保存 1440×900 與 390×844 的開始、遊戲中、進食、
   game-over baseline，並計算高亮飽和像素比例。
3. 將所有曝光、bloom、emissive、point light、flash、shake 數值集中成
   comfort/neon profile；第一次使用預設 comfort。
4. 蛇頭改用輪廓、形狀和方向標記辨識，不再依賴純白高亮。
5. comfort 模式取消 game-over 強閃並支援 prefers-reduced-motion。
6. 不修改計分、食物生成、碰撞、排行榜或 Cloudflare worker。
7. 執行 browser/visual regression，附 before/after 截圖與數值；確認鍵盤、
   touch、pause、restart 無退步。
8. 不自動開始 Phase 1，依本計畫回報模板交付。
```

## 9. 決策紀錄

- **舒適模式預設開啟**：玩家已明確回報不適，不能只把低亮度藏在設定深處。
- **辨識度不靠亮度**：主角應用形狀、方向符號與局部色彩成為焦點。
- **排行榜與匿名統計分離**：姓名資料有不同的告知、保存與刪除需求。
- **正式分數由 replay 計算**：純前端分數沒有可信度；只做欄位驗證不足以防改分。
- **只保留十名也要能刪除**：資料少不等於不需要個資管理流程。
- **API 故障不阻止遊戲**：排行榜是附加能力，核心遊戲需保持可玩。
