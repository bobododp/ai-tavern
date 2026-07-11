function activeStory() {
  return stories.find((story) => story.id === activeStoryId) || stories[0];
}

const imageAutoCheckTimers = new Map();
const imageAutoCheckDelayMs = 30000;

function setActiveStory(id) {
  activeStoryId = id;
  const story = activeStory();
  if (!story) return;
  story.updatedAt = new Date().toISOString();
  saveStories();
  renderAll();
  switchView("home");
}

function switchView(viewName) {
  Object.entries(views).forEach(([name, element]) => {
    element?.classList.toggle("active", name === viewName);
  });

  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });

  const activeView = views[viewName];
  if (activeView) activeView.scrollTop = 0;
}

function sortedStoriesByRecent() {
  return [...stories].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function deleteStory(id) {
  if (stories.length <= 1) {
    window.alert("至少保留一个故事档案。");
    return;
  }

  const story = stories.find((item) => item.id === id);
  if (!story) return;

  if (!window.confirm(`确定删除《${story.title}》吗？这个操作不能自动恢复。`)) return;

  stories = stories.filter((item) => item.id !== id);
  if (activeStoryId === id) {
    activeStoryId = sortedStoriesByRecent()[0]?.id || stories[0]?.id || "";
  }

  saveStories();
  renderAll();
}

function addMessage(name, text, type, choices = []) {
  const story = activeStory();
  if (!story) return;

  story.messages.push({
    id: createId(),
    name,
    text,
    type,
    choices: Array.isArray(choices) ? choices : [],
  });
  story.updatedAt = new Date().toISOString();
  saveStories();
  renderAll();
}

async function generateAssistantReply() {
  isGenerating = true;
  if (sendButton) sendButton.disabled = true;

  if (generationStatus) {
    generationStatus.hidden = false;
    const statusText = generationStatus.querySelector("span");
    if (statusText) {
      statusText.textContent = hasRealApiSettings()
        ? "正在调用聊天模型..."
        : "未检测到可用 API Key，先使用本地兜底回复。";
    }
  }

  if (!hasRealApiSettings()) {
    generationTimer = window.setTimeout(() => {
      stopGeneration("");
      const reply = normalizeAssistantReply(buildMockReply());
      applyStoryStateUpdate(activeStory(), reply.stateUpdate, reply.text);
      addMessage("旁白", reply.text, "npc", reply.choices);
      updateUsage(0.05, 0.8);
    }, 900);
    return;
  }

  try {
    const story = activeStory();
    const reply = normalizeAssistantReply(await callChatApi(story));
    const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;

    if (currentSettings.nextStep && !reply.choices.length && hasRealApiSettings()) {
      if (generationStatus) {
        generationStatus.hidden = false;
        const statusText = generationStatus.querySelector("span");
        if (statusText) statusText.textContent = "正文已返回，正在补全下一步...";
      }

      try {
        reply.choices = await generateChoicesViaApi(story, reply.text);
      } catch (choiceError) {
        console.warn("补全下一步失败：", choiceError);
      }
    }

    stopGeneration("");
    applyStoryStateUpdate(story, reply.stateUpdate, reply.text);
    addMessage("旁白", reply.text, "npc", reply.choices);
  } catch (error) {
    stopGeneration("API 调用失败，请检查接口地址、模型名和 Key。");
    addMessage("系统", `聊天 API 调用失败：${error.message}`, "npc");
  }
}

function stopGeneration(message) {
  window.clearTimeout(generationTimer);
  generationTimer = null;
  isGenerating = false;

  if (sendButton) sendButton.disabled = false;
  if (generationStatus) {
    generationStatus.hidden = !message;
    const statusText = generationStatus.querySelector("span");
    if (statusText) statusText.textContent = message;
  }
}

function hasRealImageSettings() {
  return getImageSettingsIssues().length === 0;
}

function buildImageProxyEndpoint(proxyUrl) {
  return String(proxyUrl || getDefaultImageProxyUrl()).trim();
}

function buildImageEndpoint(apiUrl) {
  const url = String(apiUrl || "").trim().replace(/\/$/, "");
  if (!url) return "";
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
    // Keep generic OpenAI-compatible behavior.
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

function buildImageRequestPayload(endpoint, model, prompt, size = "1024x1024") {
  if (isSiliconFlowEndpoint(endpoint)) {
    return { model, prompt, image_size: size };
  }
  return { model, prompt, size };
}

function buildImageProxyTaskEndpoint(proxyUrl) {
  return buildImageProxyEndpoint(proxyUrl).replace(/\/api\/image(?:\/.*)?$/, "/api/image/task");
}

function buildImageProxyHealthEndpoint(proxyUrl) {
  try {
    const endpoint = new URL(buildImageProxyEndpoint(proxyUrl));
    endpoint.pathname = "/api/health";
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint.toString();
  } catch {
    return "";
  }
}

function buildImageProxyDebugEndpoint(proxyUrl) {
  try {
    const endpoint = new URL(buildImageProxyEndpoint(proxyUrl));
    endpoint.pathname = "/api/image/debug/last";
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint.toString();
  } catch {
    return `${getDefaultImageProxyUrl().replace(/\/api\/image(?:\/.*)?$/, "")}/api/image/debug/last`;
  }
}

function getImageSettingsIssues(currentSettings = null) {
  const liveSettings = currentSettings || (typeof readSettingsForm === "function" ? readSettingsForm() : settings);
  const issues = [];
  const apiUrl = String(liveSettings?.imageApiUrl || "").trim();
  const model = String(liveSettings?.imageModelName || "").trim();
  const apiKey = String(liveSettings?.imageApiKey || "").trim();
  const proxyUrl = String(liveSettings?.imageProxyUrl || "").trim();

  if (!apiUrl) {
    issues.push("生图 API 地址为空");
  } else if (/example\.com/i.test(apiUrl)) {
    issues.push("生图 API 地址还是示例地址，请换成供应商给你的真实地址");
  }
  if (!model) issues.push("生图模型为空");
  if (!apiKey) issues.push("生图 API Key 为空");
  if (liveSettings?.useImageProxy !== false && !proxyUrl) issues.push("本地代理地址为空");
  return issues;
}

function normalizeImagePurpose(value) {
  return String(value || "").trim() || "关键节点画面";
}

function maskApiKeyForLog(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function previewTextForLog(value, limit = 160) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function summarizeImagePayloadShape(value, depth = 0) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (!value.length) return ["empty"];
    if (depth >= 2) return ["array"];
    return [summarizeImagePayloadShape(value[0], depth + 1)];
  }
  if (typeof value === "object") {
    if (depth >= 2) return Object.keys(value);
    return Object.fromEntries(
      Object.keys(value).slice(0, 12).map((key) => [key, summarizeImagePayloadShape(value[key], depth + 1)]),
    );
  }
  return typeof value;
}

function normalizeImageValue(value, mimeType = "image/png") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(data:image|https?:\/\/|blob:)/i.test(text)) return text;
  return `data:${mimeType};base64,${text}`;
}

