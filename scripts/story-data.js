function normalizeStory(input = {}) {
  const base = defaultStory();
  const merged = {
    ...base,
    ...input,
    world: { ...base.world, ...(input.world || {}) },
    protagonist: { ...base.protagonist, ...(input.protagonist || {}) },
    usage: { ...base.usage, ...(input.usage || {}) },
    contextBudget: { ...base.contextBudget, ...(input.contextBudget || {}) },
    ui: { ...base.ui, ...(input.ui || {}) },
    runtimeState: { ...base.runtimeState, ...(input.runtimeState || {}) },
    compressedState: normalizeCompressedState(
      input.compressedState || parseCompressedStateText(input.compressedContext || ""),
    ),
  };

  merged.inventory = Array.isArray(input.inventory) ? input.inventory : base.inventory;
  merged.npcs = Array.isArray(input.npcs) ? input.npcs : base.npcs;
  merged.events = Array.isArray(input.events)
    ? input.events
    : Array.isArray(input.eventState)
      ? input.eventState.map((event, index) => ({
          ...event,
          status: event?.status || (index === 0 ? "active" : "next"),
        }))
      : base.events;
  merged.worldbook = Array.isArray(input.worldbook) ? input.worldbook : base.worldbook;
  merged.images = Array.isArray(input.images) ? input.images : base.images;
  merged.visualGuide = normalizeStoryVisualGuide(input.visualGuide || base.visualGuide || {});
  merged.matureMode = normalizeMatureMode(input.matureMode, input.matureUnlocked);
  merged.matureUnlocked = Boolean(merged.matureMode.enabled);
  merged.messages = Array.isArray(input.messages) && input.messages.length ? input.messages : base.messages;

  return repairStoryData(merged);
}

function defaultStory() {
  const story = {
    id: "template-story",
    title: "新的故事档案",
    type: "自定义故事",
    cover: "forest",
    coverUrl: "",
    chapter: "第一章 · 开场",
    nextChapter: "下一章：待展开",
    progress: 8,
    perspective: "second",
    inputMode: "action",
    updatedAt: new Date().toISOString(),
    usage: { cost: 0, tokens: 0 },
    contextBudget: { percent: 0, maxTokens: 32000 },
    ui: { statusCollapsed: false, continueCollapsed: false },
    runtimeState: {
      focus: "等待玩家给出第一步行动",
      tension: "故事刚刚开始，核心冲突尚未展开",
      lastAppliedAt: "",
      lastEventTransition: "",
      lastNextHint: "",
      lastStateUpdate: {},
    },
    world: {
      setting: "这里填写世界观、时代背景、主要势力和故事基调。",
      goal: "确认当前事件的核心冲突，并推动主角做出第一轮选择。",
    },
    protagonist: {
      profile: "这里填写主角身份、外貌、性格和与故事核心事件的关系。",
      state: "刚进入故事，状态稳定。",
      cultivation: "未设定",
      luck: "未设定",
    },
    inventory: [{ name: "初始线索", state: "等待使用" }],
    npcs: [{ name: "关键角色", relation: "待建立", note: "会在开场中提供线索或制造冲突" }],
    events: [
      { title: "开场事件", detail: "主角进入故事核心场景，第一轮选择即将发生。", status: "active" },
      { title: "后续发展", detail: "根据玩家选择推进下一阶段。", status: "next" },
    ],
    memory: "故事已创建，等待玩家给出第一步行动。",
    worldbook: [{ key: "基础设定", content: "这里记录会长期影响故事的规则、地点、组织或专有名词。" }],
    images: [],
    visualGuide: {
      stylePreset: "cinematic",
      styleNote: "",
      characterAnchors: [],
    },
    matureMode: {
      enabled: false,
      confirmedAdult: false,
      level: "off",
      intensity: "off",
      overlayId: "",
      basePresetId: "auto",
      safetyRulesVersion: 1,
    },
    matureUnlocked: false,
    compressedState: {
      status: "尚未执行压缩",
      compressedCount: 0,
      mainGoal: "确认当前事件的核心冲突，并推动主角做出第一轮选择。",
      activeEvent: "开场事件",
      completedNodes: [],
      pendingNode: "后续发展",
      currentScene: "故事刚刚开始。",
      playerIntent: "等待玩家给出第一步行动。",
      unresolved: "核心冲突尚未完全揭示。",
      keyNpcs: ["关键角色 / 待建立 / 会在开场中提供线索或制造冲突"],
      keyItems: ["初始线索 / 等待使用"],
      longTermMemory: "故事已创建，等待玩家给出第一步行动。",
    },
    compressedContext: "",
    messages: [
      {
        id: createId(),
        name: "旁白",
        type: "npc",
        text: "故事已经准备好。你站在事件的入口，周围的一切都在等待你的第一步。",
      },
    ],
  };

  story.compressedContext = formatCompressedStateText(story.compressedState);
  return story;
}

function sampleStoryFixtures() {
  return [defaultStory()];
}

function sampleStories() {
  return sampleStoryFixtures().map((story) => normalizeStory(story));
}

