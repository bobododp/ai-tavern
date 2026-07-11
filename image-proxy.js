const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

let host = process.env.TAVERN_PROXY_HOST || "127.0.0.1";
let port = Number(process.env.TAVERN_PROXY_PORT || 8787);
let root = __dirname;
let generatedImagesDir = process.env.TAVERN_IMAGE_DIR || path.join(root, "generated-images");

const defaultImageWaitMs = Number(process.env.TAVERN_IMAGE_WAIT_MS || 90000);
const defaultTaskWaitMs = Number(process.env.TAVERN_IMAGE_TASK_WAIT_MS || 45000);
const taskPollIntervalMs = Number(process.env.TAVERN_IMAGE_POLL_MS || 5000);

let lastImageDebug = null;

function configureProxy(options = {}) {
  host = options.host || process.env.TAVERN_PROXY_HOST || host || "127.0.0.1";
  port = Number(options.port || process.env.TAVERN_PROXY_PORT || port || 8787);
  root = options.rootDir || process.env.TAVERN_STATIC_ROOT || root || __dirname;
  generatedImagesDir = options.imageDir || process.env.TAVERN_IMAGE_DIR || generatedImagesDir || path.join(root, "generated-images");
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization",
    "Access-Control-Allow-Private-Network": "true",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8" });
}

function maskApiKey(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function previewText(value, limit = 160) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function summarizeJsonShape(value, depth = 0) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (!value.length) return ["empty"];
    if (depth >= 2) return ["array"];
    return [summarizeJsonShape(value[0], depth + 1)];
  }
  if (typeof value === "object") {
    if (depth >= 2) return Object.keys(value);
    return Object.fromEntries(
      Object.keys(value)
        .slice(0, 16)
        .map((key) => [key, summarizeJsonShape(value[key], depth + 1)]),
    );
  }
  return typeof value;
}

function buildErrorInfo(payload, status) {
  const errorNode = payload && typeof payload.error === "object" ? payload.error : null;
  const message =
    errorNode?.message ||
    (typeof payload?.error === "string" ? payload.error : "") ||
    payload?.message ||
    payload?.detail ||
    payload?.msg ||
    "";
  const code = errorNode?.code || payload?.code || payload?.status_code || "";
  const finalStatus = status || errorNode?.status || payload?.status || payload?.statusCode || "";
  return {
    message: String(message || `Upstream returned HTTP ${status || "unknown"}`).trim(),
    code: String(code || "").trim(),
    status: String(finalStatus || "").trim(),
  };
}

function rememberImageDebug(record) {
  lastImageDebug = record;
}