function resolveImageNodeValue(node, source) {
  if (!node) return null;
  if (typeof node === "string") {
    const url = normalizeImageValue(node);
    return url ? { url, source } : null;
  }
  if (typeof node !== "object") return null;

  if (node.url) return { url: String(node.url).trim(), source: `${source}.url` };
  if (node.imageUrl) return { url: String(node.imageUrl).trim(), source: `${source}.imageUrl` };
  if (node.image_url) return { url: String(node.image_url).trim(), source: `${source}.image_url` };
  if (node.result_url) return { url: String(node.result_url).trim(), source: `${source}.result_url` };
  if (Array.isArray(node.result_urls) && node.result_urls[0]) {
    return { url: normalizeImageValue(node.result_urls[0]), source: `${source}.result_urls[0]` };
  }
  if (Array.isArray(node.urls) && node.urls[0]) {
    return { url: normalizeImageValue(node.urls[0]), source: `${source}.urls[0]` };
  }
  if (node.b64_json) return { url: normalizeImageValue(node.b64_json), source: `${source}.b64_json` };
  if (node.base64) return { url: normalizeImageValue(node.base64), source: `${source}.base64` };
  if (node.image) return { url: normalizeImageValue(node.image), source: `${source}.image` };
  return null;
}

function parseImagePromptDraft(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const json = typeof parseAssistantJsonPayload === "function" ? parseAssistantJsonPayload(raw) : null;
  if (json && typeof json === "object") return json;
  try {
    return JSON.parse(raw);
  } catch {
    return { visual_prompt: raw };
  }
}

function currentImageStylePreset(story, options = {}) {
  return normalizeImageStylePreset(
    options.stylePreset ||
      story?.visualGuide?.stylePreset ||
      settings?.imageStylePreset ||
      "cinematic",
  );
}

function currentImageStyleNote(story, options = {}) {
  return String(options.styleNote || story?.visualGuide?.styleNote || "").trim();
}

function rebuildPendingImagePrompt(forceOverwrite = true) {
  if (!pendingImagePromptReview) return;
  const story = stories.find((item) => item.id === pendingImagePromptReview.storyId);
  if (!story) return;

  pendingImagePromptReview.stylePreset = normalizeImageStylePreset(imagePromptStylePreset?.value || pendingImagePromptReview.stylePreset);
  pendingImagePromptReview.styleNote = String(imagePromptStyleNote?.value || "").trim();
  const basePrompt = pendingImagePromptReview.basePrompt || pendingImagePromptReview.preparedPrompt || pendingImagePromptReview.rawPrompt || "";
  const composedPrompt = composeFinalImagePrompt(basePrompt, story, {
    stylePreset: pendingImagePromptReview.stylePreset,
    styleNote: pendingImagePromptReview.styleNote,
    characterAnchors: pendingImagePromptReview.characterAnchors,
  });
  pendingImagePromptReview.preparedPrompt = composedPrompt;
  pendingImagePromptReview.lastAutoPrompt = composedPrompt;

  if (imagePromptAnchors) {
    imagePromptAnchors.value = formatCharacterAnchorText(pendingImagePromptReview.characterAnchors || []);
  }
  if (imagePromptText && (forceOverwrite || !String(imagePromptText.value || "").trim() || imagePromptText.value === pendingImagePromptReview.lastManualPrompt)) {
    imagePromptText.value = composedPrompt;
  }
  if (imagePromptStatus) imagePromptStatus.textContent = "已按当前场景、画风和外观锚点重写绘画提示词。";
}

function buildCoverSuggestionPrompt(story) {
  const activeEvent = (story?.events || []).find((event) => event.status === "active");
  return buildStoryImagePrompt(
    story,
    `${story?.title || "当前故事"}的开场封面，突出${activeEvent?.title || story?.chapter || "当前事件"}与主要氛围。`,
    "章节封面",
  );
}
function createStoryImageRecord(story, prompt, purpose, status = "suggested") {
  const record = {
    id: createId(),
    prompt: String(prompt || "").trim(),
    rawPrompt: String(prompt || "").trim(),
    purpose: normalizeImagePurpose(purpose),
    status,
    url: "",
    originalImageUrl: "",
    localUrl: "",
    localPath: "",
    stylePreset: currentImageStylePreset(story),
    styleNote: currentImageStyleNote(story),
    error: "",
    createdAt: new Date().toISOString(),
  };
  story.images = Array.isArray(story.images) ? story.images : [];
  story.images.unshift(record);
  return record;
}

function addSuggestedCoverImage(story) {
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  if (!story || !currentSettings.askImageCover) return;
  story.images = Array.isArray(story.images) ? story.images : [];
  const existingCover = story.images.find((image) => image.purpose === "章节封面");
  if (existingCover) return;
  createStoryImageRecord(story, buildCoverSuggestionPrompt(story), "章节封面", "suggested");
}

function resolveImageResult(payload) {
  const candidates = [
    ["payload", payload],
    ["payload.result", payload?.result],
    ["payload.result_urls[0]", payload?.result_urls?.[0]],
    ["payload.result.result_urls[0]", payload?.result?.result_urls?.[0]],
    ["payload.data[0]", payload?.data?.[0]],
    ["payload.images[0]", payload?.images?.[0]],
    ["payload.output[0]", payload?.output?.[0]],
    ["payload.result.data[0]", payload?.result?.data?.[0]],
    ["payload.result.images[0]", payload?.result?.images?.[0]],
    ["payload.result.output[0]", payload?.result?.output?.[0]],
  ];

  for (const [source, value] of candidates) {
    const resolved = resolveImageNodeValue(value, source);
    if (resolved?.url) return resolved;
  }
  return null;
}

function resolveImageTaskInfo(payload) {
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
    if (!taskId) continue;
    return {
      taskId: String(taskId),
      status: String(item.status || item.state || payload?.status || "pending"),
    };
  }
  return null;
}

function extractImageErrorInfo(payload, status = 0) {
  const errorNode = payload && typeof payload.error === "object" ? payload.error : null;
  const message =
    errorNode?.message ||
    (typeof payload?.error === "string" ? payload.error : "") ||
    payload?.message ||
    payload?.detail ||
    payload?.msg ||
    "";
  const code = errorNode?.code || payload?.code || payload?.status_code || payload?.status || "";
  const finalStatus = status || errorNode?.status || payload?.status || payload?.statusCode || "";
  const hasError = Boolean(message || code || payload?.success === false);
  return {
    hasError,
    message: String(message || "").trim(),
    code: String(code || "").trim(),
    status: String(finalStatus || "").trim(),
  };
}

function formatImageErrorMessage(prefix, payload, status = 0) {
  const info = extractImageErrorInfo(payload, status);
  const parts = [];
  if (prefix) parts.push(prefix);
  if (info.message) parts.push(info.message);
  if (info.code) parts.push(`code=${info.code}`);
  if (info.status) parts.push(`status=${info.status}`);
  if (!info.message && !info.code && status) parts.push(`HTTP ${status}`);
  return parts.join(" | ");
}