function repairSettingsData(input = {}) {
  const repaired = { ...input };
  if (hasMojibake(repaired.chatApiUrl)) repaired.chatApiUrl = "";
  if (hasMojibake(repaired.chatModelName)) repaired.chatModelName = "";
  if (typeof repaired.chatApiUrl !== "string") repaired.chatApiUrl = "";
  if (typeof repaired.chatModelName !== "string") repaired.chatModelName = "";
  if (typeof repaired.chatApiKey !== "string") repaired.chatApiKey = "";

  if (hasMojibake(repaired.imageApiUrl)) repaired.imageApiUrl = "";
  if (hasMojibake(repaired.imageModelName)) repaired.imageModelName = "";
  if (hasMojibake(repaired.imageDefaultPurpose)) repaired.imageDefaultPurpose = "关键节点画面";
  if (typeof repaired.imageApiUrl !== "string") repaired.imageApiUrl = "";
  if (typeof repaired.imageModelName !== "string") repaired.imageModelName = "";
  if (typeof repaired.imageApiKey !== "string") repaired.imageApiKey = "";
  if (!repaired.imageProxyUrl || hasMojibake(repaired.imageProxyUrl)) repaired.imageProxyUrl = "http://127.0.0.1:8787/api/image";

  repaired.useImageProxy = repaired.useImageProxy !== false;
  repaired.imageDefaultPurpose = repaired.imageDefaultPurpose || "关键节点画面";
  repaired.askImageCover = Boolean(repaired.askImageCover);
  repaired.noMajorDecision = repaired.noMajorDecision !== false;
  repaired.autoSummary = repaired.autoSummary !== false;
  repaired.nextStep = Boolean(repaired.nextStep);
  repaired.responseLength = ["short", "balanced", "long", "immersive"].includes(repaired.responseLength) ? repaired.responseLength : "long";
  repaired.imageStylePreset = normalizeImageStylePreset(repaired.imageStylePreset || "cinematic");
  return repaired;
}

function hasMojibake(value) {
  return typeof value === "string" && mojibakePattern.test(value);
}

function sampleStoryFallback(id) {
  return sampleStoryFixtures().find((story) => story.id === id) || defaultStory();
}

function repairStoryData(story) {
  const generic = defaultStory();

  if (hasMojibake(story.title) || !story.title) story.title = generic.title;
  if (hasMojibake(story.type) || !story.type) story.type = generic.type;
  if (hasMojibake(story.chapter) || !story.chapter) story.chapter = generic.chapter;
  if (hasMojibake(story.nextChapter) || !story.nextChapter) story.nextChapter = generic.nextChapter;
  if (hasMojibake(story.cover) || !story.cover) story.cover = "forest";
  if (hasMojibake(story.coverUrl)) story.coverUrl = "";
  if (hasMojibake(story.world?.setting) || !story.world?.setting) story.world.setting = generic.world.setting;
  if (hasMojibake(story.world?.goal) || !story.world?.goal) story.world.goal = generic.world.goal;
  if (hasMojibake(story.protagonist?.profile) || !story.protagonist?.profile) story.protagonist.profile = generic.protagonist.profile;
  if (hasMojibake(story.protagonist?.state) || !story.protagonist?.state) story.protagonist.state = generic.protagonist.state;
  if (hasMojibake(story.protagonist?.cultivation) || !story.protagonist?.cultivation) story.protagonist.cultivation = generic.protagonist.cultivation;
  if (hasMojibake(story.protagonist?.luck) || !story.protagonist?.luck) story.protagonist.luck = generic.protagonist.luck;
  if (hasMojibake(story.memory) || !String(story.memory || "").trim()) story.memory = generic.memory;

  story.inventory = normalizeInventoryList(story.inventory, generic.inventory);
  story.npcs = normalizeNpcList(story.npcs, generic.npcs);
  story.events = normalizeEventList(story.events, generic.events);
  story.worldbook = normalizeWorldbookList(story.worldbook, generic.worldbook);
  story.images = normalizeImageList(story.images, story);
  story.visualGuide = normalizeStoryVisualGuide(story.visualGuide || generic.visualGuide || {});

  repairLegacyCustomStoryFields(story);
  story.compressedState = refreshCompressedStateFromStory(story);
  story.compressedContext = formatCompressedStateText(story.compressedState);
  return story;
}

function normalizeInventoryList(items, fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source.map((item, index) => ({
    name: hasMojibake(item?.name) || !item?.name ? `物品 ${index + 1}` : item.name,
    state: hasMojibake(item?.state) ? "" : item?.state || "",
  }));
}

function normalizeNpcList(items, fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source.map((npc, index) => ({
    name: hasMojibake(npc?.name) || !npc?.name ? `角色 ${index + 1}` : npc.name,
    relation: hasMojibake(npc?.relation) ? "未知" : npc?.relation || "未知",
    note: hasMojibake(npc?.note) ? "" : npc?.note || "",
  }));
}

function normalizeEventList(items, fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source.map((event, index) => ({
    title: hasMojibake(event?.title) || !event?.title ? `事件 ${index + 1}` : event.title,
    status: event?.status || (index === 0 ? "active" : "next"),
    detail: hasMojibake(event?.detail) ? "" : event?.detail || "",
  }));
}

