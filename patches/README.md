# patches/

上游克隆的本地补丁。`tgstate-rust/` 本身被 `.gitignore` 排除，补丁存在这里，
所以新机器可以完整复原。

## tgstate-rust-10gib-body-limit.patch

把 tgstate-rust 的上传体积上限从 **512 MiB** 提到 **10 GiB**。

- 基线：上游 `buyi06/tgstate-rust` 提交 `bf4253a`（tag `v2.1.7`）
- 改动：`src/constants.rs`、`src/main.rs`（+18 / -3）
- 新增环境变量：`MAX_UPLOAD_BODY_SIZE_MB`（兆字节，最小 16，默认 10240）

### 为什么需要

`src/main.rs` 原本写死 `.layer(DefaultBodyLimit::max(512 * 1024 * 1024))`。
axum 的 `DefaultBodyLimit` 在**读取请求体阶段**就中断连接，早于业务 handler 执行，
所以超过 512 MiB 的上传失败时**容器日志里没有任何业务错误**，只有客户端看到连接被断开。

补丁把常量换成运行时读取的函数 `max_upload_body_size()`，并在启动日志里打印实际上限。

### 怎么用

仓库根目录执行：

    ./setup-tgstate-rust.sh

自动完成：clone 上游 → 切到基线 → 打补丁 → 自检 → `docker compose up -d --build`。
只想准备代码、不构建，加 `--prep`。

### 手动打补丁

    cd tgstate-rust
    git apply ../patches/tgstate-rust-10gib-body-limit.patch

### 升级上游版本时

上游发新版本后补丁可能不再干净应用。步骤：

1. `cd tgstate-rust && git fetch --tags`
2. 挑新 tag，先试 `git apply --check ../patches/tgstate-rust-10gib-body-limit.patch`
3. 冲突就手工改两处：`src/constants.rs` 的 `max_upload_body_size()`，
   `src/main.rs` 的 `.layer(DefaultBodyLimit::max(max_body))`
4. 用 `git diff <旧tag> HEAD > ../patches/tgstate-rust-10gib-body-limit.patch` 重新导出，
   并同步更新 `setup-tgstate-rust.sh` 里的 `BASE`

### 验证上限是否生效

容器启动日志会打印一行 `上传体积上限: 10240 MiB`。检查：

    docker compose logs tgstate | grep 上传体积上限

## tgstate-rust-folders-botapi.patch

给 tgstate-rust 加**文件夹树**和 **bot 管理面 API**（/api/bot/*）。

- 基线：上游 `bf4253a`（v2.1.7）+ 前两个补丁
- 改动：`src/database.rs`（+249）、`src/middleware/auth.rs`（+2）、
  `src/routes/api_bot.rs`（新文件）、`src/routes/mod.rs`（+2）
- 新增环境变量：`BOT_API_KEY`（bot 管理面密钥）

### 功能

`folders` 表（id / name / parent_id）+ `files.folder_id` 列（NULL = 根目录），
沿用 PRAGMA 检查式迁移，旧库原地升级。workflow 上传的文件照旧落根目录。

### API（全部走 X-Bot-Key 头）

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | /api/bot/folders?parent_id=N | 列子目录+文件（省略 parent_id = 根） |
| POST | /api/bot/folders | 建目录 {name, parent_id?} |
| POST | /api/bot/folders/:id/rename | 目录改名 {name} |
| DELETE | /api/bot/folders/:id | 级联删除（递归 CTE 收子树，逐文件走 TG 删除流程） |
| POST | /api/bot/files/:file_id/move | 移动 {target_folder_id?}（null = 根） |
| PATCH | /api/bot/files/:file_id | 文件改名 {filename} |
| DELETE | /api/bot/files/:file_id | 删文件（同面板删除流程） |

### 安全模型

- `BOT_API_KEY` 未配置 → 整面 503（fail closed），bot 侧收到明确提示
- `X-Bot-Key` 常量时间比对（复用 `auth::secure_compare`），不匹配 → 401
- 全局 auth 中间件放行 `/api/bot/` 前缀，鉴权由本模块自理
- 面板 UI 的会话登录、上传、分享链接完全不受影响

### 删除语义（与面板一致）

- 主消息删除成功 → 删 DB 行、累计释放字节；分块失败仅记录 failed_chunks
- 主消息删除失败 → 文件行保留并移回根目录，列入 failed_files 供重试
- 已发布的 /d/<short_id> 链接：move/rename 不改 short_id，持续有效；删除即失效

### 验证

    curl -s -H "X-Bot-Key: $TGSTATE_BOT_KEY" http://127.0.0.1:8000/api/bot/folders
