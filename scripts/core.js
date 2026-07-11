const imageStylePresets = [
  {
    id: "cinematic",
    label: "电影感写实",
    prompt: "电影感构图，真实光线，主体清晰，环境有层次，色彩克制，画面像电影剧照",
  },
  {
    id: "concept-art",
    label: "原画风格",
    prompt: "游戏原画质感，场景设计完整，人物轮廓明确，细节丰富，适合作为关键剧情画面",
  },
  {
    id: "anime",
    label: "动漫风格",
    prompt: "精致动漫插画，线条干净，人物表情明确，光影柔和，画面有叙事感",
  },
  {
    id: "photoreal",
    label: "写实摄影",
    prompt: "写实摄影质感，自然镜头视角，材质可信，皮肤和服饰细节真实，环境光合理",
  },
  {
    id: "oriental-fantasy",
    label: "东方幻想",
    prompt: "东方幻想美术，服饰与环境细节典雅，光线含蓄，画面有诗意和空间层次",
  },
];

const storageKeys = {
  legacyStory: "tavern-active-story",
  stories: "tavern-stories",
  activeStoryId: "tavern-active-story-id",
  settings: "tavern-api-settings",
  theme: "tavern-theme",
  sidebar: "tavern-sidebar-collapsed",
};

function getDefaultImageProxyUrl() {
  return window?.tavernDesktop?.imageProxyUrl || window?.__TAVERN_DEFAULT_PROXY_URL__ || "http://127.0.0.1:8787/api/image";
}

const modeLabels = {
  action: "行动",
  say: "对话",
  story: "描写",
  see: "观察",
};

const mojibakePattern = /[\uFFFD\u951F\u9474\u941A\u95BF]/;

const modePlaceholders = {
  action: "输入你的行动，例如：我跟着星辉深入森林",
  say: "输入你要说的话，例如：白璃，你相信那道裂隙吗？",
  story: "补充一段描写，例如：夜色压低，星辉从树隙落下。",
  see: "描述想看的画面，例如：生成码头清晨人流聚集的场景。",
};

const storyTypeSeeds = {
  "修仙 + 科幻": "宗门、境界、星空裂隙、天外文明",
  "都市奇谈": "城市异常、调查线索、夜间事件、隐藏组织",
  "武侠江湖": "门派恩怨、镖局路线、朝堂暗线、江湖声望",
  "奇幻冒险": "王国酒馆、队友招募、遗迹探索、魔法势力",
};
function perspectiveLabel(value) {
  return value === "first" ? "第一人称" : value === "second" ? "第二人称" : "第三人称";
}

function normalizeImageStylePreset(value) {
  const presetId = String(value || "").trim().toLowerCase();
  return imageStylePresets.some((preset) => preset.id === presetId) ? presetId : imageStylePresets[0].id;
}

function getImageStylePreset(value) {
  const presetId = normalizeImageStylePreset(value);
  return imageStylePresets.find((preset) => preset.id === presetId) || imageStylePresets[0];
}

function normalizeCharacterAnchorItem(input = {}) {
  const name = String(input.name || input.character || "").trim();
  const traits = String(input.traits || input.visual || input.note || "").replace(/\s+/g, " ").trim();
  return name && traits ? { name, traits } : null;
}

function parseCharacterAnchorText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split("|").map((part) => part.trim());
      return normalizeCharacterAnchorItem({ name, traits: rest.join(" | ") });
    })
    .filter(Boolean);
}

function formatCharacterAnchorText(items = []) {
  return items
    .map((item) => normalizeCharacterAnchorItem(item))
    .filter(Boolean)
    .map((item) => `${item.name} | ${item.traits}`)
    .join("\n");
}

function summarizeVisualTraits(text, limit = 96) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned;
}

function normalizeStoryVisualGuide(input = {}, fallbackPreset = "cinematic") {
  const characterAnchors = Array.isArray(input.characterAnchors)
    ? input.characterAnchors.map((item) => normalizeCharacterAnchorItem(item)).filter(Boolean)
    : parseCharacterAnchorText(input.characterAnchorText || input.charactersText || "");
  return {
    stylePreset: normalizeImageStylePreset(input.stylePreset || input.defaultStyle || fallbackPreset),
    styleNote: String(input.styleNote || input.promptNote || "").trim(),
    characterAnchors,
  };
}

function collectStoryCharacterAnchors(story) {
  const visualGuide = normalizeStoryVisualGuide(story?.visualGuide || {});
  return visualGuide.characterAnchors;
}