function normalizeWorldbookList(items, fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source.map((entry, index) => ({
    key: hasMojibake(entry?.key) || !entry?.key ? `词条 ${index + 1}` : entry.key,
    content: hasMojibake(entry?.content) ? "" : entry?.content || "",
  }));
}

function normalizeImageList(items, story) {
  return (Array.isArray(items) ? items : []).map((image, index) => ({
    id: image?.id || `${story.id || "story"}-image-${index + 1}`,
    prompt: String(image?.prompt || "").trim(),
    purpose: hasMojibake(image?.purpose) || !image?.purpose ? "关键节点画面" : image.purpose,
    status: ["suggested", "pending", "done", "error"].includes(image?.status) ? image.status : "suggested",
    url: String(image?.url || "").trim(),
    originalImageUrl: String(image?.originalImageUrl || image?.original_image_url || "").trim(),
    localUrl: String(image?.localUrl || image?.local_url || "").trim(),
    localPath: String(image?.localPath || image?.local_path || "").trim(),
    error: hasMojibake(image?.error) ? "" : String(image?.error || "").trim(),
    rawPrompt: String(image?.rawPrompt || image?.sourcePrompt || "").trim(),
    promptSource: String(image?.promptSource || "").trim(),
    promptPrepareError: String(image?.promptPrepareError || "").trim(),
    taskId: String(image?.taskId || image?.task_id || "").trim(),
    taskStatus: String(image?.taskStatus || image?.task_status || "").trim(),
    taskCandidateIndex: Number(image?.taskCandidateIndex || image?.task_candidate_index || 0),
    autoCheckCount: Number(image?.autoCheckCount || image?.auto_check_count || 0),
    stylePreset: normalizeImageStylePreset(image?.stylePreset || image?.style_preset || story?.visualGuide?.stylePreset || "cinematic"),
    styleNote: String(image?.styleNote || image?.style_note || "").trim(),
    createdAt: image?.createdAt || story.updatedAt || new Date().toISOString(),
  }));
}

function repairLegacyCustomStoryFields(story) {
  const derivedMeta = deriveStoryMetaFromDraft(story);
  if (!story.chapter) story.chapter = derivedMeta.chapter;
  if (!story.nextChapter) story.nextChapter = derivedMeta.nextChapter;
  if (!Number.isFinite(Number(story.progress))) story.progress = derivedMeta.progress;
  if (!String(story.memory || "").trim()) story.memory = buildInitialStoryMemory(story.title, story, "", "");
  if (!String(story.compressedContext || "").trim()) {
    story.compressedState = buildInitialCompressedState(story);
    story.compressedContext = formatCompressedStateText(story.compressedState);
  }
}

function deriveStoryMetaFromDraft(draft) {
  const activeEvent = (draft.events || []).find((event) => event.status === "active") || draft.events?.[0];
  const nextEvent = (draft.events || []).find((event) => event.status === "next");
  return {
    chapter: activeEvent?.title ? `第一章 · ${activeEvent.title}` : "第一章 · 开场",
    nextChapter: nextEvent?.title || "待展开",
    progress: 12,
  };
}

function buildInitialStoryMemory(title, draft, template, outline) {
  const memoryParts = [
    `故事已创建：${title}`,
    draft.world?.goal ? `主线目标：${draft.world.goal}` : "",
    draft.protagonist?.state ? `主角状态：${draft.protagonist.state}` : "",
    draft.events?.[0]?.title ? `开场事件：${draft.events[0].title}` : "",
    template ? `底稿来源：${summarizeSeedText(template)}` : "",
    outline ? `大纲摘要：${summarizeSeedText(outline)}` : "",
  ].filter(Boolean);
  return memoryParts.join("\n");
}

function buildInitialCompressedContext(draft) {
  return formatCompressedStateText(buildInitialCompressedState(draft));
}

function buildInitialCompressedState(draft) {
  const npcs = (draft.npcs || [])
    .slice(0, 2)
    .map((npc) => [npc.name, npc.relation, npc.note].filter(Boolean).join(" / "))
    .filter(Boolean);
  const inventory = (draft.inventory || [])
    .slice(0, 2)
    .map((item) => [item.name, item.state].filter(Boolean).join(" / "))
    .filter(Boolean);
  const activeEvent = (draft.events || []).find((event) => event.status === "active") || draft.events?.[0];
  const nextEvent = (draft.events || []).find((event) => event.status === "next");
  return normalizeCompressedState({
    status: "尚未执行压缩",
    compressedCount: 0,
    mainGoal: draft.world?.goal || "继续推进当前故事。",
    activeEvent: activeEvent?.title || "开场事件",
    completedNodes: [],
    pendingNode: nextEvent?.title || "待展开",
    currentScene: activeEvent?.detail || draft.world?.goal || "故事刚刚开始。",
    playerIntent: "等待玩家给出第一步行动。",
    unresolved: "核心冲突尚未完全揭示。",
    keyNpcs: npcs,
    keyItems: inventory,
    longTermMemory: draft.memory || draft.world?.goal || "",
  });
}

function summarizeSeedText(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120);
}