function logImageFlow(stage, detail) {
  console.log(`[image] ${stage}`, detail);
}

async function callImageApi(prompt, purpose) {
  const liveSettings = typeof resolveLiveSettings === "function" ? resolveLiveSettings() : settings;
  if (liveSettings.useImageProxy !== false) {
    return callImageProxyApi(prompt, purpose, liveSettings);
  }

  const endpoint = buildImageEndpoint(liveSettings.imageApiUrl);
  const requestLog = {
    endpoint,
    payload: {
      model: liveSettings.imageModelName,
      size: "1024x1024",
      purpose: normalizeImagePurpose(purpose),
      apiKey: maskApiKeyForLog(liveSettings.imageApiKey),
      promptPreview: previewTextForLog(prompt),
      promptLength: String(prompt || "").length,
    },
  };
  logImageFlow("request", requestLog);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${liveSettings.imageApiKey}`,
      },
      body: JSON.stringify(buildImageRequestPayload(endpoint, liveSettings.imageModelName, prompt, "1024x1024")),
    });
  } catch (error) {
    throw new Error(
      `浏览器未能请求生图接口，通常是服务端 CORS 未放行当前页面。实际请求地址：${endpoint}。原始错误：${error.message}`,
    );
  }
  const payload = await response.json().catch(() => ({}));
  logImageFlow("response", {
    endpoint,
    status: response.status,
    shape: summarizeImagePayloadShape(payload),
    payload,
  });
  if (!response.ok) throw new Error(formatImageErrorMessage(`接口返回错误，请求地址：${endpoint}`, payload, response.status));
  const embeddedError = extractImageErrorInfo(payload, response.status);
  if (embeddedError.hasError) throw new Error(formatImageErrorMessage(`接口返回了错误 JSON，请求地址：${endpoint}`, payload, response.status));
  const resolved = resolveImageResult(payload);
  if (!resolved?.url) {
    throw new Error(
      `接口已返回结果，但没有找到可用图片字段。请求地址：${endpoint}。返回结构：${JSON.stringify(summarizeImagePayloadShape(payload))}。请查看控制台中的完整 JSON。`,
    );
  }
  logImageFlow("resolved", {
    endpoint,
    source: resolved.source,
    isBase64: resolved.url.startsWith("data:image/"),
    valuePreview: resolved.url.startsWith("data:image/")
      ? `base64 length=${resolved.url.length}`
      : previewTextForLog(resolved.url, 200),
  });
  return {
    url: resolved.url,
    localPath: payload.localPath || "",
    localUrl: payload.localUrl || "",
    originalImageUrl: payload.originalImageUrl || "",
  };
}

async function callImageProxyApi(prompt, purpose, liveSettings) {
  const proxyEndpoint = buildImageProxyEndpoint(liveSettings.imageProxyUrl);
  const requestLog = {
    endpoint: proxyEndpoint,
    payload: {
      apiUrl: liveSettings.imageApiUrl,
      model: liveSettings.imageModelName,
      size: "1024x1024",
        purpose: normalizeImagePurpose(purpose),
        apiKey: maskApiKeyForLog(liveSettings.imageApiKey),
        promptPreview: previewTextForLog(prompt),
        promptLength: String(prompt || "").length,
        waitMs: 90000,
      },
    };
  logImageFlow("proxy-request", requestLog);
  let response;
  try {
    response = await fetch(proxyEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiUrl: liveSettings.imageApiUrl,
        apiKey: liveSettings.imageApiKey,
          model: liveSettings.imageModelName,
          prompt,
          purpose: normalizeImagePurpose(purpose),
          size: "1024x1024",
          waitMs: 90000,
        }),
      });
  } catch (error) {
    throw new Error(`本地生图代理未启动或不可访问。请双击“启动酒馆.bat”重新打开，或运行 node image-proxy.js 后重试。代理地址：${proxyEndpoint}。原始错误：${error.message}`);
  }

  const payload = await response.json().catch(() => ({}));
  logImageFlow("proxy-response", {
    endpoint: proxyEndpoint,
    status: response.status,
    shape: summarizeImagePayloadShape(payload),
    payload,
  });
  if (!response.ok) throw new Error(formatImageErrorMessage("代理返回错误", payload, response.status));
  const resolved = resolveImageResult(payload);
  const task = resolveImageTaskInfo(payload);
    if (task && !resolved?.url) {
      logImageFlow("proxy-task-created", {
        endpoint: proxyEndpoint,
        taskId: task.taskId,
        status: task.status,
      });
      return { task };
    }
  const embeddedError = extractImageErrorInfo(payload, response.status);
  if (embeddedError.hasError) throw new Error(formatImageErrorMessage("代理返回了错误 JSON", payload, response.status));
  if (!resolved?.url) {
    throw new Error(
      `代理已返回结果，但没有找到可用图片字段。返回结构：${JSON.stringify(summarizeImagePayloadShape(payload))}。请查看控制台完整 JSON，或访问 ${buildImageProxyDebugEndpoint(liveSettings.imageProxyUrl)} 查看代理记录。`,
    );
  }
  logImageFlow("proxy-resolved", {
    endpoint: proxyEndpoint,
    source: resolved.source,
    isBase64: resolved.url.startsWith("data:image/"),
    valuePreview: resolved.url.startsWith("data:image/")
      ? `base64 length=${resolved.url.length}`
      : previewTextForLog(resolved.url, 200),
  });
  return {
    url: resolved.url,
    localPath: payload.localPath || "",
    localUrl: payload.localUrl || "",
    originalImageUrl: payload.originalImageUrl || "",
  };
}

function scheduleImageAutoCheck(imageId) {
  if (!imageId) return;
  window.clearTimeout(imageAutoCheckTimers.get(imageId));
  const timer = window.setTimeout(() => {
    imageAutoCheckTimers.delete(imageId);
    void checkImageResult(imageId, { auto: true });
  }, imageAutoCheckDelayMs);
  imageAutoCheckTimers.set(imageId, timer);
}

async function checkImageTaskViaProxy(record, liveSettings) {
  const proxyEndpoint = buildImageProxyTaskEndpoint(liveSettings.imageProxyUrl);
  logImageFlow("proxy-task-check", {
    endpoint: proxyEndpoint,
    taskId: record.taskId,
    waitMs: 45000,
  });

  const response = await fetch(proxyEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiUrl: liveSettings.imageApiUrl,
      apiKey: liveSettings.imageApiKey,
      taskId: record.taskId,
      waitMs: 45000,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  logImageFlow("proxy-task-response", {
    endpoint: proxyEndpoint,
    status: response.status,
    shape: summarizeImagePayloadShape(payload),
    payload,
  });

  if (!response.ok) throw new Error(formatImageErrorMessage("代理返回错误", payload, response.status));

  const resolved = resolveImageResult(payload);
  if (resolved?.url) {
    return {
      url: resolved.url,
      localPath: payload.localPath || "",
      localUrl: payload.localUrl || "",
      originalImageUrl: payload.originalImageUrl || "",
    };
  }

  const nextTask = resolveImageTaskInfo(payload);
  if (nextTask) {
    return {
      task: {
        taskId: nextTask.taskId || record.taskId,
        status: nextTask.status || record.taskStatus || "pending",
      },
    };
  }

  const info = extractImageErrorInfo(payload, response.status);
  return {
    task: {
      taskId: record.taskId,
      status: info.message || `结果仍未返回，status=${response.status}`,
    },
  };
}

async function testImageSettingsConnection() {
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const issues = getImageSettingsIssues(currentSettings);
  if (issues.length) {
    return { ok: false, message: `生图配置未通过：${issues.join("；")}。` };
  }

  if (currentSettings.useImageProxy === false) {
    return {
      ok: true,
      message: "生图配置已完整，但当前关闭了本地代理；如果供应商没有开放浏览器跨域，生成时仍可能失败。",
    };
  }

  const healthEndpoint = buildImageProxyHealthEndpoint(currentSettings.imageProxyUrl);
  if (!healthEndpoint) {
    return { ok: false, message: `本地代理地址格式不正确，请保持为 ${getDefaultImageProxyUrl()}。` };
  }

  try {
    const response = await fetch(healthEndpoint);
    if (!response.ok) return { ok: false, message: `本地代理可访问，但健康检查返回 HTTP ${response.status}。` };
    return { ok: true, message: "本地代理已连接，生图配置已完整。现在可以去画廊生成一张真实图片测试。" };
  } catch {
    return {
      ok: false,
      message: `本地代理未连接。请双击“启动酒馆.bat”重新打开后再试。代理地址：${healthEndpoint}。`,
    };
  }
}
async function requestImagePromptReview(prompt = "", options = {}) {
  const story = activeStory();
  if (!story) return;

  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const fallbackPurpose = options.purpose || currentSettings.imageDefaultPurpose || "关键节点画面";
  const existingRecord = options.imageId ? (story.images || []).find((image) => image.id === options.imageId) : null;

  if (existingRecord?.status === "pending" && existingRecord.taskId) {
    await checkImageResult(existingRecord.id, { manual: true });
    return;
  }

  const finalPurpose = existingRecord?.purpose || normalizeImagePurpose(fallbackPurpose);
  const sourcePrompt =
    existingRecord?.rawPrompt ||
    existingRecord?.sourcePrompt ||
    existingRecord?.prompt ||
    buildStoryImagePrompt(story, prompt, finalPurpose);
  const characterAnchors = collectStoryCharacterAnchors(story);
  const stylePreset = currentImageStylePreset(story, existingRecord || options);
  const styleNote = currentImageStyleNote(story, existingRecord || options);

  pendingImagePromptReview = {
    storyId: story.id,
    imageId: existingRecord?.id || "",
    rawPrompt: sourcePrompt,
    purpose: finalPurpose,
    stylePreset,
    styleNote,
    characterAnchors,
    sourceOptions: { ...options },
  };

  if (imagePromptText) imagePromptText.value = "正在整理当前场景的绘画提示词...";
  if (imagePromptStatus) imagePromptStatus.textContent = "AI 正在总结当前剧情、人物外观、服装、环境和氛围。";
  if (imagePromptReview) imagePromptReview.checked = true;
  if (imagePromptStylePreset) imagePromptStylePreset.value = stylePreset;
  if (imagePromptStyleNote) imagePromptStyleNote.value = styleNote;
  if (imagePromptAnchors) imagePromptAnchors.value = formatCharacterAnchorText(characterAnchors);
  showDialog(imagePromptDialog);

  const prepared = await prepareImagePromptForGeneration(story, sourcePrompt, finalPurpose);
  if (!pendingImagePromptReview || pendingImagePromptReview.storyId !== story.id) return;
  pendingImagePromptReview.basePrompt = prepared.prompt;
  pendingImagePromptReview.preparedPrompt = composeFinalImagePrompt(prepared.prompt, story, {
    stylePreset,
    styleNote,
    characterAnchors,
  });
  pendingImagePromptReview.promptSource = prepared.source;
  pendingImagePromptReview.promptPrepareError = prepared.prepareError || "";
  pendingImagePromptReview.lastAutoPrompt = pendingImagePromptReview.preparedPrompt;
  if (imagePromptText) imagePromptText.value = pendingImagePromptReview.preparedPrompt;
  if (imagePromptStatus) {
    imagePromptStatus.textContent = prepared.source === "chat"
      ? "已整理为绘画提示词。确认后才会提交给生图接口。"
      : "聊天模型不可用，已使用本地兜底提示词。确认后才会提交给生图接口。";
  }
}

async function confirmPendingImagePrompt() {
  if (!pendingImagePromptReview) return;
  const review = pendingImagePromptReview;
  const promptText = String(imagePromptText?.value || review.preparedPrompt || review.rawPrompt || "").trim();
  if (!promptText) {
    if (imagePromptStatus) imagePromptStatus.textContent = "提示词为空，无法生成。";
    return;
  }

  let finalPrompt = promptText;
  if (imagePromptReview?.checked) {
    if (imagePromptStatus) imagePromptStatus.textContent = "正在审查并优化提示词...";
    const result = await reviewImagePromptForImageApi(promptText);
    finalPrompt = result.prompt;
    if (imagePromptText) imagePromptText.value = finalPrompt;
    if (imagePromptStatus) imagePromptStatus.textContent = result.notes || "审查完成，正在提交生成。";
  }

  const story = stories.find((item) => item.id === review.storyId);
  const selectedStylePreset = normalizeImageStylePreset(imagePromptStylePreset?.value || review.stylePreset);
  const selectedStyleNote = String(imagePromptStyleNote?.value || review.styleNote || "").trim();
  if (story) {
    story.visualGuide = normalizeStoryVisualGuide({
      ...(story.visualGuide || {}),
      stylePreset: selectedStylePreset,
      styleNote: selectedStyleNote,
      characterAnchors: review.characterAnchors || story.visualGuide?.characterAnchors || [],
    }, selectedStylePreset);
    story.updatedAt = new Date().toISOString();
  }
  settings = repairSettingsData({ ...(settings || {}), imageStylePreset: selectedStylePreset });
  saveSettings();

  closeDialog(imagePromptDialog);
  pendingImagePromptReview = null;
  await queueImage(finalPrompt, {
    ...review.sourceOptions,
    imageId: review.imageId,
    purpose: review.purpose,
    rawPrompt: review.rawPrompt,
    confirmed: true,
    preparedPrompt: finalPrompt,
    promptSource: review.promptSource || "review",
    stylePreset: selectedStylePreset,
    styleNote: selectedStyleNote,
    openGallery: false,
  });
}

function addImageMessageToContext(story, record) {
  if (!story || !record?.url) return;
  story.messages.push({
    id: createId(),
    name: "系统",
    text: `${record.purpose || "画面"}已生成。`,
    type: "system",
    image: {
      id: record.id,
      url: record.url,
      prompt: record.prompt || "",
      purpose: record.purpose || "",
      localPath: record.localPath || "",
    },
    choices: [],
  });
}

function applyImageAsStoryCover(story, record) {
  if (!story || !record?.url) return;
  if (!String(record.purpose || "").includes("封面")) return;
  story.coverUrl = record.url;
  story.coverImageId = record.id;
  story.cover = "custom";
}

function findStoryImage(imageId) {
  const story = activeStory();
  const image = (story?.images || []).find((item) => item.id === imageId);
  return { story, image };
}

function openImagePreview(imageId) {
  const { story, image } = findStoryImage(imageId);
  if (!story || !image?.url) return;
  activePreviewImageId = image.id;
  if (imagePreviewTitle) imagePreviewTitle.textContent = `${story.title || "当前故事"} · ${image.purpose || "画面"}`;
  if (imagePreviewImg) imagePreviewImg.src = image.url;
  if (imagePreviewPrompt) imagePreviewPrompt.textContent = image.prompt || "";
  if (imagePreviewFolder) {
    imagePreviewFolder.disabled = !image.localPath && !image.url;
    imagePreviewFolder.textContent = imageFolderActionLabel(image);
  }
  showDialog(imagePreviewDialog);
}

function deleteImageRecord(imageId) {
  const story = activeStory();
  if (!story) return;
  const image = (story.images || []).find((item) => item.id === imageId);
  if (!image) return;
  if (!window.confirm("确认删除这张画面吗？本地文件会保留在文件夹中。")) return;
  story.images = (story.images || []).filter((item) => item.id !== imageId);
  story.messages = (story.messages || []).filter((message) => message?.image?.id !== imageId);
  story.updatedAt = new Date().toISOString();
  saveStories();
  renderAll();
  closeDialog(imagePreviewDialog);
}

async function saveImageToLocal(image) {
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const proxyEndpoint = buildImageProxyEndpoint(currentSettings.imageProxyUrl);
  const endpoint = proxyEndpoint.replace(/\/api\/image(?:\/.*)?$/, "/api/image/save-local");
  const sourceUrl = image?.originalImageUrl || image?.url || "";
  if (!sourceUrl) throw new Error("当前图片没有可保存的来源地址。");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageUrl: sourceUrl,
      taskId: image?.taskId || image?.id || "",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || payload?.message || "保存本地图片失败");
  }
  return {
    url: payload.imageUrl || image.url,
    localPath: payload.localPath || "",
    localUrl: payload.localUrl || "",
    originalImageUrl: payload.originalImageUrl || sourceUrl,
  };
}

async function openGeneratedImagesFolder() {
  const proxyEndpoint = buildImageProxyEndpoint((typeof readSettingsForm === "function" ? readSettingsForm() : settings).imageProxyUrl);
  const endpoint = proxyEndpoint.replace(/\/api\/image(?:\/.*)?$/, "/api/image/open-folder");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ localPath: "" }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    window.alert(payload.error || "打开生图文件夹失败，请确认本地代理已重启。");
  }
}

async function openImageFolder(imageId = "") {
  const { story, image } = findStoryImage(imageId || activePreviewImageId);
  if (!story || !image?.url) {
    await openGeneratedImagesFolder();
    return;
  }
  if (!image.localPath && image.url) {
    try {
      const repaired = await saveImageToLocal(image);
      image.url = repaired.url || image.url;
      image.localPath = repaired.localPath || image.localPath;
      image.localUrl = repaired.localUrl || image.localUrl;
      image.originalImageUrl = repaired.originalImageUrl || image.originalImageUrl || image.url;
      story.updatedAt = new Date().toISOString();
      saveStories();
      renderAll();
      if (activePreviewImageId === image.id) openImagePreview(image.id);
    } catch (error) {
      console.warn("[image-folder] save before open failed, opening generated folder instead", error);
      await openGeneratedImagesFolder();
      return;
    }
  }
  if (!image.localPath) {
    await openGeneratedImagesFolder();
    return;
  }
  const proxyEndpoint = buildImageProxyEndpoint((typeof readSettingsForm === "function" ? readSettingsForm() : settings).imageProxyUrl);
  const endpoint = proxyEndpoint.replace(/\/api\/image(?:\/.*)?$/, "/api/image/open-folder");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ localPath: image.localPath }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    window.alert(payload.error || "打开文件夹失败，请确认本地代理已重启。");
  }
}
async function queueImage(prompt = "", options = {}) {
  const story = activeStory();
  if (!story) return;

  if (!options.confirmed) {
    await requestImagePromptReview(prompt, options);
    return;
  }

  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const fallbackPurpose = options.purpose || currentSettings.imageDefaultPurpose || "关键节点画面";
  const existingRecord = options.imageId ? (story.images || []).find((image) => image.id === options.imageId) : null;
  const finalPurpose = existingRecord?.purpose || normalizeImagePurpose(fallbackPurpose);
  const sourcePrompt =
    options.rawPrompt ||
    existingRecord?.rawPrompt ||
    existingRecord?.sourcePrompt ||
    existingRecord?.prompt ||
    buildStoryImagePrompt(story, prompt, finalPurpose);
  const confirmedPrompt = String(options.preparedPrompt || prompt || sourcePrompt).trim();
  const record = existingRecord || createStoryImageRecord(story, sourcePrompt, finalPurpose, "pending");

  if (record.status === "pending" && record.taskId) {
    await checkImageResult(record.id, { manual: true });
    return;
  }

  record.rawPrompt = sourcePrompt;
  record.prompt = confirmedPrompt || sourcePrompt;
  record.purpose = finalPurpose;
  record.stylePreset = normalizeImageStylePreset(options.stylePreset || record.stylePreset || story.visualGuide?.stylePreset || currentSettings.imageStylePreset);
  record.styleNote = String(options.styleNote || record.styleNote || story.visualGuide?.styleNote || "").trim();
  record.status = "pending";
  record.error = "正在提交绘图任务...";
  record.url = "";
  record.taskId = "";
  record.taskStatus = "";
  record.taskCandidateIndex = 0;
  record.autoCheckCount = 0;
  record.createdAt = new Date().toISOString();
  story.updatedAt = new Date().toISOString();
  saveStories();
  renderAll();
  if (options.openGallery !== false) switchView("gallery");

  const issues = getImageSettingsIssues(currentSettings);
  if (issues.length) {
    record.status = "error";
    record.error = `生图配置未通过：${issues.join("；")}`;
    story.updatedAt = new Date().toISOString();
    saveStories();
    renderAll();
    addMessage("系统", `已保留 ${finalPurpose} 提示词，但当前没有可用生图接口。`, "npc");
    return;
  }

  try {
    const result = await callImageApi(record.prompt, record.purpose);
    if (result?.task) {
      record.taskId = result.task.taskId;
      record.taskStatus = result.task.status || "pending";
      record.taskCandidateIndex = 0;
      record.autoCheckCount = 0;
      record.status = "pending";
      record.error = "已提交给生图服务，正在等待返回图片。";
      story.updatedAt = new Date().toISOString();
      saveStories();
      renderAll();
      scheduleImageAutoCheck(record.id);
      addMessage("系统", `${record.purpose} 已提交，正在等待生图服务返回结果。`, "npc");
      return;
    }

    record.url = result?.url || "";
    record.localPath = result?.localPath || "";
    record.localUrl = result?.localUrl || "";
    record.originalImageUrl = result?.originalImageUrl || "";
    record.status = "done";
    record.error = "";
    record.taskId = "";
    record.taskStatus = "";
    record.taskCandidateIndex = 0;
    record.autoCheckCount = 0;
    applyImageAsStoryCover(story, record);
    addImageMessageToContext(story, record);
    story.updatedAt = new Date().toISOString();
    saveStories();
    renderAll();
    addMessage("系统", `${record.purpose} 已生成并写入画廊。`, "npc");
  } catch (error) {
    record.status = "error";
    record.error = error.message;
    record.url = "";
    story.updatedAt = new Date().toISOString();
    saveStories();
    renderAll();
    addMessage("系统", `画面生成失败：${error.message}`, "npc");
  }
}

async function checkImageResult(imageId, options = {}) {
  const story = activeStory();
  if (!story) return;
  const record = (story.images || []).find((image) => image.id === imageId);
  if (!record?.taskId) return;

  window.clearTimeout(imageAutoCheckTimers.get(imageId));
  imageAutoCheckTimers.delete(imageId);

  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  record.status = "pending";
  record.error = options.auto ? "正在自动检查绘图结果..." : "正在继续等待已有绘图任务返回结果...";
  story.updatedAt = new Date().toISOString();
  saveStories();
  renderAll();

  try {
    const result = await checkImageTaskViaProxy(record, currentSettings);
    if (result?.url) {
      record.url = result.url;
      record.localPath = result.localPath || "";
      record.localUrl = result.localUrl || "";
      record.originalImageUrl = result.originalImageUrl || "";
      record.status = "done";
      record.error = "";
      record.taskId = "";
      record.taskStatus = "";
      record.taskCandidateIndex = 0;
      record.autoCheckCount = 0;
      applyImageAsStoryCover(story, record);
      addImageMessageToContext(story, record);
      story.updatedAt = new Date().toISOString();
      saveStories();
      renderAll();
      addMessage("系统", `${record.purpose} 已生成并写入画廊。`, "npc");
      return;
    }

    if (result?.task) {
      record.taskId = result.task.taskId || record.taskId;
      record.taskStatus = result.task.status || record.taskStatus || "pending";
      record.taskCandidateIndex = 0;
      record.autoCheckCount = Number(record.autoCheckCount || 0) + (options.auto ? 1 : 0);
      record.status = "pending";
      record.error = `仍在绘制中：${record.taskStatus}。可点击“继续等待”查询同一个任务，不会重新扣费。调试记录：${buildImageProxyDebugEndpoint(currentSettings.imageProxyUrl)}`;
      story.updatedAt = new Date().toISOString();
      saveStories();
      renderAll();
      if (options.auto && record.autoCheckCount < 3) scheduleImageAutoCheck(record.id);
      return;
    }
  } catch (error) {
    record.status = "pending";
    record.error = `检查已有绘图任务失败：${error.message}。可稍后继续等待同一个任务，或查看调试记录：${buildImageProxyDebugEndpoint(currentSettings.imageProxyUrl)}`;
    story.updatedAt = new Date().toISOString();
    saveStories();
    renderAll();
  }
}
function updateUsage(costDelta, tokenDelta) {
  const story = activeStory();
  if (!story) return;
  story.usage.cost += costDelta;
  story.usage.tokens += tokenDelta;
  story.updatedAt = new Date().toISOString();
  saveStories();
  renderUsage();
  renderContextMeter();
}

function formatUserText(text) {
  const story = activeStory();
  if (!story || story.inputMode === "action") return text;

  const labelMap = {
    say: "对话",
    story: "描写",
    see: "观看",
  };
  return `[${labelMap[story.inputMode] || "输入"}] ${text}`;
}

function applyStoryStateUpdate(story, stateUpdate = {}, narrativeText = "") {
  if (!story || typeof stateUpdate !== "object") return;

  const previousChapter = story.chapter;
  const previousNextChapter = story.nextChapter;
  const previousProgress = story.progress;
  const focusLine = String(stateUpdate.focus || "").trim();
  const tensionLine = String(stateUpdate.tension || "").trim();
  const keyNpcName = String(stateUpdate.keyNpc || stateUpdate.key_npc || "").trim();
  const keyItemName = String(stateUpdate.keyItem || stateUpdate.key_item || "").trim();

  if (String(stateUpdate.goal || "").trim()) {
    story.world.goal = String(stateUpdate.goal).trim();
  }
  if (String(stateUpdate.protagonistState || stateUpdate.protagonist_state || "").trim()) {
    story.protagonist.state = String(stateUpdate.protagonistState || stateUpdate.protagonist_state).trim();
  }

  const eventSyncResult = syncStoryEvents(story, stateUpdate, narrativeText);

  if (keyNpcName) {
    promoteNpcAsKey(story, keyNpcName, tensionLine || focusLine);
  }
  if (keyItemName) {
    promoteItemAsKey(story, keyItemName, focusLine || "刚在本轮剧情中被提及");
  }

  story.memory = buildUpdatedStoryMemory(story, focusLine, tensionLine);
  syncStoryMetaFromEvents(story, stateUpdate);
  story.runtimeState = buildRuntimeStateSnapshot(
    story,
    stateUpdate,
    { previousChapter, previousNextChapter, previousProgress },
    eventSyncResult,
  );
  story.compressedState = refreshCompressedStateFromStory(story);
  story.compressedContext = formatCompressedStateText(story.compressedState);
  story.updatedAt = new Date().toISOString();
}

function promoteNpcAsKey(story, npcName, note) {
  const cleanName = String(npcName || "").trim();
  if (!cleanName) return;

  const index = story.npcs.findIndex((npc) => npc.name === cleanName);
  const npc = index >= 0 ? story.npcs[index] : { name: cleanName, relation: "关键人物", note: "" };

  if (note && (!npc.note || npc.note.length < String(note).trim().length)) {
    npc.note = String(note).trim();
  }
  if (!npc.relation) npc.relation = "关键人物";

  if (index >= 0) story.npcs.splice(index, 1);
  story.npcs.unshift(npc);
  story.npcs = story.npcs.slice(0, 8);
}

function promoteItemAsKey(story, itemName, state) {
  const cleanName = String(itemName || "").trim();
  if (!cleanName) return;

  const index = story.inventory.findIndex((item) => item.name === cleanName);
  const item = index >= 0 ? story.inventory[index] : { name: cleanName, state: "" };

  if (state && (!item.state || item.state.length < String(state).trim().length)) {
    item.state = String(state).trim();
  }

  if (index >= 0) story.inventory.splice(index, 1);
  story.inventory.unshift(item);
  story.inventory = story.inventory.slice(0, 8);
}

function buildUpdatedStoryMemory(story, focus, tension) {
  const activeEvent = story.events.find((event) => event.status === "active");
  return [
    story.world?.goal ? `当前主线：${story.world.goal}` : "",
    activeEvent?.title ? `当前事件：${activeEvent.title}` : "",
    focus ? `本轮焦点：${focus}` : "",
    tension ? `局势变化：${tension}` : "",
    story.protagonist?.state ? `主角状态：${story.protagonist.state}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function clampStoryProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 12;
  return Math.max(1, Math.min(99, Math.round(numeric)));
}