function logImageDebug(label, record) {
  console.log(`[image-proxy] ${label}`, JSON.stringify(record, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageExtensionFromContentType(contentType = "") {
  if (/jpeg|jpg/i.test(contentType)) return ".jpg";
  if (/webp/i.test(contentType)) return ".webp";
  return ".png";
}

async function saveGeneratedImage(imageUrl, taskId = "") {
  const url = String(imageUrl || "").trim();
  if (!url) return null;

  await fs.promises.mkdir(generatedImagesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTask = String(taskId || "image").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60);

  if (/^data:image\//i.test(url)) {
    const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return null;
    const ext = imageExtensionFromContentType(match[1]);
    const filename = `${stamp}-${safeTask}${ext}`;
    const filePath = path.join(generatedImagesDir, filename);
    await fs.promises.writeFile(filePath, Buffer.from(match[2], "base64"));
    return {
      localPath: filePath,
      localUrl: `/generated-images/${filename}`,
      imageUrl: `http://${host}:${port}/generated-images/${filename}`,
    };
  }

  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    const ext = imageExtensionFromContentType(contentType);
    const filename = `${stamp}-${safeTask}${ext}`;
    const filePath = path.join(generatedImagesDir, filename);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(filePath, bytes);
    return {
      localPath: filePath,
      localUrl: `/generated-images/${filename}`,
      imageUrl: `http://${host}:${port}/generated-images/${filename}`,
    };
  }

  return null;
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function buildImageEndpoint(apiUrl) {
  const url = String(apiUrl || "").replace(/\/$/, "");
  if (!url) throw new Error("缺少生图 API 地址");
  if (url.endsWith("/images/generations")) return url;
  return `${url}/images/generations`;
}

function buildImageEndpoint(apiUrl) {
  const url = String(apiUrl || "").trim().replace(/\/$/, "");
  if (!url) throw new Error("Missing image API URL");
  try {
    const parsed = new URL(url);
    if (/siliconflow\.cn$/i.test(parsed.hostname)) {
      const apiOrigin = "https://api.siliconflow.cn";
      const pathname = parsed.hostname === "api.siliconflow.cn" ? parsed.pathname.replace(/\/$/, "") : "";
      if (pathname.endsWith("/v1/images/generations")) return `${apiOrigin}${pathname}`;
      if (pathname.endsWith("/images/generations")) return `${apiOrigin}/v1/images/generations`;
      if (pathname.endsWith("/v1")) return `${apiOrigin}/v1/images/generations`;
      return `${apiOrigin}/v1/images/generations`;
    }
  } catch {
    // Use the generic OpenAI-compatible join below.
  }
  if (url.endsWith("/images/generations")) return url;
  return `${url}/images/generations`;
}

function isSiliconFlowEndpoint(endpoint) {
  try {
    return new URL(endpoint).hostname === "api.siliconflow.cn";
  } catch {
    return false;
  }
}

function buildImageRequestPayload({ endpoint, model, prompt, size }) {
  if (isSiliconFlowEndpoint(endpoint)) {
    return {
      model,
      prompt,
      image_size: size || "1024x1024",
    };
  }
  return {
    model,
    prompt,
    size: size || "1024x1024",
  };
}

function buildApiOrigin(apiUrl) {
  return new URL(buildImageEndpoint(apiUrl)).origin;
}

function uniqueList(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildStreamTicketCandidates(apiUrl) {
  const origin = buildApiOrigin(apiUrl);
  return uniqueList([
    `${origin}/generate/stream-ticket`,
    `${origin}/api/web/generate/stream-ticket`,
  ]);
}

function buildStreamCandidates(apiUrl, taskId, ticket) {
  const origin = buildApiOrigin(apiUrl);
  const encodedTaskId = encodeURIComponent(taskId);
  const encodedTicket = encodeURIComponent(ticket);
  return uniqueList([
    `${origin}/api/web/generate/stream/${encodedTaskId}?ticket=${encodedTicket}`,
    `${origin}/generate/stream/${encodedTaskId}?ticket=${encodedTicket}`,
  ]);
}

function buildTaskQueryCandidates(apiUrl, taskId) {
  const endpoint = buildImageEndpoint(apiUrl);
  const apiBase = endpoint.replace(/\/images\/generations\/?$/, "");
  const origin = new URL(endpoint).origin;
  const encodedTaskId = encodeURIComponent(taskId);
  return uniqueList([
    `${apiBase}/images/generations/${encodedTaskId}`,
    `${apiBase}/images/generations/${encodedTaskId}/result`,
    `${apiBase}/images/tasks/${encodedTaskId}`,
    `${apiBase}/tasks/${encodedTaskId}`,
    `${apiBase}/generate/task/${encodedTaskId}`,
    `${origin}/generate/task/${encodedTaskId}`,
    `${origin}/api/web/generate/task/${encodedTaskId}`,
  ]);
}

function resolveImageValue(value) {
  if (typeof value !== "string") return "";
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(data:image|https?:\/\/|blob:)/i.test(text)) return text;
  return `data:image/png;base64,${text}`;
}

function resolveImageNode(node) {
  if (!node) return "";
  if (typeof node === "string") return resolveImageValue(node);
  if (typeof node !== "object") return "";

  if (Array.isArray(node.result_urls)) return resolveImageValue(node.result_urls[0]);
  if (Array.isArray(node.urls)) return resolveImageValue(node.urls[0]);

  return (
    resolveImageValue(node.result_url) ||
    resolveImageValue(node.url) ||
    resolveImageValue(node.imageUrl) ||
    resolveImageValue(node.image_url) ||
    resolveImageValue(node.b64_json) ||
    resolveImageValue(node.base64) ||
    resolveImageValue(node.image)
  );
}

function resolveImageUrl(payload) {
  const primitiveCandidates = [
    payload?.image_url,
    payload?.imageUrl,
    payload?.result_url,
    payload?.image,
    payload?.b64_json,
    payload?.base64,
    payload?.result?.image_url,
    payload?.result?.imageUrl,
    payload?.result?.result_url,
    payload?.result?.image,
    payload?.result?.b64_json,
    payload?.result?.base64,
    payload?.result_urls?.[0],
    payload?.urls?.[0],
    payload?.result?.result_urls?.[0],
    payload?.result?.urls?.[0],
    payload?.images?.[0],
    payload?.output?.[0]?.url,
    payload?.output?.[0]?.image_url,
    payload?.result?.output?.[0]?.url,
    payload?.result?.output?.[0]?.image_url,
  ];
  for (const candidate of primitiveCandidates) {
    const value = resolveImageValue(candidate);
    if (value) return value;
  }

  const objectCandidates = [
    payload,
    payload?.result,
    payload?.data?.[0],
    payload?.images?.[0],
    payload?.output?.[0],
    payload?.result?.data?.[0],
    payload?.result?.images?.[0],
    payload?.result?.output?.[0],
  ];
  for (const candidate of objectCandidates) {
    const imageUrl = resolveImageNode(candidate);
    if (imageUrl) return imageUrl;
  }
  return "";
}

function findImageTask(payload) {
  const candidates = [
    payload,
    payload?.result,
    payload?.data?.[0],
    payload?.task,
    payload?.result?.task,
  ].filter(Boolean);

  for (const item of candidates) {
    if (typeof item !== "object") continue;
    const taskId = item.task_id || item.taskId || item.id || item.task;
    const status = String(item.status || item.state || payload?.status || "").toLowerCase();
    if (taskId && !resolveImageUrl(payload)) {
      return {
        taskId: String(taskId),
        status,
      };
    }
  }
  return null;
}

function findTaskStatus(payload) {
  const candidates = [
    payload,
    payload?.result,
    payload?.data?.[0],
    payload?.task,
    payload?.result?.task,
  ].filter(Boolean);

  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const status = item.status || item.state;
    if (status !== undefined && status !== null && String(status).trim()) {
      return String(status).trim().toLowerCase();
    }
  }
  return String(payload?.status || payload?.state || "").trim().toLowerCase();
}

function extractStreamTicket(payload) {
  const candidates = [
    payload?.ticket,
    payload?.stream_ticket,
    payload?.data?.ticket,
    payload?.data?.stream_ticket,
    payload?.result?.ticket,
    payload?.result?.stream_ticket,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function isTaskStillRunning(status) {
  return [
    "",
    "pending",
    "queued",
    "running",
    "processing",
    "submitted",
    "in_progress",
    "starting",
  ].includes(String(status || "").toLowerCase());
}

function isTaskCompleted(status) {
  return ["completed", "succeeded", "success", "done", "finished", "ready"].includes(
    String(status || "").toLowerCase(),
  );
}

function isTaskFailed(status) {
  return ["failed", "failure", "error", "cancelled", "canceled", "rejected", "violation"].includes(
    String(status || "").toLowerCase(),
  );
}

function buildPendingTaskPayload(taskId, status, raw, waitMs) {
  return {
    task_id: taskId,
    status: status || "pending",
    message: waitMs
      ? `生图任务仍在进行中，代理已等待约 ${Math.round(waitMs / 1000)} 秒。`
      : "生图任务仍在进行中。",
    raw,
  };
}

async function fetchJsonWithText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
    text,
    json: safeJsonParse(text),
  };
}

function pushTrace(trace, stage, detail) {
  trace.push({
    at: new Date().toISOString(),
    stage,
    ...detail,
  });
}

async function requestStreamTicket({ apiUrl, apiKey, trace }) {
  for (const endpoint of buildStreamTicketCandidates(apiUrl)) {
    const response = await fetchJsonWithText(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const entry = {
      endpoint,
      status: response.status,
      ok: response.ok,
      jsonShape: summarizeJsonShape(response.json),
      json: response.json,
      textPreview: response.json ? "" : previewText(response.text, 600),
    };
    pushTrace(trace, "stream-ticket", entry);
    logImageDebug("stream-ticket", {
      endpoint,
      status: response.status,
      ok: response.ok,
      jsonShape: entry.jsonShape,
    });

    if (!response.ok) continue;

    const ticket = extractStreamTicket(response.json || {});
    if (ticket) {
      return { ticket, endpoint };
    }
  }
  return null;
}

async function readSseUntilTerminal({ streamUrl, deadline, trace }) {
  const remainingMs = Math.max(1000, deadline - Date.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remainingMs);

  try {
    const response = await fetch(streamUrl, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });

    pushTrace(trace, "stream-open", {
      endpoint: streamUrl,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") || "",
    });
    logImageDebug("stream-open", {
      endpoint: streamUrl,
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok || !response.body) {
      return { ok: false, reason: `stream-http-${response.status}` };
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let eventLines = [];
    let lastPayload = null;
    let lastStatus = "";

    function flushEvent() {
      if (!eventLines.length) return null;
      const joined = eventLines.join("\n").trim();
      eventLines = [];
      if (!joined) return null;
      const payload = safeJsonParse(joined);
      if (!payload) {
        pushTrace(trace, "stream-event-text", {
          textPreview: previewText(joined, 400),
        });
        return null;
      }

      lastPayload = payload;
      lastStatus = findTaskStatus(payload) || lastStatus;
      pushTrace(trace, "stream-event", {
        status: lastStatus,
        jsonShape: summarizeJsonShape(payload),
        json: payload,
      });
      logImageDebug("stream-event", {
        status: lastStatus,
        jsonShape: summarizeJsonShape(payload),
      });

      if (resolveImageUrl(payload)) {
        return { terminal: "completed", payload, status: lastStatus };
      }
      if (isTaskCompleted(lastStatus) || isTaskFailed(lastStatus)) {
        return {
          terminal: isTaskFailed(lastStatus) ? "failed" : "completed",
          payload,
          status: lastStatus,
        };
      }
      return null;
    }

    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);

        if (!line.trim()) {
          const terminal = flushEvent();
          if (terminal) return { ok: true, ...terminal };
          continue;
        }

        if (line.startsWith("data:")) {
          eventLines.push(line.slice(5).trim());
        }
      }
    }

    const tailEvent = flushEvent();
    if (tailEvent) return { ok: true, ...tailEvent };

    return { ok: false, reason: "stream-ended", payload: lastPayload, status: lastStatus };
  } catch (error) {
    pushTrace(trace, "stream-error", {
      endpoint: streamUrl,
      message: error.message,
    });
    logImageDebug("stream-error", {
      endpoint: streamUrl,
      message: error.message,
    });
    return { ok: false, reason: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryStreamTaskResult({ apiUrl, apiKey, taskId, deadline, trace }) {
  const ticketResult = await requestStreamTicket({ apiUrl, apiKey, trace });
  if (!ticketResult?.ticket) {
    return { ok: false, reason: "ticket-unavailable" };
  }

  for (const streamUrl of buildStreamCandidates(apiUrl, taskId, ticketResult.ticket)) {
    const result = await readSseUntilTerminal({ streamUrl, deadline, trace });
    if (result.ok) return result;
    if (Date.now() >= deadline) return result;
  }

  return { ok: false, reason: "stream-unavailable" };
}

async function pollTaskResult({ apiUrl, apiKey, taskId, deadline, trace }) {
  let lastPayload = null;
  let lastStatus = "pending";
  let lastError = null;
  let round = 0;

  while (Date.now() < deadline) {
    round += 1;
    let sawOkJsonThisRound = false;

    for (const endpoint of buildTaskQueryCandidates(apiUrl, taskId)) {
      const response = await fetchJsonWithText(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const status = findTaskStatus(response.json || {}) || lastStatus;
      const entry = {
        round,
        endpoint,
        statusCode: response.status,
        ok: response.ok,
        taskStatus: status,
        jsonShape: summarizeJsonShape(response.json),
        json: response.json,
        textPreview: response.json ? "" : previewText(response.text, 600),
      };
      pushTrace(trace, "task-poll", entry);
      logImageDebug("task-poll", {
        round,
        endpoint,
        statusCode: response.status,
        ok: response.ok,
        taskStatus: status,
        jsonShape: entry.jsonShape,
      });

      if (!response.json || typeof response.json !== "object") {
        lastError = {
          message: `任务查询接口没有返回 JSON：${endpoint}`,
          code: "task_poll_non_json",
          status: String(response.status || ""),
        };
        continue;
      }

      if (!response.ok) {
        lastError = buildErrorInfo(response.json || {}, response.status);
        continue;
      }

      sawOkJsonThisRound = true;
      lastPayload = response.json || {};
      lastStatus = status;

      if (resolveImageUrl(lastPayload)) {
        return { state: "completed", payload: lastPayload, status: lastStatus };
      }
      if (isTaskCompleted(lastStatus)) {
        return { state: "completed", payload: lastPayload, status: lastStatus };
      }
      if (isTaskFailed(lastStatus)) {
        return { state: "failed", payload: lastPayload, status: lastStatus };
      }

      break;
    }

    if (!sawOkJsonThisRound) {
      return {
        state: "failed",
        payload: {
          error: {
            message: "上游返回了 task_id，但所有任务查询地址都没有返回 JSON。当前 MaiziAI OpenAI 兼容接口可能不支持用 API Key 查询这个异步 task_id，或任务查询 endpoint 已变化。",
            code: "task_poll_endpoint_unavailable",
            status: "endpoint_invalid",
          },
          task_id: taskId,
          last_error: lastError,
        },
        status: "endpoint_invalid",
        error: lastError,
      };
    }

    if (Date.now() + taskPollIntervalMs >= deadline) break;
    await sleep(taskPollIntervalMs);
  }

  return {
    state: "pending",
    payload: lastPayload,
    status: lastStatus,
    error: lastError,
  };
}

async function waitForImageTaskResult({ apiUrl, apiKey, taskId, waitMs, trace }) {
  const deadline = Date.now() + Math.max(1000, Number(waitMs) || defaultTaskWaitMs);

  const streamResult = await tryStreamTaskResult({ apiUrl, apiKey, taskId, deadline, trace });
  if (streamResult.ok) {
    if (streamResult.terminal === "failed") {
      return {
        state: "failed",
        payload: streamResult.payload || {},
        status: streamResult.status || "failed",
      };
    }
    if (resolveImageUrl(streamResult.payload)) {
      return {
        state: "completed",
        payload: streamResult.payload,
        status: streamResult.status || "completed",
      };
    }
  }

  return pollTaskResult({ apiUrl, apiKey, taskId, deadline, trace });
}

async function handleImage(req, res) {
  const trace = [];

  try {
    const input = await readRequestJson(req);
    const apiKey = String(input.apiKey || process.env.TAVERN_IMAGE_API_KEY || "").trim();
    const model = String(input.model || process.env.TAVERN_IMAGE_MODEL || "").trim();
    const prompt = String(input.prompt || "").trim();
    const waitMs = Math.max(1000, Number(input.waitMs) || defaultImageWaitMs);
    const upstreamApiUrl = String(input.apiUrl || process.env.TAVERN_IMAGE_API_URL || "").trim();
    if (!upstreamApiUrl) throw new Error("缺少生图 API 地址");
    if (!model) throw new Error("缺少生图模型名");
    if (!apiKey) throw new Error("缺少生图 API Key");
    if (!prompt) throw new Error("缺少绘图提示词");
    const endpoint = buildImageEndpoint(upstreamApiUrl);

    const requestPayload = buildImageRequestPayload({
      endpoint,
      model,
      prompt,
      size: input.size || input.image_size || "1024x1024",
    });
    const requestLog = {
      endpoint,
      payload: {
        ...requestPayload,
        apiKey: maskApiKey(apiKey),
        promptPreview: previewText(prompt),
        promptLength: prompt.length,
        waitMs,
      },
    };

    pushTrace(trace, "request", requestLog);
    logImageDebug("request", requestLog);

    if (!apiKey) throw new Error("缺少生图 API Key");
    if (!prompt) throw new Error("缺少生图提示词");

    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestPayload),
      });
    } catch (error) {
      throw new Error(`请求上游生图接口失败：${endpoint}。${error.message}`);
    }

    const text = await upstream.text();
    const parsed = safeJsonParse(text);
    const responseLog = {
      endpoint,
      status: upstream.status,
      ok: upstream.ok,
      contentType: upstream.headers.get("content-type") || "application/json; charset=utf-8",
      jsonShape: summarizeJsonShape(parsed),
      json: parsed,
      textPreview: parsed ? "" : previewText(text, 800),
    };
    pushTrace(trace, "response", responseLog);
    logImageDebug("response", {
      endpoint,
      status: upstream.status,
      ok: upstream.ok,
      jsonShape: responseLog.jsonShape,
    });

    if (!upstream.ok) {
      const errorInfo = buildErrorInfo(parsed || {}, upstream.status);
      const debugRecord = {
        timestamp: new Date().toISOString(),
        stage: "response-error",
        request: requestLog,
        trace,
        final: {
          status: upstream.status,
          error: errorInfo,
        },
      };
      rememberImageDebug(debugRecord);
      sendJson(res, upstream.status, {
        message: errorInfo.message,
        code: errorInfo.code,
        status: errorInfo.status,
        error: {
          message: errorInfo.message,
          code: errorInfo.code,
          status: errorInfo.status,
        },
        raw: parsed || text || "",
      });
      return;
    }

    if (!parsed) {
      const debugRecord = {
        timestamp: new Date().toISOString(),
        stage: "non-json-response",
        request: requestLog,
        trace,
        final: {
          status: upstream.status,
          contentType: responseLog.contentType,
        },
      };
      rememberImageDebug(debugRecord);
      send(res, 200, text, { "Content-Type": responseLog.contentType });
      return;
    }

    const directImageUrl = resolveImageUrl(parsed);
    if (directImageUrl) {
      const savedImage = await saveGeneratedImage(directImageUrl);
      const debugRecord = {
        timestamp: new Date().toISOString(),
        stage: "resolved-direct",
        request: requestLog,
        trace,
        final: {
          status: 200,
          resolvedImage: directImageUrl.startsWith("data:image/")
            ? `base64 length=${directImageUrl.length}`
            : previewText(directImageUrl, 200),
        },
      };
      rememberImageDebug(debugRecord);
      sendJson(res, 200, {
        ...(parsed || {}),
        originalImageUrl: directImageUrl,
        imageUrl: savedImage?.imageUrl || directImageUrl,
        localUrl: savedImage?.localUrl || "",
        localPath: savedImage?.localPath || "",
      });
      return;
    }

    const task = findImageTask(parsed);
    if (!task) {
      const debugRecord = {
        timestamp: new Date().toISOString(),
        stage: "response-without-image-or-task",
        request: requestLog,
        trace,
        final: {
          status: 200,
          jsonShape: summarizeJsonShape(parsed),
        },
      };
      rememberImageDebug(debugRecord);
      sendJson(res, 200, parsed);
      return;
    }

    pushTrace(trace, "task-created", {
      taskId: task.taskId,
      taskStatus: task.status || "pending",
    });
    logImageDebug("task-created", {
      taskId: task.taskId,
      taskStatus: task.status || "pending",
    });

    const taskResult = await waitForImageTaskResult({
      apiUrl: upstreamApiUrl,
      apiKey,
      taskId: task.taskId,
      waitMs,
      trace,
    });

    if (taskResult.state === "completed") {
      const resolvedImage = resolveImageUrl(taskResult.payload);
      const savedImage = await saveGeneratedImage(resolvedImage, task.taskId);
      const debugRecord = {
        timestamp: new Date().toISOString(),
        stage: "resolved-from-task",
        request: requestLog,
        trace,
        final: {
          status: 200,
          taskId: task.taskId,
          taskStatus: taskResult.status || "completed",
          resolvedImage: resolvedImage.startsWith("data:image/")
            ? `base64 length=${resolvedImage.length}`
            : previewText(resolvedImage, 200),
        },
      };
      rememberImageDebug(debugRecord);
      sendJson(res, 200, {
        ...(taskResult.payload || {}),
        originalImageUrl: resolvedImage,
        imageUrl: savedImage?.imageUrl || resolvedImage,
        localUrl: savedImage?.localUrl || "",
        localPath: savedImage?.localPath || "",
        task_id: task.taskId,
        status: taskResult.status || "completed",
      });
      return;
    }

    if (taskResult.state === "failed") {
      const errorInfo = buildErrorInfo(taskResult.payload || {}, 400);
      const debugRecord = {
        timestamp: new Date().toISOString(),
        stage: "task-failed",
        request: requestLog,
        trace,
        final: {
          status: 400,
          taskId: task.taskId,
          taskStatus: taskResult.status || "failed",
          error: errorInfo,
        },
      };
      rememberImageDebug(debugRecord);
      sendJson(res, 400, {
        error: {
          message: errorInfo.message || `生图任务失败：${taskResult.status || "failed"}`,
          code: errorInfo.code || taskResult.status || "failed",
          status: errorInfo.status || taskResult.status || "failed",
        },
        task_id: task.taskId,
        raw: taskResult.payload || parsed,
      });
      return;
    }

    const pendingPayload = buildPendingTaskPayload(
      task.taskId,
      taskResult.status || task.status || "pending",
      taskResult.payload || parsed,
      waitMs,
    );
    const debugRecord = {
      timestamp: new Date().toISOString(),
      stage: "task-pending-timeout",
      request: requestLog,
      trace,
      final: {
        status: 202,
        taskId: task.taskId,
        taskStatus: pendingPayload.status,
      },
    };
    rememberImageDebug(debugRecord);
    sendJson(res, 202, pendingPayload);
  } catch (error) {
    const debugRecord = {
      timestamp: new Date().toISOString(),
      stage: "error",
      trace,
      final: {
        status: 400,
        error: {
          message: error.message,
        },
      },
    };
    rememberImageDebug(debugRecord);
    logImageDebug("error", { message: error.message });
    sendJson(res, 400, { error: error.message });
  }
}

async function handleImageTask(req, res) {
  const trace = [];

  try {
    const input = await readRequestJson(req);
    const apiKey = String(input.apiKey || process.env.TAVERN_IMAGE_API_KEY || "").trim();
    const taskId = String(input.taskId || input.task_id || "").trim();
    const apiUrl = String(input.apiUrl || process.env.TAVERN_IMAGE_API_URL || "").trim();
    const waitMs = Math.max(1000, Number(input.waitMs) || defaultTaskWaitMs);

    if (!apiKey) throw new Error("缺少生图 API Key");
    if (!taskId) throw new Error("缺少生图任务 task_id");

    pushTrace(trace, "task-check-request", {
      apiUrl,
      taskId,
      waitMs,
      apiKey: maskApiKey(apiKey),
    });
    logImageDebug("task-check-request", {
      apiUrl,
      taskId,
      waitMs,
    });

    const taskResult = await waitForImageTaskResult({
      apiUrl,
      apiKey,
      taskId,
      waitMs,
      trace,
    });

    if (taskResult.state === "completed") {
      const resolvedImage = resolveImageUrl(taskResult.payload);
      const savedImage = await saveGeneratedImage(resolvedImage, taskId);
      rememberImageDebug({
        timestamp: new Date().toISOString(),
        stage: "task-check-completed",
        trace,
        final: {
          status: 200,
          taskId,
          taskStatus: taskResult.status || "completed",
          resolvedImage: resolvedImage.startsWith("data:image/")
            ? `base64 length=${resolvedImage.length}`
            : previewText(resolvedImage, 200),
        },
      });
      sendJson(res, 200, {
        ...(taskResult.payload || {}),
        originalImageUrl: resolvedImage,
        imageUrl: savedImage?.imageUrl || resolvedImage,
        localUrl: savedImage?.localUrl || "",
        localPath: savedImage?.localPath || "",
        task_id: taskId,
        status: taskResult.status || "completed",
      });
      return;
    }

    if (taskResult.state === "failed") {
      const errorInfo = buildErrorInfo(taskResult.payload || {}, 400);
      rememberImageDebug({
        timestamp: new Date().toISOString(),
        stage: "task-check-failed",
        trace,
        final: {
          status: 400,
          taskId,
          taskStatus: taskResult.status || "failed",
          error: errorInfo,
        },
      });
      sendJson(res, 400, {
        error: {
          message: errorInfo.message || `生图任务失败：${taskResult.status || "failed"}`,
          code: errorInfo.code || taskResult.status || "failed",
          status: errorInfo.status || taskResult.status || "failed",
        },
        task_id: taskId,
        raw: taskResult.payload || {},
      });
      return;
    }

    rememberImageDebug({
      timestamp: new Date().toISOString(),
      stage: "task-check-pending",
      trace,
      final: {
        status: 202,
        taskId,
        taskStatus: taskResult.status || "pending",
      },
    });
    sendJson(res, 202, buildPendingTaskPayload(taskId, taskResult.status || "pending", taskResult.payload || {}, waitMs));
  } catch (error) {
    rememberImageDebug({
      timestamp: new Date().toISOString(),
      stage: "task-check-error",
      trace,
      final: {
        status: 400,
        error: {
          message: error.message,
        },
      },
    });
    logImageDebug("task-check-error", { message: error.message });
    sendJson(res, 400, { error: error.message });
  }
}

async function handleOpenImageFolder(req, res) {
  try {
    const input = await readRequestJson(req);
    const rawPath = String(input.localPath || "").trim();
    await fs.promises.mkdir(generatedImagesDir, { recursive: true });
    const filePath = rawPath ? path.resolve(rawPath) : generatedImagesDir;
    if (!isPathInside(filePath, generatedImagesDir)) {
      sendJson(res, 400, { error: "Invalid local image path" });
      return;
    }
    const targetPath = fs.existsSync(filePath) ? filePath : generatedImagesDir;
    const targetIsDirectory = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    if (process.platform === "win32") {
      execFile("explorer.exe", targetIsDirectory ? [targetPath] : ["/select,", targetPath], { windowsHide: false });
    } else {
      execFile(process.platform === "darwin" ? "open" : "xdg-open", [targetIsDirectory ? targetPath : path.dirname(targetPath)]);
    }
    sendJson(res, 200, { ok: true, path: targetPath });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleSaveLocalImage(req, res) {
  try {
    const input = await readRequestJson(req);
    const imageUrl = String(input.imageUrl || input.url || "").trim();
    const taskId = String(input.taskId || input.task_id || "image").trim();
    if (!imageUrl) {
      sendJson(res, 400, { error: "Missing image URL" });
      return;
    }
    const savedImage = await saveGeneratedImage(imageUrl, taskId);
    if (!savedImage) {
      sendJson(res, 400, { error: "Unable to save image locally" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      originalImageUrl: imageUrl,
      imageUrl: savedImage.imageUrl,
      localUrl: savedImage.localUrl,
      localPath: savedImage.localPath,
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname);
  if (urlPath.startsWith("/generated-images/")) {
    const imageName = path.basename(urlPath);
    const imagePath = path.join(generatedImagesDir, imageName);
    if (!isPathInside(imagePath, generatedImagesDir)) {
      send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    fs.readFile(imagePath, (error, data) => {
      if (error) {
        send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      send(res, 200, data, { "Content-Type": mimeTypes[path.extname(imagePath)] || "application/octet-stream" });
    });
    return;
  }

  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    send(res, 200, data, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  });
}

function createImageProxyServer(options = {}) {
  configureProxy(options);
  return http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (req.url.startsWith("/api/health")) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url.startsWith("/api/image/debug/last")) {
    sendJson(res, 200, lastImageDebug || { ok: false, message: "暂无生图请求记录" });
    return;
  }

  if (req.url.startsWith("/api/image/open-folder")) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Only POST is allowed" });
      return;
    }
    void handleOpenImageFolder(req, res);
    return;
  }

  if (req.url.startsWith("/api/image/save-local")) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Only POST is allowed" });
      return;
    }
    void handleSaveLocalImage(req, res);
    return;
  }

  if (req.url.startsWith("/api/image/task")) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Only POST is allowed" });
      return;
    }
    void handleImageTask(req, res);
    return;
  }

  if (req.url.startsWith("/api/image")) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Only POST is allowed" });
      return;
    }
    void handleImage(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
  });
}

function startImageProxy(options = {}) {
  const server = createImageProxyServer(options);
  const listenHost = host;
  const listenPort = port;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.off("error", reject);
      console.log(`AI Tavern proxy: http://${listenHost}:${listenPort}`);
      resolve({
        server,
        host: listenHost,
        port: listenPort,
        rootDir: root,
        imageDir: generatedImagesDir,
        baseUrl: `http://${listenHost}:${listenPort}`,
        imageApiUrl: `http://${listenHost}:${listenPort}/api/image`,
      });
    });
  });
}

if (require.main === module) {
  startImageProxy().catch((error) => {
    console.error("[image-proxy] failed to start", error);
    process.exit(1);
  });
}

module.exports = {
  createImageProxyServer,
  startImageProxy,
};
