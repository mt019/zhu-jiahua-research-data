# 同步模型

資料流固定為單向：

```text
zhu-jiahua-research-data/data/processed/zhu-jiahua-app.json
  → npm run sync
  → my-canvas-lab/src/data/zhuJiahua.json
  → React 前端
```

Canvas Lab 不反向寫回資料倉，也不在建置或瀏覽器執行期間讀取私人倉庫。同步採人工觸發，避免部署環境依賴不存在的相鄰資料倉。
