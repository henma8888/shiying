# 拾影

貼上公開 Instagram 或 Threads 連結。頁面會先檢查有冇相片或影片，顯示數量同預覽，然後自動下載。多過一個檔案會合成一個 zip。完成之後會顯示「已下載」。

網址：<https://henma8888.github.io/shiying/>

只保存你有權保存嘅公開貼文。私人帳號、限時動態、已刪除，同未滿 21 歲先睇到嘅內容，都下載唔到。呢個網頁唔會問你 Instagram 密碼。

## 用 GitHub Pages 打開

Repo 已經包含建置好嘅 `docs/`。喺 GitHub：

1. 打開 **Settings → Pages**
2. **Build and deployment** 揀 **Deploy from a branch**
3. Branch 揀 `main`，folder 揀 `/docs`
4. 儲存之後，用上面個網址打開

呢個專案唔用 GitHub Actions 部署。更新網站就係改完再行 `npm run build`，將 `docs/` 一併提交去 `main`。

## 點用

1. 喺 Instagram 或 Threads 打開一則公開貼文，撳分享，複製連結。
2. 打開拾影，貼上連結，或者撳「貼上」由剪貼簿讀取。
3. 頁面會檢查。搵到就會話你有幾多張相片、幾條影片，並顯示預覽，然後自動下載。
4. 「清除」會清走連結、預覽同狀態。

Chrome、Edge 同 Android Chrome 第一次會問你確認「下載項目」。檔案之後會放入入面嘅「拾影」資料夾（下載項目/拾影），之後同一部瀏覽器唔使再問。Safari 同 iPhone 唔准網頁自己開子資料夾，檔案會去預設嘅「下載項目」或「檔案」，頁面會講一句。相片可以長按預覽圖，揀「儲存影像」。

Chrome 或 Edge 可以將拾影安裝到桌面：網址列有安裝圖示，又或者頁面底部出現「安裝到桌面」。裝好之後會用自己嘅視窗打開。Android 同 iPhone 可以用「加入主畫面」。呢個掣只會喺瀏覽器真係可以安裝嗰陣先出現。

## 本地開發

```bash
npm install
npm run dev
npm test
npm run build
```

`npm run dev` 會喺 <http://localhost:5173/shiying/> 開預覽。`npm run build` 會將靜態網站輸出去 `docs/`，base path 係 `/shiying/`，對應上面個 Pages 網址。

## 限制

呢個係靜態網站，冇一部長開嘅私人伺服器。

- **Instagram** 會先問公開嘅 Cobalt 實例。佢而家對好多連結回空，所以會再讀 Instagram 公開 embed 頁（經 `https://r.jina.ai/`）。官方 `api.cobalt.tools` 有機器人驗證，呢個網頁冇用佢。
- **Threads** 讀公開貼文頁。如果嗰邊被擋，公開相片會再用 `https://api.microlink.io/` 嘅預覽圖。媒體檔喺 Instagram CDN，瀏覽器可以直接下載。
- 以上兩個都係外人維護嘅公開服務。佢哋限流、關閉或者改規則，拾影就會跟住失敗，頁面會寫明係限流、要登入，定係連線失敗。
- 有啲公開單張相片，未登入嘅接口根本唔會交檔案出嚟。呢種情況會話你未登入搵唔到，而唔會假裝成「暫時無回應」。
- 私人帳號、限時動態、精選動態、已刪除，同有年齡限制（未滿 21 歲）嘅內容，下載唔到。
- 短時間內查太多，Cobalt、Instagram 或 Threads 都會叫你等一陣。