function syncStoryEvents(story, stateUpdate, narrativeText) {
  if (!Array.isArray(story.events) || !story.events.length) {
    story.events = [{ title: "当前事件", detail: story.world.goal || "等待故事推进", status: "active" }];
  }

  const activeIndex = Math.max(0, story.events.findIndex((event) => event.status === "active"));
  const activeEvent = story.events[activeIndex] || story.events[0];
  const requestedTitle = String(stateUpdate.eventTitle || stateUpdate.event_title || "").trim();
  const requestedDetail =
    String(stateUpdate.eventDetail || stateUpdate.event_detail || "").trim() ||
    summarizeRuntimeEventDetail(narrativeText) ||
    story.world.goal;
  const nextHint = String(stateUpdate.nextHint || stateUpdate.next_hint || "").trim();

  let moved = false;
  let finalActiveIndex = activeIndex;

  if (requestedTitle && normalizeEventKey(requestedTitle) !== normalizeEventKey(activeEvent?.title || "")) {
    let targetIndex = story.events.findIndex(
      (event, index) => index !== activeIndex && normalizeEventKey(event.title) === normalizeEventKey(requestedTitle),
    );

    if (targetIndex < 0) {
      story.events.push({ title: requestedTitle, detail: requestedDetail, status: "next" });
      targetIndex = story.events.length - 1;
    }

    if (story.events[activeIndex]) story.events[activeIndex].status = "done";
    story.events[targetIndex].status = "active";
    story.events[targetIndex].detail = requestedDetail || story.events[targetIndex].detail;
    finalActiveIndex = targetIndex;
    moved = true;
  } else if (activeEvent) {
    activeEvent.detail = requestedDetail || activeEvent.detail;
  }

  if (nextHint) {
    const nextTitle = deriveNextEventTitle(nextHint, story.nextChapter);
    const hasNext = story.events.some((event) => event.status === "next");
    if (!hasNext && nextTitle) {
      story.events.push({ title: nextTitle, detail: nextHint, status: "next" });
    }
  }

  normalizeStoryEventStatuses(story, finalActiveIndex);
  return {
    moved,
    activeIndex: finalActiveIndex,
    activeEvent: story.events[finalActiveIndex],
    previousEventTitle: activeEvent?.title || "",
  };
}