function buildImageStyleBlock(stylePreset, styleNote = "") {
  const preset = getImageStylePreset(stylePreset);
  const lines = [`绘画风格：${preset.label}`, `风格要求：${preset.prompt}`];
  if (String(styleNote || "").trim()) lines.push(`附加风格要求：${String(styleNote).trim()}`);
  return lines.join("\n");
}

function buildCharacterAnchorBlock(story, characterAnchors = null) {
  const anchors = Array.isArray(characterAnchors) ? characterAnchors.filter(Boolean) : collectStoryCharacterAnchors(story);
  if (!anchors.length) return "";
  return [
    "当前人物外观锚点：",
    ...anchors.map((anchor) => `- ${anchor.name}：${anchor.traits}`),
    "要求：如果这些人物出现在当前画面中，发型、发色、瞳色、体型、年龄感、服饰标志和气质必须保持一致；不要自行替换发型、衣服或人种特征。",
  ].join("\n");
}

function composeFinalImagePrompt(basePrompt, story, options = {}) {
  const presetId = normalizeImageStylePreset(options.stylePreset || story?.visualGuide?.stylePreset || "cinematic");
  const styleBlock = buildImageStyleBlock(presetId, options.styleNote || story?.visualGuide?.styleNote || "");
  const anchorBlock = buildCharacterAnchorBlock(story, options.characterAnchors);
  return [String(basePrompt || "").trim(), styleBlock, anchorBlock]
    .filter(Boolean)
    .join("\n\n")
    .replace(/Negative prompt\s*[:：][\s\S]*$/i, "")
    .replace(/负面提示词\s*[:：][\s\S]*$/i, "")
    .trim();
}

function imageFolderActionLabel() {
  return "打开文件夹";
}
function normalizeMatureMode(input = {}, fallbackEnabled = false) {
  const enabled = Boolean(input.enabled ?? fallbackEnabled);
  const intensity = enabled ? "explicit" : "off";
  return {
    enabled,
    confirmedAdult: Boolean(input.confirmedAdult ?? input.enabled ?? fallbackEnabled),
    level: input.level || (enabled ? "mature" : "off"),
    intensity,
    overlayId: enabled ? input.overlayId || "mature" : "",
    basePresetId: input.basePresetId || "auto",
    safetyRulesVersion: Number(input.safetyRulesVersion) || 1,
  };
}

function isMatureModeEnabled(story) {
  return Boolean(story?.matureMode?.enabled || story?.matureUnlocked);
}

function responseLengthGuide(value) {
  const guides = {
    short: "简短回复，约 300-600 中文字，至少 3 段；保留关键动作、对话和选择前停顿。",
    balanced: "均衡回复，约 700-1200 中文字，至少 5 段；正文完整，人物反应具体。",
    long: "偏长回复，约 1200-2000 中文字，至少 7 段；场景、动作和关系推进都要写出来。",
    immersive: "沉浸长文，约 2200-3800 中文字，至少 8-12 段；像章节片段一样展开，但仍停在玩家下一次选择前。",
  };
  return guides[value] || guides.long;
}

function responseMaxTokens(value) {
  const limits = {
    short: 900,
    balanced: 1600,
    long: 2600,
    immersive: 5200,
  };
  return limits[value] || limits.long;
}

function formatTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function markSaved(text) {
  const node = document.querySelector("#save-status");
  if (!node) return;
  node.textContent = text;
  window.clearTimeout(markSaved.timer);
  markSaved.timer = window.setTimeout(() => {
    const fresh = document.querySelector("#save-status");
    if (fresh) fresh.textContent = "已保存";
  }, 1200);
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function setValue(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.value = value || "";
}

function getValue(selector) {
  return document.querySelector(selector)?.value.trim() || "";
}

function setChecked(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.checked = Boolean(value);
}

function getChecked(selector) {
  return Boolean(document.querySelector(selector)?.checked);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function formatMessageText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function defaultCompressedState() {
  return {
    status: "尚未执行压缩",
    compressedCount: 0,
    mainGoal: "",
    activeEvent: "",
    completedNodes: [],
    pendingNode: "",
    currentScene: "",
    playerIntent: "",
    unresolved: "",
    keyNpcs: [],
    keyItems: [],
    longTermMemory: "",
  };
}

function normalizeCompressedState(input) {
  const base = defaultCompressedState();
  const merged = { ...base, ...(input || {}) };
  merged.compressedCount = Number.isFinite(Number(merged.compressedCount)) ? Number(merged.compressedCount) : 0;
  merged.completedNodes = Array.isArray(merged.completedNodes) ? merged.completedNodes.filter(Boolean) : [];
  merged.keyNpcs = Array.isArray(merged.keyNpcs) ? merged.keyNpcs.filter(Boolean) : [];
  merged.keyItems = Array.isArray(merged.keyItems) ? merged.keyItems.filter(Boolean) : [];
  return merged;
}

function parseCompressedStateText(text) {
  const state = defaultCompressedState();
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line) => {
    const matched = line.match(/^【([^】]+)】\s*(.*)$/);
    if (!matched) return;
    const [, label, value] = matched;
    if (label.includes("压缩状态")) {
      state.status = value || state.status;
      const countMatch = value.match(/已压缩\s*(\d+)/);
      if (countMatch) state.compressedCount = Number(countMatch[1]) || 0;
    } else if (label.includes("当前主线")) {
      state.mainGoal = value;
    } else if (label.includes("已完成节点")) {
      state.completedNodes = value && value !== "暂无" ? value.split(/[、，,]/).map((item) => item.trim()).filter(Boolean) : [];
    } else if (label.includes("下一节点")) {
      state.pendingNode = value;
    } else if (label.includes("当前场景")) {
      state.currentScene = value;
    } else if (label.includes("关键人物")) {
      state.keyNpcs = value && value !== "暂无" ? value.split(/[；;]/).map((item) => item.trim()).filter(Boolean) : [];
    } else if (label.includes("关键物品")) {
      state.keyItems = value && value !== "暂无" ? value.split(/[；;]/).map((item) => item.trim()).filter(Boolean) : [];
    } else if (label.includes("玩家意图")) {
      state.playerIntent = value;
    } else if (label.includes("待解决问题")) {
      state.unresolved = value;
    } else if (label.includes("长期记忆")) {
      state.longTermMemory = value;
    }
  });

  return normalizeCompressedState(state);
}
function refreshCompressedStateFromStory(story) {
  const current = normalizeCompressedState(story?.compressedState || parseCompressedStateText(story?.compressedContext || ""));
  const activeEvent = story?.events?.find((event) => event.status === "active");
  const nextEvent = story?.events?.find((event) => event.status === "next");
  const completedNodes = Array.isArray(story?.events) ? story.events.filter((event) => event.status === "done").map((event) => event.title).filter(Boolean) : [];
  const keyNpcs = Array.isArray(story?.npcs)
    ? story.npcs.slice(0, 3).map((npc) => [npc.name, npc.relation, npc.note].filter(Boolean).join(" / ")).filter(Boolean)
    : [];
  const keyItems = Array.isArray(story?.inventory)
    ? story.inventory.slice(0, 3).map((item) => [item.name, item.state].filter(Boolean).join(" / ")).filter(Boolean)
    : [];

  return normalizeCompressedState({
    ...current,
    mainGoal: story?.world?.goal || current.mainGoal,
    activeEvent: activeEvent?.title || current.activeEvent,
    completedNodes: completedNodes.length ? completedNodes : current.completedNodes,
    pendingNode: nextEvent?.title || current.pendingNode,
    keyNpcs: keyNpcs.length ? keyNpcs : current.keyNpcs,
    keyItems: keyItems.length ? keyItems : current.keyItems,
    longTermMemory: story?.memory || current.longTermMemory,
  });
}

function formatCompressedStateText(input) {
  const state = normalizeCompressedState(input);
  const statusLine = state.compressedCount > 0 ? `已压缩 ${state.compressedCount} 条较早消息` : state.status || "尚未执行压缩";
  return [
    `【压缩状态】${statusLine}`,
    `【当前主线】${state.activeEvent || state.mainGoal || "继续推进当前故事"}`,
    `【已完成节点】${state.completedNodes.join("、") || "暂无"}`,
    `【下一节点】${state.pendingNode || "待确认"}`,
    `【当前场景】${state.currentScene || "暂无"}`,
    `【关键人物】${state.keyNpcs.join("；") || "暂无"}`,
    `【关键物品】${state.keyItems.join("；") || "暂无"}`,
    `【玩家意图】${state.playerIntent || "暂无"}`,
    `【待解决问题】${state.unresolved || "暂无"}`,
    `【长期记忆】${state.longTermMemory || "暂无"}`,
  ].join("\n");
}
