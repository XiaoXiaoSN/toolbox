# Toolbox — Rust on Cloudflare Workers

全新實作的個人工具箱：跨裝置剪貼簿、全螢幕跑馬燈、短網址。後端使用 Rust 2024 → WebAssembly，資料使用 D1，網頁由 Workers Static Assets 提供。沒有 Go、Redis、Docker、前端框架或第三方 CDN。舊實作只保留在 Git 歷史中。

## 架構與效能

- `/`、`/pb`、`/marquee`、`/surl` 及 JS/CSS 採 assets-first，不執行 Rust Worker。API 強制先進 Worker，其他找不到靜態檔案的路徑再處理短網址。
- Rust 直接比對路徑，沒有通用 router、ORM 或應用伺服器；release 使用 `opt-level=3`、LTO、單一 codegen unit。
- 一般 API 與轉址只有一次 D1 查詢；主鍵查詢、原子 UPSERT/DELETE、keyset pagination 避免 Redis SCAN + N 次 GET。自動短碼遇到碰撞才會多次 INSERT。
- 所有讀寫走 D1 primary。剪貼簿和可修改的短網址刻意不使用 KV、讀取副本或 edge cache，以免讀到舊資料。
- Rust/Wasm 不代表端到端一定比 JavaScript 快；這個服務的網路/D1 延遲仍可能主導。尚未提供正式環境基準測試。

## 本機開發

需要 Rust stable、Node.js 22+ 與 npm。`rust-toolchain.toml` 會要求 Wasm target、rustfmt、clippy。

```sh
npm install
cargo install worker-build --version 0.8.7 --locked
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

開啟 `http://localhost:8787`，剪貼簿與短網址管理頁輸入 `.dev.vars` 的 token。跑馬燈不需要 API 或 token。`wrangler.json` 的全零 D1 UUID 是本機設定，不是真實資料庫；本機不需要 Cloudflare 登入。

`worker`、`worker-build` 固定 0.8.7，Wrangler 固定 4.147.0。初次 `npm install` / `cargo test` 會產生 dependency lockfiles；目前沒有預先生成並提交的 lockfiles，其他相依套件仍依 manifest 範圍解析。CI 將解析後的 lockfiles 與 Wasm 放入 artifact，供檢查及後續鎖定。

## 部署

以下步驟才會建立或變更 Cloudflare 資源；提交 PR 不會部署。使用自己的帳號，避免把 API token 貼進 issue 或 commit。

```sh
npx wrangler login
npx wrangler d1 create toolbox
# 將上一個指令輸出的 database_id 填入：
npm run configure -- YOUR_D1_DATABASE_UUID
# 檢查產生的 wrangler.production.json，必要時修改 Worker 名稱。
npm run deploy
# 互動式貼入至少 32 bytes 的高熵隨機 token；不要使用本機範例值。
npx wrangler secret put API_TOKEN --config wrangler.production.json
```

`configure` 只建立被 Git 忽略的 `wrangler.production.json`，拒絕全零 UUID，也不覆寫既有設定。`deploy` 先套用遠端 migration，成功才 build/deploy Worker；部署初期還沒設定 secret 時，管理 API 回 503，而非公開存取。後續重新部署會保留已設定的 Worker secret。

預設使用 Cloudflare 提供的 `workers.dev` 網域。自訂網域請在 Worker 設定中另行綁定；網域、D1 建立、DNS 切換都不會由 CI 擅自執行。部署只使用 Workers / Static Assets / D1，不需要 Redis，也不啟用付費專屬功能；是否維持 $0 仍取決於帳號方案和使用量。

## API

除公開轉址和 `/healthz` 外，管理 API 一律需要：

```http
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json
```

| Method | Path | 行為 |
| --- | --- | --- |
| GET / HEAD | `/api/v1/pb` | `{ "text": "..." }`；尚未寫入回 404 |
| POST | `/api/v1/pb` | 接受 `{ "text": "..." }`，成功 204；空字串可以儲存 |
| GET / HEAD | `/api/v1/surl?limit=100&after=CODE` | 回傳 `[{ "url": "...", "shorten": "..." }]` |
| POST | `/api/v1/surl` | `{ "url": "https://example.com/", "shorten": "example" }`；成功 200 |
| DELETE | `/api/v1/surl/CODE` | 成功 204，不存在 404 |
| GET / HEAD | `/CODE` | 公開 302 轉址，不存在 404 |
| GET / HEAD | `/healthz` | 公開 200，只檢查 Worker 能否回應，不檢查 D1 |