function normalizeStoryEventStatuses(story, activeIndex) {
  story.events = (story.events || []).filter((event) => String(event?.title || event?.detail || "").trim());
  story.events = story.events.filter((event, index, list) => {
    const key = normalizeEventKey(event.title || event.detail);
    return index === list.findIndex((item) => normalizeEventKey(item.title || item.detail) === key);
  });

  story.events.forEach((event, index) => {
    if (index < activeIndex) event.status = "done";
    else if (index === activeIndex) event.status = "active";
    else if (!event.status || event.status === "done") event.status = "next";
  });
}

function syncStoryMetaFromEvents(story, stateUpdate) {
  const activeIndex = Math.max(0, story.events.findIndex((event) => event.status === "active"));
  const activeEvent = story.events[activeIndex];
  const nextEvent = story.events.find((event) => event.status === "next");
  const requestedProgress = Number(stateUpdate.progressDelta || stateUpdate.progress_delta || 0);
  const activeBonus = activeEvent ? 8 : 0;
  const eventProgressBase = (activeIndex + 1) * 12;

  story.chapter = `${toChineseChapter(activeIndex + 1)} · ${activeEvent?.title || "当前事件"}`;
  story.nextChapter = nextEvent?.title || deriveNextEventTitle(stateUpdate.nextHint || stateUpdate.next_hint || "", story.nextChapter) || "待展开";
  story.progress = clampStoryProgress(Math.max(story.progress + requestedProgress, eventProgressBase + activeBonus));
}

