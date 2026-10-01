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
