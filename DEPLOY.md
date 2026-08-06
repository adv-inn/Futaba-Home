# 部署说明

futaba.lol 由本仓库的 **GitHub Pages（legacy 模式）** 托管：直接发布 `main` 分支根目录，
**push 即部署，不经由 GitHub Actions**。

## 为什么不用 Actions 部署

原先用 `actions/upload-pages-artifact` + `actions/deploy-pages` 部署，部署通道只有一条：
一旦 GitHub Actions 故障，站点就无法更新，且没有任何人工补救手段。

2026-08-06 的 GitHub Actions/Pages 大规模故障中，v0.14.0 的 `version.json` 已提交进库，
但站点始终发布不出去 —— 客户端读的是 futaba.lol 上的清单，于是**所有用户都收不到更新推送**，
而我们无从干预（`upload-pages-artifact` / `deploy-pages` 是 Actions 专属，本地无法调用）。

改为 legacy 模式后，部署只依赖 git push，保留了人工通道。

## 日常改动

改样式（`src/tailwind.css`、`tailwind.config.js`、HTML 里的 class）后，**必须本地重新构建并提交产物**：

```bash
npm ci            # 首次
npm run build:css # 产出 css/tailwind.css
git add css/tailwind.css && git commit && git push
```

`css/tailwind.css` **已纳入版本控制**（legacy 模式下 Pages 只能托管库里已有的文件）。
CI（`.github/workflows/deploy.yml`）会校验提交的产物与源是否一致，防止漏构建；
它失败不影响部署，只是提醒补一次构建。

## 版本清单

`version.json` / `update.json` 由主仓库 `adv-inn/futaba-agent` 的 publish 工作流自动
clone 本仓库、改文件、push 更新。它们是纯静态数据，不需要构建。

客户端读取方式：

| 文件 | 用途 |
|------|------|
| `update.json` | Tauri OTA 自动更新（`tauri.conf.json` 的 `endpoints`）|
| `version.json` | 应用内更新提示与手动下载引导（`update_service.rs`）|

## 应急：手动发布某个版本

当 publish 工作流的部署步骤失败（如 Actions 故障）时，可手动补：

```bash
gh repo clone adv-inn/Futaba-Home && cd Futaba-Home
# 按 GitHub Release 的实际内容修正版本号 / 下载链接 / 签名
$EDITOR version.json update.json
git commit -am "chore: manually publish vX.Y.Z manifests" && git push
```

push 完成后 Pages 自动发布，通常一分钟内生效。验证：

```bash
curl -s "https://futaba.lol/version.json?t=$(date +%s)" | head -5
curl -s "https://futaba.lol/update.json?t=$(date +%s)" | head -5
```
