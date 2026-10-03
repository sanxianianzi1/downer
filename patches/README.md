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

## tgstate-rust-panel-folders.patch

给**网页面板**加上目录管理：浏览、新建、改名、级联删除、文件移动/改名。
与 bot 管理面共用同一套 `folders` 数据，两端互通。

- 基线：上游 `bf4253a`（v2.1.7）+ 前三个补丁
- 改动：`src/routes/api_bot.rs`（+94）、`src/database.rs`（+11）、
  `src/routes/mod.rs`（+1）、`app/templates/index.html`、`app/static/js/main.js`（+255）、
  `app/static/css/style.css`（+94）
- 无新增环境变量、无新增数据库迁移（复用第三补丁的 `folders` 表）

### 功能（网页 · 文件管理页）

- 面包屑导航 + 目录卡片网格：点击进入子目录，点面包屑回退
- 「+ 新建目录」：在当前目录下创建
- 目录卡片：改名、删除（级联确认后真删，TG 无回收站）
- 文件行新增「移动到目录」「改名」按钮
- 移动支持路径语义：`/` = 根目录，`/影视/2026` = 逐层目录（服务端解析，与 bot 的 /mv 一致）

### API（复用 bot 的 handler，走面板会话鉴权，未登录 401）

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | /api/folders?parent_id=N | 列子目录+文件（省略 parent_id = 根） |
| POST | /api/folders | 建目录 {name, parent_id?} |
| POST | /api/folders/:id/rename | 目录改名 {name} |
| DELETE | /api/folders/:id | 级联删除（与 bot 同流程，返回失败清单） |
| POST | /api/files/:file_id/move | 移动 {target_folder_id?} 或 {target_path?} |
| PATCH | /api/files/:file_id/rename | 文件改名 {filename} |

handler 在 `api_bot.rs` 内与 `/api/bot/*` 共用（单一实现两处挂载），
面板路由不挂 X-Bot-Key 层，由全局会话中间件保护。
`/api/files` 与列表接口的文件对象新增 `folder_id` 字段。

### 注意

- 页面刷新后目录视图从根目录开始（SSR 仍渲染全量列表，JS 加载后覆盖为根目录视图）
- 搜索框仅过滤当前目录视图内的行
- 部署后浏览器需强刷（模板版本号已升到 `?v=5.6`）

### 验证

浏览器登录面板 → 文件管理页应出现面包屑与「+ 新建目录」；
或 `curl -b <登录cookie> http://127.0.0.1:8000/api/folders`。