剪貼簿上限 **10,000 UTF-8 bytes**，整個 JSON body 上限 65,536 bytes（包含 chunked body 的累積限制）。缺少 `text`、`null`、型別錯誤、格式錯誤都回 400，不會被當作清空操作。錯誤 JSON 統一為 `{ "error": "..." }`。

短網址 `shorten` 省略或空字串時，使用 Web Crypto 產生 8 字元隨機碼。透過原子 INSERT + 唯一主鍵判斷碰撞，最多重試 8 次，絕不覆寫原有連結。指定自訂短碼時則保留「更新同碼目的網址」的行為。

自訂短碼為 1–64 個 ASCII 英數字、`_`、`-`，區分大小寫；`api`、`pb`、`marquee`、`surl`、`assets`、`index`、`healthz` 及其大小寫變體保留給系統。目的網址只接受無內嵌帳密的絕對 HTTP(S) URL，會正規化，拒絕控制字元，正規化後不超過 8,192 bytes。連結不會由伺服器抓取。

清單預設 100 筆，上限 1,000 筆。還有下一頁時，回應的 `X-Next-Cursor` 是最後一筆短碼；將它作為下一次 `after`，直到沒有此 header。資料列仍是陣列，不包新的 envelope。分頁不是跨多個請求的資料快照；匯出時請暫停其他寫入。

```sh
# TOKEN / BASE 請先在你的 shell 設定，以下不會把 secret 寫進 repo。
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/pb"
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"text":"台灣"}' "$BASE/api/v1/pb"
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","shorten":"example"}' "$BASE/api/v1/surl"
curl -I "$BASE/example"
```

## 網頁與安全

剪貼簿前端採 500 ms debounce、序列化寫入及 latest-value coalescing。同一頁面不會把較早請求排在較晚請求之後完成，初次讀取也不會自動把空內容寫回。寫入失敗保留 dirty 狀態，可手動重試；重新讀取/離開頁面會提示未儲存修改。多個裝置同時編輯仍採最後完成的寫入為準，沒有協作編輯、版本 CAS 或自動合併。

token 僅存於目前分頁的 `sessionStorage`（不可用時保存在記憶體），不放 URL 或原始碼。剪貼簿內容不進 URL hash，不使用 `innerHTML` 渲染輸入。網頁提供 CSP，所有 API、錯誤和短網址轉址都是 `Cache-Control: no-store`。不提供寬鬆跨來源 CORS；內建頁面同網域，CLI 不受影響。

這是單人共享 token 工具，不是多租戶服務。讀寫皆需 token；持有 token 者可讀寫整份剪貼簿及所有短網址。D1 儲存的是可供服務讀取的內容，並非端對端加密。公開短網址也不是保密機制。額外的登入、rate limiting 或 Cloudflare Access 請依公開程度設定，避免濫用免費額度。

## 與舊服務的差異 / 切換

API 路徑及主要 JSON 欄位保留，但以下是刻意變更：所有管理 API 新增 token 驗證；轉址由 301 改 302 + no-store；列出短網址改成有上限的游標分頁；自動短碼由 4 碼改 8 碼；自訂碼與 URL 驗證收緊。舊客戶端需要加上 Authorization，完整列舉時必須處理游標。既有瀏覽器曾快取的 301 不能由新伺服器撤銷。

這次重寫不會連線、清空或自動搬移舊 Redis，也不會自動改 DNS。切換前暫停舊服務寫入，從舊 API 讀取 `/api/v1/pb` 和 `/api/v1/surl` 並妥善保存，再透過新 API 寫回剪貼簿及每一個相同 `shorten` 的短網址。先確認舊短碼符合新的規則；不符合時需要先調整規則或另外安排轉址，不能直接忽略失敗。逐筆核對成功回應、完整列出新清單及測試轉址後，才切換網域；保留舊服務和資料直到驗證完成。

## 測試

```sh
cargo fmt --all -- --check
cargo test
cargo clippy --all-targets -- -D warnings
cargo clippy --target wasm32-unknown-unknown -- -D warnings
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm test
npm run build
npm run test:http
npx wrangler deploy --dry-run --outdir build/dry-run
```

Rust 單元測試涵蓋驗證、JSON 型別、token、短碼與分頁；Python SQLite 測試執行 runtime 直接 `include_str!` 的同一組 SQL，驗證唯一鍵、碰撞、刪除和索引；Node 測試剪貼簿寫入佇列。

`test:http` 會建立隔離的暫存 D1、隨機本機 token，啟動真實 Wrangler/workerd 並測試靜態頁面、API、chunked body、並行新增、即時修改/刪除、分頁；之後重新啟動無 token 的 Worker，驗證 fail-closed。它只允許本機回圈位址，不會操作正式資料庫。CI 使用同一流程，僅做部署 dry-run，不做正式部署。
