# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Entries

[Project Knowledge Summary]
- Date: 2026-10-01
- Context: Agent 调试 download-and-upload 工作流 Gopeed 下载失败（GHA run 36802040057），实际复现验证
- Category: Troubleshooting & Debugging
- Instructions:
  - 夸克网盘直链（dl-pc-zb.drive.quark.cn）由阿里 Tengine WAF 保护：Cookie 缺失或无效时返回 412 Precondition Failed；Cookie 有效时同链接同配置可正常下载
  - 失败特征：Gopeed 任务创建成功（code=0）后数秒内 status=error 且 errorDetail=null；workflow 日志只显示"Gopeed 下载失败"，需先怀疑 GOPEED_COOKIE secret 内容无效/过期
  - 复现方法：本地运行 gopeed-web-v1.9.3（-A 127.0.0.1 -P 9999），POST /api/v1/tasks，Cookie 放在 req.extra.header 里，connections=16；用 curl -r 0-1023 带 Cookie 可快速预检链接可用性（206=可用，412=Cookie 无效）
  - 修复方式：更新 GitHub secret GOPEED_COOKIE 为最新有效的夸克 Cookie（__puus 等字段会随登录状态轮换）

[Project Knowledge Summary]
- Date: 2026-10-01
- Context: Agent 指导用户把 bot-worker 部署到 AWS VPS（Debian 12 + Docker bridge），bot 容器连 api.telegram.org 持续 ETIMEDOUT
- Category: Troubleshooting & Debugging
- Instructions:
  - 现象：宿主机 curl 与容器内 busybox wget 均可通 api.telegram.org，唯独 Node fetch 报 AggregateError ETIMEDOUT（errors 两个 = v4/v6 双超时），bot 启动即退、restart 循环
  - 根因：Node 22 net.connect 默认 autoSelectFamily 并行尝试 v4/v6，autoSelectFamilyAttemptTimeout 默认 250ms；AWS + Docker bridge 下 SYN 往返稍慢即全部误判超时
  - 定位方法：`docker compose run --rm bot node -e "fetch('https://api.telegram.org/')..."` 与 wget 对照，Node 失败而 wget 成功即此问题
  - 修复：docker-compose.yml 的 bot 服务加 `command: ["node", "--no-network-family-autoselection", "--dns-result-order=ipv4first", "src/index.js"]`；重建容器后恢复正常

[Project Knowledge Summary]
- Date: 2026-10-03
- Context: Agent 在沙盒重建 tgstate-rust 基线并实施第三个补丁（folders + bot 管理面），导出补丁时两次踩坑
- Category: Build Methods
- Instructions:
  - tgstate-rust 补丁生成流程：沙盒 clone 上游 → checkout 基线 bf4253a → 依次 apply patches/ 全部补丁 → 分两次 commit（先 p1+p2 涉及文件，再新功能全部文件）→ `git diff HEAD~1 HEAD` 才是新补丁；直接 `git diff 基线` 会混入旧补丁
  - diff 会把 cargo 本地重新生成的 Cargo.lock 一并收录，导出时必须 `-- src/` 排除；新文件要先 `git add -N` 才进 diff
  - 补丁验收标准：在干净基线上按文件名顺序 `git apply --check` 全部通过 + `cargo check` 0 error + `cargo test` 全过（沙盒 rustup 安装 cargo 1.99 可用；openssl-sys 需 `apt-get update && apt-get install -y pkg-config libssl-dev`，与 VPS Dockerfile 一致）
  - cargo check/test 必须走 background_terminal_create（cpu 200 / memory 25 / timeout 20 分钟）；rusqlite 尾块内 `stmt.query_map(..)?.collect()` 形状会报 E0597，改成平铺 `let sql; let mut stmt; let rows = stmt...collect();` 即可（与 database.rs get_all_files 同形状）
