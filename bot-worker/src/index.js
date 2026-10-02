const TELEGRAM_API = "https://api.telegram.org";
const GITHUB_API = "https://api.github.com";
const EVENT_TYPE = "download-task";
const POLL_TIMEOUT_SEC = 50;

const HELP_TEXT = [
  "下载机器人使用方法：",
  "",
  "直接发送一条下载链接，支持：",
  "- http/https 直链（含 .torrent）",
  "- magnet:?xt=urn:btih:...",
  "- ed2k://|file|...",
  "",
  "机器人会把任务提交到 GitHub Actions，用 Gopeed 下载后 rclone 转存，并上传 tgstate，分享链接发回本会话。",
  "",
  "支持一次粘贴多条链接（换行分隔），每条链接独立排队处理。",
  "",
  "命令：/help 查看本说明",
].join("\n");

function requireEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) {
    console.error(`缺少环境变量 ${name}`);
    process.exit(1);
  }
  return v;
}

const env = {
  BOT_TOKEN: requireEnv("BOT_TOKEN"),
  GITHUB_TOKEN: requireEnv("GITHUB_TOKEN"),
  GITHUB_REPO: requireEnv("GITHUB_REPO"),
  ALLOWED_USER_IDS: (process.env.ALLOWED_USER_IDS || "").trim(),
};

async function sendTelegramMessage(chatId, text) {
  const resp = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!resp.ok) {
    console.error(`sendMessage failed: ${resp.status} ${await resp.text()}`);
  }
}

function isAllowedUser(userId) {
  const allowList = env.ALLOWED_USER_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  return allowList.includes(userId);
}

const MAX_URLS_PER_MESSAGE = 20;

function extractUrls(text) {
  const urls = [];
  const seen = new Set();
  const re = /magnet:\?[^\s<>"'`]+|ed2k:\/\/[^\s<>"'`]+|https?:\/\/[^\s<>"'`]+/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    if (seen.has(raw)) continue;
    if (/^https?:/i.test(raw)) {
      try {
        const u = new URL(raw);
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      } catch {
        continue;
      }
    }
    seen.add(raw);
    urls.push(raw);
    if (urls.length >= MAX_URLS_PER_MESSAGE) break;
  }
  return urls;
}

async function dispatchDownload(url, chatId) {
  return fetch(`${GITHUB_API}/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "tg-download-bot",
    },
    body: JSON.stringify({
      event_type: EVENT_TYPE,
      client_payload: {
        url,
        chat_id: String(chatId),
      },
    }),
  });
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message || typeof message.text !== "string") return;

  const chatId = message.chat.id;
  const fromId = message.from ? message.from.id : null;

  if (!isAllowedUser(fromId)) {
    await sendTelegramMessage(chatId, "未授权用户，无法使用本机器人。");
    return;
  }

  const text = message.text.trim();
  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendTelegramMessage(chatId, HELP_TEXT);
    return;
  }

  const dispatchHints = {
    401: "GitHub Token 无效或过期。",
    403: "GitHub Token 权限不足，需要对仓库的 Contents 读写权限。",
    404: "仓库不存在或 Token 无权访问，请检查 GITHUB_REPO 配置。",
    422: "仓库中没有监听 download-task 事件的 workflow，请确认 workflow 文件已推送到默认分支。",
  };

  const urls = extractUrls(text);
  if (urls.length === 0) {
    await sendTelegramMessage(
      chatId,
      "未识别到下载链接，请发送 http/https、magnet 或 ed2k 链接。"
    );
    return;
  }

  const describeUrl = (u) => {
    if (!/^https?:/i.test(u)) return u.length > 80 ? `${u.slice(0, 77)}...` : u;
    try {
      const parsed = new URL(u);
      const name = parsed.searchParams.get("filename");
      if (name) return `${parsed.host} · ${name}`;
    } catch {}
    return u.length > 80 ? `${u.slice(0, 77)}...` : u;
  };

  const submitted = [];
  const failed = [];
  for (const url of urls) {
    let resp;
    try {
      resp = await dispatchDownload(url, chatId);
    } catch (e) {
      failed.push(`${describeUrl(url)}\n    网络错误：${e.message}`);
      continue;
    }
    if (resp.ok) {
      submitted.push(url);
      continue;
    }
    const body = await resp.text().catch(() => "");
    const hint = dispatchHints[resp.status] || `HTTP ${resp.status} ${body.slice(0, 200)}`;
    failed.push(`${describeUrl(url)}\n    ${hint}`);
  }

  const lines = [];
  if (submitted.length > 0) {
    lines.push(
      `已提交 ${submitted.length} 个任务，GitHub Actions 排队处理中（完成后分享链接会逐条发到这里）：`,
      ...submitted.map((u) => `· ${describeUrl(u)}`)
    );
  }
  if (failed.length > 0) {
    lines.push(`提交失败 ${failed.length} 个：`, ...failed.map((f) => `· ${f}`));
  }
  await sendTelegramMessage(chatId, lines.join("\n"));
}

async function telegramCall(method, params) {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const resp = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/${method}${qs}`);
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || data.ok !== true) {
    const desc = data && data.description ? data.description : `HTTP ${resp.status}`;
    throw new Error(`${method} failed: ${desc}`);
  }
  return data.result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await telegramCall("deleteWebhook", { drop_pending_updates: "true" });
  console.log(`bot started, repo=${env.GITHUB_REPO}`);

  let offset = 0;
  let backoff = 1000;

  for (;;) {
    try {
      const updates = await telegramCall("getUpdates", {
        offset: String(offset),
        timeout: String(POLL_TIMEOUT_SEC),
        allowed_updates: JSON.stringify(["message"]),
      });
      backoff = 1000;
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (e) {
          console.error(`handleUpdate error: ${e && e.stack ? e.stack : e}`);
        }
      }
    } catch (e) {
      console.error(`poll error: ${e.message}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