function deriveNextEventTitle(nextHint, fallback = "") {
  const cleaned = String(nextHint || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback || "待展开";
  const firstSentence = cleaned.split(/[。！？?]/)[0]?.trim() || cleaned;
  return firstSentence.slice(0, 16);
}

function normalizeEventKey(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、"'“”‘’（）()\[\]【】—-]/g, "")
    .toLowerCase();
}

function toChineseChapter(index) {
  const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (index <= 10) return `第${numerals[index]}章`;
  if (index < 20) return `第十${numerals[index - 10]}章`;
  const tens = Math.floor(index / 10);
  const ones = index % 10;
  return `第${numerals[tens]}十${ones ? numerals[ones] : ""}章`;
}

function buildRuntimeStateSnapshot(story, stateUpdate, previousMeta, eventSyncResult) {
  const activeEvent = story.events.find((event) => event.status === "active");
  return {
    focus: String(stateUpdate.focus || "").trim(),
    tension: String(stateUpdate.tension || "").trim(),
    lastAppliedAt: new Date().toISOString(),
    lastEventTransition: eventSyncResult?.moved
      ? `已从${eventSyncResult.previousEventTitle || previousMeta.previousChapter || "上一阶段"}推进到${activeEvent?.title || "当前事件"}。`
      : activeEvent?.title
        ? `仍在推进：${activeEvent.title}`
        : "",
    lastNextHint: String(stateUpdate.nextHint || stateUpdate.next_hint || story.nextChapter || "").trim(),
    lastStateUpdate: { ...stateUpdate },
  };
}

function isGenericImageFocus(text = "") {
  const value = String(text || "").replace(/\s+/g, "");
  return !value || /当前关键节点|当前画面|氛围画面|生成一张|根据当前/.test(value);
}

function recentSceneMessages(story, limit = 10) {
  return (story?.messages || [])
    .slice(-limit)
    .map((message) => {
      const name = message?.type === "user" ? "玩家" : message?.name || "旁白";
      const text = stripReplyPrefixes(message?.text || "").replace(/\s+/g, " ").trim();
      return text ? `${name}：${text.slice(0, 360)}` : "";
    })
    .filter(Boolean);
}

function compactImagePromptContext(story, focusPrompt = "", purpose = "") {
  const activeEvent = (story?.events || []).find((event) => event.status === "active");
  const recent = recentSceneMessages(story, 12);
  const anchors = formatCharacterAnchorText(collectStoryCharacterAnchors(story));
  return [
    `用途：${normalizeImagePurpose(purpose)}`,
    `故事标题：${story?.title || "未命名故事"}`,
    `当前章节：${story?.chapter || "当前章节"}`,
    activeEvent?.title ? `当前事件：${activeEvent.title}` : "",
    activeEvent?.detail ? `事件背景：${activeEvent.detail}` : "",
    !isGenericImageFocus(focusPrompt) ? `用户指定画面重点：${focusPrompt}` : "",
    anchors ? `人物外观锚点：\n${anchors}` : "人物外观锚点：暂无；只能从最近剧情原文里提取当前可见外观。",
    recent.length ? `最近剧情原文，必须优先据此判断地点和画面：\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

function sanitizeImagePrompt(text) {
  let value = String(text || "").trim();
  if (!value) return "";
  value = value.replace(/Negative prompt\s*[:：][\s\S]*$/gi, "");
  value = value.replace(/负面提示词\s*[:：][\s\S]*$/g, "");
  value = value.replace(/\b(photorealistic|cinematic|anime|concept art|masterpiece|best quality|soft focus|wide shot|close up|low angle|warm color palette)\b/gi, "");
  const replacements = [
    [/未成年|幼女|萝莉|正太|儿童|孩子/g, "成年角色"],
    [/强奸|强迫|胁迫|侵犯|非自愿/g, "双方自愿的紧张关系"],
    [/性器官|生殖器|阴茎|阴道|乳头|龟头|精液|射精/g, "身体轮廓与亲密氛围"],
    [/性交|做爱|插入|口交|肛交|自慰/g, "亲密姿态与暧昧张力"],
    [/全裸|裸体|露点|裸露/g, "轻薄服饰与身体线条"],
  ];
  replacements.forEach(([pattern, replacement]) => {
    value = value.replace(pattern, replacement);
  });
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^negative prompt/i.test(line) && !/^负面提示词/.test(line))
    .join("\n");
}

function buildStoryImagePrompt(story, prompt = "", purpose = "") {
  const context = compactImagePromptContext(story, prompt, purpose);
  return sanitizeImagePrompt([
    context,
    "请生成当前剧情正在发生的一瞬间：优先还原最近剧情里的真实地点、人物位置、动作、服饰、光线和环境，不要跳到其他场景。",
  ].join("\n"));
}

function buildFallbackImagePrompt(story, prompt = "", purpose = "") {
  return composeFinalImagePrompt(buildStoryImagePrompt(story, prompt, purpose), story, {
    stylePreset: currentImageStylePreset(story),
    styleNote: currentImageStyleNote(story),
    characterAnchors: collectStoryCharacterAnchors(story),
  });
}

function promptLooksMostlyEnglish(text = "") {
  const value = String(text || "");
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  const chinese = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  return letters > 80 && letters > chinese;
}

async function rewriteImagePromptToChinese(prompt) {
  const fallback = sanitizeImagePrompt(prompt);
  if (!promptLooksMostlyEnglish(fallback) || !hasRealApiSettings() || typeof callChatApi !== "function") return fallback;
  try {
    const raw = await callChatApi(null, [
      {
        role: "system",
        content: "把用户给出的 AI 绘画提示词改写成全中文，只保留正向画面描述，删除英文风格词和负面提示词，保持场景、人物外观、动作和氛围不变。只返回改写后的提示词。",
      },
      { role: "user", content: fallback },
    ], { maxTokens: 700 });
    return sanitizeImagePrompt(raw);
  } catch {
    return fallback;
  }
}

async function prepareImagePromptForGeneration(story, prompt = "", purpose = "") {
  const fallback = buildFallbackImagePrompt(story, prompt, purpose);
  if (!hasRealApiSettings() || typeof callChatApi !== "function") {
    return { prompt: fallback, source: "fallback" };
  }

  const context = compactImagePromptContext(story, prompt, purpose);
  const messages = [
    {
      role: "system",
      content: [
        "你是 AI 绘画提示词整理器。只返回 JSON，不要解释。",
        "第一优先级：根据最近剧情原文判断当前画面发生在哪里、谁在场、正在做什么。不要根据角色身份凭空换成王宫、塔楼、封面感场景。",
        "人物一致性只指外观一致：发色、瞳色、体型、年龄感、服饰标志、气质。不要输出身份履历、关系、权力、职业。",
        "输出必须全中文，不要英文风格词，不要负面提示词，不要 Negative prompt。",
        "如果涉及成熟内容，只保留能通过生图审核的视觉表达：成年角色、亲密氛围、暧昧张力、服饰、动作和情绪；不要写裸露、性器官或直接性行为。",
        "返回格式：{\"visual_prompt\":\"...\"}",
      ].join("\n"),
    },
    { role: "user", content: context },
  ];

  try {
    const raw = await callChatApi(null, messages, { maxTokens: 900 });
    const parsed = parseImagePromptDraft(raw);
    const visualPrompt = parsed?.visual_prompt || parsed?.prompt || raw;
    const chinesePrompt = await rewriteImagePromptToChinese(visualPrompt);
    return { prompt: sanitizeImagePrompt(chinesePrompt), source: "chat", rawContext: context };
  } catch (error) {
    console.warn("[image] prompt prepare fallback", error);
    return { prompt: fallback, source: "fallback", prepareError: error.message };
  }
}

async function reviewImagePromptForImageApi(prompt) {
  const fallback = sanitizeImagePrompt(prompt);
  if (!hasRealApiSettings() || typeof callChatApi !== "function") {
    return { prompt: fallback, notes: "聊天模型不可用，已使用本地规则降风险。" };
  }
  try {
    const raw = await callChatApi(null, [
      {
        role: "system",
        content: [
          "你是 AI 绘画提示词审查器。只返回 JSON。",
          "把提示词改写成全中文正向画面描述，保留当前场景、人物外观、动作和氛围。",
          "删除负面提示词、英文风格词、高风险裸露、性器官、直接性行为、未成年、强迫、违法伤害内容。",
          "返回格式：{\"revised_prompt\":\"...\",\"notes\":\"...\"}",
        ].join("\n"),
      },
      { role: "user", content: fallback },
    ], { maxTokens: 800 });
    const parsed = parseImagePromptDraft(raw);
    return {
      prompt: sanitizeImagePrompt(parsed?.revised_prompt || parsed?.visual_prompt || parsed?.prompt || raw),
      notes: parsed?.notes || "已完成审查与降风险改写。",
    };
  } catch (error) {
    return { prompt: fallback, notes: `审查模型不可用，已使用本地规则降风险：${error.message}` };
  }
}
function summarizeRuntimeEventDetail(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.split(/[。！？!?]/)[0]?.trim() || cleaned;
}






