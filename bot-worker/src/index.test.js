import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractUrls,
  humanSize,
  normalizePath,
  parseCommand,
  renderListing,
  validateRmdirConfirm,
} from "./index.js";

test("normalizePath 去首尾斜杠并折叠重复斜杠", () => {
  assert.equal(normalizePath("/影视//剧集/"), "影视/剧集");
  assert.equal(normalizePath("  a/b  "), "a/b");
  assert.equal(normalizePath("/"), "");
  assert.equal(normalizePath(""), "");
  assert.equal(normalizePath(null), "");
});

test("humanSize 常见档位", () => {
  assert.equal(humanSize(0), "0B");
  assert.equal(humanSize(-5), "0B");
  assert.equal(humanSize(1023), "1023B");
  assert.equal(humanSize(1024 * 1024), "1.0MB");
  assert.equal(humanSize(700 * 1024 * 1024), "700MB");
  assert.equal(humanSize(1.5 * 1024 ** 3), "1.5GB");
});

test("parseCommand 解析命令与参数", () => {
  assert.deepEqual(parseCommand("/ls"), { name: "ls", args: "" });
  assert.deepEqual(parseCommand("/mkdir 影视/剧集"), {
    name: "mkdir",
    args: "影视/剧集",
  });
  assert.deepEqual(parseCommand("/Rm@mybot aBc123XyZ9"), {
    name: "rm",
    args: "aBc123XyZ9",
  });
  assert.equal(parseCommand("这不是命令"), null);
  assert.equal(parseCommand(""), null);
});

test("extractUrls 提取三类链接并去重", () => {
  const text = [
    "https://a.example/f1.mkv",
    "magnet:?xt=urn:btih:abc",
    "ed2k://|file|name|1|2|",
    "https://a.example/f1.mkv",
  ].join("\n");
  const urls = extractUrls(text);
  assert.equal(urls.length, 3);
  assert.equal(urls[0], "https://a.example/f1.mkv");
  assert.ok(urls[1].startsWith("magnet:"));
  assert.ok(urls[2].startsWith("ed2k://"));
});

test("extractUrls 忽略非 http 协议并截断到 20 条", () => {
  assert.deepEqual(extractUrls("ftp://x.com/f"), []);
  const many = Array.from({ length: 30 }, (_, i) => `https://x.com/f${i}`).join("\n");
  assert.equal(extractUrls(many).length, 20);
});

test("validateRmdirConfirm 各分支", () => {
  const okPending = { path: "影视/老片", expiresAt: Date.now() + 60000 };
  assert.deepEqual(
    validateRmdirConfirm(null, "x").ok,
    false
  );
  assert.deepEqual(
    validateRmdirConfirm({ path: "a", expiresAt: Date.now() - 1 }, "a").ok,
    false
  );
  const mismatch = validateRmdirConfirm(okPending, "别的目录");
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.message.includes("/影视/老片"));
  assert.deepEqual(validateRmdirConfirm(okPending, "/影视/老片/"), { ok: true });
});

test("renderListing 输出目录与文件清单", () => {
  const out = renderListing(
    {
      folders: [
        { id: 2, name: "剧集", folder_count: 0, file_count: 3 },
        { id: 1, name: "电影", folder_count: 1, file_count: 0 },
      ],
      files: [
        { filename: "b.mkv", filesize: 2048, short_id: "aBc123XyZ9" },
        { filename: "a.mkv", filesize: 1024, short_id: "ZZZ123XyZ9" },
      ],
    },
    "/影视"
  );
  assert.ok(out.includes("目录 /影视：2 个文件夹，2 个文件"));
  assert.ok(out.includes("[目录] 电影"));
  assert.ok(out.includes("[目录] 剧集"));
  assert.ok(out.indexOf("[文件] a.mkv") < out.indexOf("[文件] b.mkv"));
  assert.ok(out.includes("id=aBc123XyZ9"));
});

test("renderListing 空目录", () => {
  const out = renderListing({ folders: [], files: [] }, "/");
  assert.ok(out.includes("（空）"));
});
