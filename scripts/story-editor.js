function openStorySettings(id) {
  try {
    setActiveStorySilently(id);
    const story = activeStory();
    if (!story) {
      showDialog(storySettingsDialog);
      return;
    }

    pendingStoryWorldbookEntries = [];
    setValue("#story-setting-title", story.title);
    setValue("#story-setting-type", story.type);
    setChecked("#story-mature-unlocked", isMatureModeEnabled(story));
    setValue("#story-world", story.world.setting);
    setValue("#story-goal", story.world.goal);
    setValue("#story-protagonist-profile", story.protagonist.profile);
    setValue("#story-protagonist-cultivation", story.protagonist.cultivation);
    setValue("#story-protagonist-luck", story.protagonist.luck);
    setValue("#story-visual-style", story.visualGuide?.stylePreset || "cinematic");
    setValue("#story-visual-style-note", story.visualGuide?.styleNote || "");
    setValue("#story-character-anchors", formatCharacterAnchorText(story.visualGuide?.characterAnchors || []));
    setValue("#story-npcs", formatNpcs(story.npcs));
    setValue("#story-inventory", formatInventory(story.inventory));
    setValue("#story-events", formatEvents(story.events));
    setValue("#story-worldbook", formatWorldbook(story.worldbook));
    setValue("#story-memory", story.memory);
    setValue("#story-compressed", story.compressedContext);
    setValue("#story-runtime-npc", buildStoryRuntimeNpcText(story));
    setValue("#story-runtime-item", buildStoryRuntimeItemText(story));
    setValue("#story-runtime-events", buildStoryRuntimeEventsText(story));
    setValue("#story-runtime-state", buildStoryRuntimeStateText(story));
    setValue("#story-runtime-update", buildStoryRuntimeUpdateText(story));
    renderStoryWorldbookImport(null, []);
    showDialog(storySettingsDialog);
  } catch (error) {
    console.error("Failed to open story settings", error);
    showDialog(storySettingsDialog);
  }
}

function openStorySettingsDialog(id) {
  openStorySettings(id);
}

function saveStorySettingsFromDialog() {
  const story = activeStory();
  if (!story) return;
  story.title = getValue("#story-setting-title") || story.title;
  story.type = getValue("#story-setting-type") || story.type;
  const matureEnabled = getChecked("#story-mature-unlocked");
  story.matureMode = normalizeMatureMode({
    ...(story.matureMode || {}),
    enabled: matureEnabled,
    confirmedAdult: matureEnabled,
    intensity: matureEnabled ? "explicit" : "off",
    overlayId: matureEnabled ? "mature" : "",
  }, matureEnabled);
  story.matureUnlocked = story.matureMode.enabled;
  story.world.setting = getValue("#story-world");
  story.world.goal = getValue("#story-goal");
  story.protagonist.profile = getValue("#story-protagonist-profile");
  story.protagonist.cultivation = getValue("#story-protagonist-cultivation");
  story.protagonist.luck = getValue("#story-protagonist-luck");
  story.visualGuide = normalizeStoryVisualGuide({
    stylePreset: getValue("#story-visual-style"),
    styleNote: getValue("#story-visual-style-note"),
    characterAnchors: parseCharacterAnchorText(getValue("#story-character-anchors")),
  }, story.visualGuide?.stylePreset || "cinematic");
  story.npcs = parseNpcs(getValue("#story-npcs"));
  story.inventory = parseInventory(getValue("#story-inventory"));
  story.events = parseEvents(getValue("#story-events"));
  story.worldbook = parseWorldbook(getValue("#story-worldbook"));
  story.updatedAt = new Date().toISOString();
  story.memory = buildUpdatedStoryMemory(story, story.runtimeState?.focus || "", story.runtimeState?.tension || "");
  story.compressedState = refreshCompressedStateFromStory(story);
  story.compressedContext = formatCompressedStateText(story.compressedState);
  saveStories();
  renderAll();
  closeDialog(storySettingsDialog);
}

function buildStoryRuntimeStateText(story) {
  const activeEvent = story.events.find((event) => event.status === "active");
  const runtimeState = story.runtimeState || {};
  return [
    `当前状态：${story.protagonist.state || "暂无"}`,
    `当前事件：${activeEvent?.title || "暂无"}`,
    `最近焦点：${runtimeState.focus || "暂无"}`,
    `局势变化：${runtimeState.tension || "暂无"}`,
    `下一章：${story.nextChapter || "待展开"}`,
    `当前进度：${story.progress}%`,
  ].join("\n");
}

function buildStoryRuntimeNpcText(story) {
  const keyNpc = story.npcs?.[0];
  if (!keyNpc) return "暂无关键人物";
  return [`当前人物：${keyNpc.name}`, `关系定位：${keyNpc.relation || "未标注"}`, `本轮作用：${keyNpc.note || "暂无"}`].join("\n");
}

function buildStoryRuntimeItemText(story) {
  const keyItem = story.inventory?.[0];
  if (!keyItem) return "暂无关键物品";
  return [`当前物品：${keyItem.name}`, `当前状态：${keyItem.state || "暂无"}`, `关联提示：${story.runtimeState?.lastNextHint || "暂无"}`].join("\n");
}

function buildStoryRuntimeEventsText(story) {
  const events = Array.isArray(story.events) ? story.events : [];
  if (!events.length) return "暂无事件链";
  return events
    .slice(0, 6)
    .map((event) => {
      const label = event.status === "done" ? "已完成" : event.status === "active" ? "当前推进" : "下一步";
      return `${label} - ${event.title}\n${event.detail || "暂无描述"}`;
    })
    .join("\n\n");
}

function buildStoryRuntimeUpdateText(story) {
  const runtimeState = story.runtimeState || {};
  const update = runtimeState.lastStateUpdate || {};
  const summary = [
    runtimeState.lastEventTransition ? `推进结果：${runtimeState.lastEventTransition}` : "",
    runtimeState.lastNextHint ? `下一步提示：${runtimeState.lastNextHint}` : "",
    Object.keys(update).length ? `最近写回：${JSON.stringify(update, null, 2)}` : "",
  ].filter(Boolean);
  return summary.join("\n\n") || "暂无运行时推进记录";
}

function openCreateDialog() {
  try {
    generatedDraft = null;
    const title = getValue("#create-title") || "新的故事档案";
    const type = getValue("#create-type") || "自定义故事";
    const draft = localDraft(title, type, getValue("#create-outline"));
    hydrateDraftForm(draft);
    if (createStatus) createStatus.textContent = "等待输入大纲。";
    resetCreateWorldbookImportSession();
    showDialog(createDialog);
  } catch (error) {
    console.error("Failed to open create dialog", error);
    showDialog(createDialog);
  }
}

function openCreateStoryDialog() {
  openCreateDialog();
}

function handleOpenCreateDialog() {
  openCreateDialog();
}

async function enhanceCreateOutline() {
  const enhanceButton = document.querySelector("#enhance-outline");
  const title = getValue("#create-title") || "新的故事档案";
  const type = getValue("#create-type") || "自定义故事";
  const template = getValue("#create-template");
  const outline = getValue("#create-outline");

  if (enhanceButton) {
    enhanceButton.disabled = true;
    enhanceButton.textContent = "完善中...";
  }
  if (createStatus) createStatus.textContent = "正在完善设定...";
  updateCreateImportProgress(12, "正在完善设定", "正在整理标题、类型、底稿和大纲。", true);

  try {
    if (hasRealApiSettings()) {
      updateCreateImportProgress(35, "正在请求模型", "正在让聊天模型生成故事设定草稿。", true);
      const messages = [
        {
          role: "system",
          content: [
            "你是中文故事设定编辑。请把用户输入整理成适合长期故事原型的数据。",
            "只返回 JSON，字段包括 meta、world、protagonist、npcs、inventory、events、worldbook、opening。",
            "不要写解释，不要输出 Markdown。",
          ].join("\n"),
        },
        { role: "user", content: [`标题：${title}`, `类型：${type}`, `底稿：${template || "未填写"}`, `大纲：${outline || "未填写"}`].join("\n") },
      ];
      const raw = await callChatApi(null, messages);
      updateCreateImportProgress(72, "正在写入草稿", "模型已返回，正在同步到故事设定表单。", true);
      generatedDraft = parseDraft(raw, title, type, [template, outline].filter(Boolean).join("\n"));
      hydrateDraftForm(generatedDraft, { preserveExisting: false });
      if (createStatus) createStatus.textContent = "AI 草稿已生成，可继续手动调整。";
      updateCreateImportProgress(100, "完善完成", "AI 设定已写入下面的故事草稿。", true);
      return;
    }

    updateCreateImportProgress(60, "使用本地草稿", "未检测到可用聊天模型配置，正在用本地规则补全。", true);
    generatedDraft = localDraft(title, type, [template, outline].filter(Boolean).join("\n"));
    hydrateDraftForm(generatedDraft, { preserveExisting: false });
    if (createStatus) createStatus.textContent = "未检测到可用 API，已用本地草稿补全字段。";
    updateCreateImportProgress(100, "完善完成", "本地草稿已写入下面的故事设定。", true);
  } catch (error) {
      if (createStatus) createStatus.textContent = `AI 完善失败，已保留当前输入：${error.message}`;
      updateCreateImportProgress(100, "完善失败", error.message, true);
  } finally {
    if (enhanceButton) {
      enhanceButton.disabled = false;
      enhanceButton.textContent = "AI 完善设定";
    }
  }
}

function createStoryFromDialog() {
  const title = getValue("#create-title") || generatedDraft?.meta?.title || "新的故事档案";
  const type = getValue("#create-type") || generatedDraft?.meta?.type || "自定义故事";
  const perspective = getValue("#create-perspective") || "second";
  const template = getValue("#create-template") || generatedDraft?.meta?.template || "";
  const outline = getValue("#create-outline");
  const draft = readDraftForm(title, type);
  const storyMeta = deriveStoryMetaFromDraft(draft);
  const story = normalizeStory({
    id: createId(),
    title,
    type,
    perspective,
    cover: type.includes("都市") ? "city" : type.includes("武侠") ? "river" : "forest",
    coverUrl: "",
    chapter: storyMeta.chapter,
    nextChapter: storyMeta.nextChapter,
    progress: storyMeta.progress,
    world: draft.world,
    protagonist: draft.protagonist,
    npcs: draft.npcs,
    inventory: draft.inventory,
    events: draft.events,
    worldbook: draft.worldbook,
    memory: buildInitialStoryMemory(title, draft, template, outline),
    compressedContext: buildInitialCompressedContext(draft),
    messages: [{ id: createId(), name: "旁白", type: "npc", text: draft.opening }],
  });
  if (typeof addSuggestedCoverImage === "function") addSuggestedCoverImage(story);
  stories.unshift(story);
  activeStoryId = story.id;
  saveStories();
  closeDialog(createDialog);
  renderAll();
  switchView("home");
}

function hydrateSettingsForm() {
  setValue("#chat-api-url", settings.chatApiUrl);
  setValue("#chat-model-name", settings.chatModelName);
  setValue("#chat-api-key", settings.chatApiKey);
  setValue("#image-api-url", settings.imageApiUrl);
  setValue("#image-model-name", settings.imageModelName);
  setValue("#image-api-key", settings.imageApiKey);
  setValue("#image-proxy-url", settings.imageProxyUrl);
  setChecked("#use-image-proxy", settings.useImageProxy);
  setValue("#image-default-purpose", settings.imageDefaultPurpose);
  setChecked("#ask-image-cover", settings.askImageCover);
  setChecked("#rule-no-major-decision", settings.noMajorDecision);
  setChecked("#rule-auto-summary", settings.autoSummary);
  setChecked("#rule-next-step", settings.nextStep);
  setValue("#response-length", settings.responseLength);
}

function readSettingsForm() {
  return {
    chatApiUrl: getValue("#chat-api-url"),
    chatModelName: getValue("#chat-model-name"),
    chatApiKey: getValue("#chat-api-key"),
    imageApiUrl: getValue("#image-api-url"),
    imageModelName: getValue("#image-model-name"),
    imageApiKey: getValue("#image-api-key"),
    imageProxyUrl: getValue("#image-proxy-url") || getDefaultImageProxyUrl(),
    useImageProxy: getChecked("#use-image-proxy"),
    imageDefaultPurpose: getValue("#image-default-purpose") || "关键节点画面",
    imageStylePreset: settings.imageStylePreset || "cinematic",
    askImageCover: getChecked("#ask-image-cover"),
    noMajorDecision: getChecked("#rule-no-major-decision"),
    autoSummary: getChecked("#rule-auto-summary"),
    nextStep: getChecked("#rule-next-step"),
    responseLength: getValue("#response-length") || "long",
  };
}

function localDraft(title, type, outline) {
  const seed = outline || localSeedByType(type);
  return {
    meta: { title, type, template: "" },
    world: {
      setting: `${seed}。整个世界会围绕主角选择持续展开，并保留长期事件记忆。`,
      goal: "确认当前事件的核心冲突，并进入第一轮探索。",
    },
    protagonist: {
      profile: `主角与“${title}”的核心事件有关，拥有可以持续成长的身份与处境。`,
      state: "刚进入故事，状态稳定。",
      cultivation: type.includes("修仙") ? "炼气初期" : "未设定",
      luck: "未定",
    },
    npcs: [{ name: "关键角色", relation: "待建立", note: "会在第一章中登场并提供线索" }],
    inventory: [{ name: "初始线索", state: "等待使用" }],
    events: [{ title: "开场事件", detail: "主角进入故事核心场景，第一次选择即将发生。", status: "active" }],
    worldbook: [],
    opening: `故事《${title}》开始了。${seed} 你站在事件入口，周围的一切都在等待你的第一步。`,
  };
}

function localSeedByType(type) {
  const source = String(type || "");
  if (source.includes("修仙")) return "宗门、境界、秘境与异象开始同时失控";
  if (source.includes("科幻")) return "异常技术、未知文明与现实秩序发生碰撞";
  if (source.includes("都市")) return "表面平静的现代生活下，隐藏着需要调查的秘密";
  if (source.includes("悬疑")) return "旧线索、失踪事件与不完整证据正在逼近真相";
  return "一个尚未完全展开的故事正在等待主角推进";
}

function setDraftValue(selector, value, preserveExisting) {
  if (preserveExisting && getValue(selector)) return;
  setValue(selector, value || "");
}

function hydrateDraftForm(draft, options = {}) {
  const { preserveExisting = false } = options;
  if (draft?.meta?.title) setDraftValue("#create-title", draft.meta.title, preserveExisting);
  if (draft?.meta?.type) setDraftValue("#create-type", draft.meta.type, preserveExisting);
  if (draft?.meta?.template) setDraftValue("#create-template", draft.meta.template, preserveExisting);
  setDraftValue("#draft-world", draft.world?.setting || "", preserveExisting);
  setDraftValue("#draft-goal", draft.world?.goal || "", preserveExisting);
  setDraftValue("#draft-protagonist", draft.protagonist?.profile || "", preserveExisting);
  setDraftValue("#draft-state", draft.protagonist?.state || "", preserveExisting);
  setDraftValue("#draft-npcs", formatNpcs(draft.npcs || []), preserveExisting);
  setDraftValue("#draft-inventory", formatInventory(draft.inventory || []), preserveExisting);
  setDraftValue("#draft-events", formatEvents(draft.events || []), preserveExisting);
  setDraftValue("#draft-worldbook", formatWorldbook(draft.worldbook || []), preserveExisting);
  setDraftValue("#draft-opening", draft.opening || "", preserveExisting);
}

function readDraftForm(title, type) {
  const fallback = generatedDraft || localDraft(title, type, getValue("#create-outline"));
  const npcs = parseNpcs(getValue("#draft-npcs"));
  const inventory = parseInventory(getValue("#draft-inventory"));
  const events = parseEvents(getValue("#draft-events"));
  return {
    world: {
      setting: getValue("#draft-world") || fallback.world.setting,
      goal: getValue("#draft-goal") || fallback.world.goal,
    },
    protagonist: {
      ...fallback.protagonist,
      profile: getValue("#draft-protagonist") || fallback.protagonist.profile,
      state: getValue("#draft-state") || fallback.protagonist.state,
    },
    npcs: npcs.length ? npcs : fallback.npcs,
    inventory: inventory.length ? inventory : fallback.inventory,
    events: events.length ? events : fallback.events,
    worldbook: parseWorldbook(getValue("#draft-worldbook")),
    opening: getValue("#draft-opening") || fallback.opening,
  };
}

function parseDraft(raw, title, type, outline) {
  const fallback = localDraft(title, type, outline);
  const block = typeof extractFirstJsonObject === "function" ? extractFirstJsonObject(String(raw || "")) : "";
  if (!block) return fallback;
  try {
    const parsed = JSON.parse(block);
    return {
      meta: { ...fallback.meta, ...(parsed.meta || {}) },
      world: { ...fallback.world, ...(parsed.world || {}) },
      protagonist: { ...fallback.protagonist, ...(parsed.protagonist || {}) },
      npcs: Array.isArray(parsed.npcs) && parsed.npcs.length ? parsed.npcs : fallback.npcs,
      inventory: Array.isArray(parsed.inventory) && parsed.inventory.length ? parsed.inventory : fallback.inventory,
      events: Array.isArray(parsed.events) && parsed.events.length ? parsed.events : fallback.events,
      worldbook: Array.isArray(parsed.worldbook) ? parsed.worldbook : fallback.worldbook,
      opening: parsed.opening || fallback.opening,
    };
  } catch {
    return fallback;
  }
}

function formatNpcs(items = []) {
  return items.map((item) => `${item.name || "未命名 NPC"} | ${item.relation || "未知"} | ${item.note || ""}`).join("\n");
}

function parseNpcs(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, relation, note] = line.split("|").map((part) => part.trim());
      return { name: name || "未命名 NPC", relation: relation || "未知", note: note || "" };
    });
}

function formatInventory(items = []) {
  return items.map((item) => `${item.name || "未命名物品"} | ${item.state || ""}`).join("\n");
}

function parseInventory(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, state] = line.split("|").map((part) => part.trim());
      return { name: name || "未命名物品", state: state || "" };
    });
}

function formatEvents(items = []) {
  return items.map((item) => `${item.title || "未命名事件"} | ${item.status || "next"} | ${item.detail || ""}`).join("\n");
}

function parseEvents(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [title, status, detail] = line.split("|").map((part) => part.trim());
      return { title: title || "未命名事件", status: status || (index === 0 ? "active" : "next"), detail: detail || "" };
    });
}

function formatWorldbook(items = []) {
  return items.map((item) => `${item.key || "未命名词条"} | ${item.content || ""}`).join("\n");
}

function parseWorldbook(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split("|").map((part) => part.trim());
      return { key: key || "未命名词条", content: rest.join(" | ") || "" };
    });
}

function mergeWorldbookEntries(existingEntries, incomingEntries) {
  const map = new Map();
  [...(existingEntries || []), ...(incomingEntries || [])].forEach((entry) => {
    const key = String(entry?.key || "").trim();
    const content = String(entry?.content || "").trim();
    if (!key || !content) return;
    map.set(key, content);
  });
  return [...map.entries()].map(([key, content]) => ({ key, content }));
}

function resetCreateWorldbookImportSession() {
  createWorldbookImportSession = { id: createWorldbookImportSession.id + 1, file: null, entries: [], status: "idle", error: "" };
  pendingCreateWorldbookEntries = [];
  if (createWorldbookFile) createWorldbookFile.value = "";
  renderCreateWorldbookImport(null, []);
  updateCreateImportProgress(0, "等待导入", "选择文件后，可以写入下面的故事设定。", false);
}

function beginCreateWorldbookRead(file) {
  createWorldbookImportSession = { id: createWorldbookImportSession.id + 1, file, entries: [], status: "reading", error: "" };
  pendingCreateWorldbookEntries = [];
  renderCreateWorldbookImport(file, []);
  updateCreateImportProgress(8, "正在读取文件", "正在解析当前选择的世界书文件。", true);
  return createWorldbookImportSession.id;
}

function commitCreateWorldbookRead(sessionId, file, entries) {
  if (sessionId !== createWorldbookImportSession.id) return false;
  createWorldbookImportSession = { ...createWorldbookImportSession, file, entries: Array.isArray(entries) ? entries : [], status: "ready", error: "" };
  pendingCreateWorldbookEntries = createWorldbookImportSession.entries;
  renderCreateWorldbookImport(file, createWorldbookImportSession.entries);
  return true;
}

function failCreateWorldbookRead(sessionId, file, error) {
  if (sessionId !== createWorldbookImportSession.id) return false;
  createWorldbookImportSession = { ...createWorldbookImportSession, file, entries: [], status: "error", error: error?.message || "文件读取失败" };
  pendingCreateWorldbookEntries = [];
  renderCreateWorldbookImport(file, []);
  updateCreateImportProgress(100, "导入失败", createWorldbookImportSession.error, true);
  if (createStatus) createStatus.textContent = `导入失败：${createWorldbookImportSession.error}`;
  return true;
}

function getCreateWorldbookEntriesSnapshot() {
  return [...(createWorldbookImportSession.entries?.length ? createWorldbookImportSession.entries : pendingCreateWorldbookEntries)];
}

function renderCreateWorldbookImport(file, entries) {
  if (createWorldbookName) createWorldbookName.textContent = file?.name || "未选择任何文件";
  if (createWorldbookTranslate) createWorldbookTranslate.disabled = !entries.length;
  if (createWorldbookPreview) createWorldbookPreview.hidden = !entries.length;
  if (createWorldbookCount) createWorldbookCount.textContent = entries.length ? `${entries.length} 条` : "等待导入";
  if (createWorldbookPreviewList) {
    createWorldbookPreviewList.innerHTML = entries
      .slice(0, 6)
      .map((entry) => `<div class="worldbook-preview-item"><strong>${escapeHtml(entry.key)}</strong><p>${escapeHtml(entry.content).slice(0, 180)}</p></div>`)
      .join("");
  }
  if (createStatus && entries.length) createStatus.textContent = `已读取 ${entries.length} 条世界书，可写入故事草稿。`;
  if (entries.length) updateCreateImportProgress(18, "已读取文件", `已识别 ${entries.length} 条内容。`, true);
}

function renderStoryWorldbookImport(file, entries) {
  if (storyWorldbookName) storyWorldbookName.textContent = file?.name || "未选择任何文件";
  if (storyWorldbookImport) storyWorldbookImport.disabled = !entries.length;
  if (storyWorldbookPreview) storyWorldbookPreview.hidden = !entries.length;
  if (storyWorldbookCount) storyWorldbookCount.textContent = entries.length ? `${entries.length} 条` : "等待导入";
  if (storyWorldbookPreviewList) {
    storyWorldbookPreviewList.innerHTML = entries
      .slice(0, 6)
      .map((entry) => `<div class="worldbook-preview-item"><strong>${escapeHtml(entry.key)}</strong><p>${escapeHtml(entry.content).slice(0, 180)}</p></div>`)
      .join("");
  }
  if (storyWorldbookStatus) storyWorldbookStatus.textContent = entries.length ? `已读取 ${entries.length} 条世界书，确认无误后可写入当前故事。` : "可导入 JSON / 文本世界书，再继续手动修改。";
}

function applyWorldbookEntriesToDraft(entries, options = {}) {
  const incoming = Array.isArray(entries) ? entries : [];
  if (!incoming.length) return;
  const title = getValue("#create-title") || buildStoryTitleFromImport(pickWorldbookValue(incoming, ["角色名", "姓名", "name", "title"]));
  const type = getValue("#create-type") || inferStoryTypeFromEntries(incoming);
  const draft = normalizeDraftForStoryGame(localDraft(title, type, getValue("#create-outline")), incoming, title, type, getValue("#create-template"));
  hydrateDraftForm(draft, { preserveExisting: options.preserveExisting !== false });
  if (createStatus) createStatus.textContent = `已写入 ${incoming.length} 条导入内容，可继续手动调整。`;
  updateCreateImportProgress(100, "已完成写入", "导入内容已写入故事草稿。", true);
}

function applyWorldbookEntriesToStory(entries) {
  const story = activeStory();
  if (!story) return;
  story.worldbook = mergeWorldbookEntries(story.worldbook, entries);
  setValue("#story-worldbook", formatWorldbook(story.worldbook));
  story.updatedAt = new Date().toISOString();
  saveStories();
  if (storyWorldbookStatus) storyWorldbookStatus.textContent = `已写入 ${entries.length} 条世界书。`;
}

async function translateWorldbookIntoDraft() {
  const entries = getCreateWorldbookEntriesSnapshot();
  if (!entries.length) return;
  applyWorldbookEntriesToDraft(entries, { preserveExisting: true });
}

async function readWorldbookFile(file) {
  const text = await file.text();
  return extractWorldbookEntries(text);
}

function extractWorldbookEntries(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return extractEntriesFromJson(data);
  } catch {
    return raw
      .split(/\n{2,}/)
      .map((block, index) => {
        const lines = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return null;
        const [key, ...rest] = lines.join("\n").split("|").map((part) => part.trim());
        return { key: key || `文本片段 ${index + 1}`, content: rest.join(" | ") || lines.slice(1).join("\n") || lines[0] };
      })
      .filter((entry) => entry?.key && entry?.content);
  }
}

function extractEntriesFromJson(data) {
  if (Array.isArray(data)) return data.map(normalizeImportedEntry).filter(Boolean);
  const candidates = data?.entries || data?.worldbook || data?.data?.entries || data?.character_book?.entries;
  if (Array.isArray(candidates)) return candidates.map(normalizeImportedEntry).filter(Boolean);
  const cardEntries = extractCharacterCardEntries(data);
  return cardEntries.length ? cardEntries : Object.entries(data || {}).map(([key, value]) => normalizeImportedEntry({ key, content: value })).filter(Boolean);
}

function normalizeImportedEntry(entry, index = 0) {
  const key = String(entry?.key || entry?.name || entry?.title || entry?.keys?.[0] || `词条 ${index + 1}`).trim();
  const content = typeof entry?.content === "string"
    ? entry.content
    : typeof entry?.value === "string"
      ? entry.value
      : typeof entry === "string"
        ? entry
        : JSON.stringify(entry?.content || entry?.value || entry || "");
  const cleanContent = String(content || "").trim();
  return key && cleanContent ? { key, content: cleanContent } : null;
}

function extractCharacterCardEntries(data) {
  const card = data?.data || data || {};
  const entries = [];
  const pushEntry = (key, value) => {
    const text = String(value || "").trim();
    if (text) entries.push({ key, content: text });
  };
  pushEntry("角色名", card.name);
  pushEntry("角色简介", card.description || card.desc);
  pushEntry("性格", card.personality);
  pushEntry("世界设定", card.scenario || card.world);
  pushEntry("开场白", card.first_mes || card.first_message || card.opening);
  pushEntry("系统提示", card.system_prompt || card.prompt);
  return entries;
}

function normalizeEntryKey(entry, index) {
  return String(entry?.key || entry?.name || `词条 ${index + 1}`).trim();
}

function pickWorldbookValue(entries, keys) {
  const normalizedKeys = keys.map((key) => String(key).toLowerCase());
  const matched = (entries || []).find((entry) => normalizedKeys.some((key) => String(entry.key || "").toLowerCase().includes(key)));
  return cleanImportedText(matched?.content || "");
}

function filterSupplementalWorldbookEntries(entries) {
  return (entries || []).filter((entry) => entry?.key && entry?.content).slice(0, 30);
}

function buildStoryTitleFromImport(name) {
  const cleanName = cleanImportedText(name).slice(0, 18);
  if (!cleanName || isGenericStoryTitle(cleanName)) return "导入故事档案";
  return `${cleanName}的故事`;
}

function isGenericStoryTitle(value) {
  const text = String(value || "").trim();
  return !text || ["新的故事档案", "导入故事档案"].includes(text);
}

function isGenericStoryType(value) {
  const text = String(value || "").trim();
  return !text || ["自定义故事", "修仙 + 科幻"].includes(text);
}

function isGenericStoryTemplate(value) {
  const text = String(value || "").trim();
  return !text || ["角色卡导入开局", "导入故事开局"].includes(text);
}

function inferStoryTypeFromEntries(entries) {
  const source = `${entries.map((entry) => `${entry.key} ${entry.content}`).join(" ")}`;
  const tags = [];
  if (/(修仙|宗门|灵气|秘境|飞升)/.test(source)) tags.push("修仙");
  if (/(都市|公寓|咖啡|大学|办公室|现代|college|apartment)/i.test(source)) tags.push("都市");
  if (/(悬疑|秘密|调查|失踪|真相|疑云)/.test(source)) tags.push("悬疑");
  if (/(奇幻|王国|魔法|龙|神话)/.test(source)) tags.push("奇幻");
  if (!tags.length) tags.push("自定义故事");
  return tags.join(" / ");
}

function inferStoryTemplateFromEntries(entries) {
  const source = entries.map((entry) => `${entry.key} ${entry.content}`).join(" ");
  if (/(秘密|真相|调查|失踪|疑云)/.test(source)) return "调查开局";
  if (/(家庭|关系|日常|公寓|婚姻)/.test(source)) return "关系开局";
  return "导入故事开局";
}

function buildWorldSettingFromEntries(entries) {
  const scene = pickWorldbookValue(entries, ["世界设定", "背景", "场景", "scenario", "world"]);
  const type = inferStoryTypeFromEntries(entries);
  return scene || `这是一个${type}取向的长期故事。故事会围绕人物关系、当前事件和玩家选择逐步展开。`;
}

function buildGoalFromEntries(entries) {
  const primaryKey = String(entries?.[0]?.key || "当前事件").trim();
  const npcName = pickWorldbookValue(entries, ["角色名", "姓名", "name"]);
  if (npcName) return `围绕“${npcName}”展开第一轮接触，确认关系、处境和核心冲突。`;
  return `围绕“${primaryKey}”展开第一轮探索，并确认当前主线。`;
}

function buildStateFromEntries(entries) {
  const npcName = pickWorldbookValue(entries, ["角色名", "姓名", "name"]);
  if (npcName) return `刚进入与${npcName}相关的故事现场，掌握的信息有限。`;
  return "刚进入故事，掌握的信息有限，正准备做第一次判断。";
}

function normalizeDraftForStoryGame(draft, entries, title, type, template) {
  const npcName = pickWorldbookValue(entries, ["角色名", "姓名", "name"]);
  const normalized = {
    ...draft,
    meta: {
      title: isGenericStoryTitle(title) ? buildStoryTitleFromImport(npcName) : title,
      type: isGenericStoryType(type) ? inferStoryTypeFromEntries(entries) : type,
      template: isGenericStoryTemplate(template) ? inferStoryTemplateFromEntries(entries) : template,
    },
    world: {
      setting: buildWorldSettingFromEntries(entries),
      goal: buildGoalFromEntries(entries),
    },
    protagonist: {
      ...draft.protagonist,
      profile: buildProfileFromEntries(entries, title),
      state: buildStateFromEntries(entries),
    },
    npcs: [],
    inventory: buildInventoryFromEntries(entries),
    events: buildEventsFromEntries(entries, buildGoalFromEntries(entries)),
    worldbook: filterSupplementalWorldbookEntries(entries),
    opening: buildOpeningFromEntries(entries, title, buildGoalFromEntries(entries), draft.opening),
  };
  if (npcName) normalized.npcs.push({ name: npcName, relation: inferImportedNpcRelation(entries), note: buildImportedNpcNote(entries) });
  if (!normalized.npcs.length) normalized.npcs = draft.npcs;
  if (!normalized.inventory.length) normalized.inventory = draft.inventory;
  return normalized;
}

function cleanImportedText(value) {
  return String(value || "")
    .replace(/{{\s*user\s*}}/gi, "主角")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksMostlyEnglish(value) {
  const text = String(value || "");
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return letters > chinese * 2 && letters > 20;
}

function buildProfileFromEntries(entries, title) {
  const npcName = pickWorldbookValue(entries, ["角色名", "姓名", "name"]);
  const profile = pickWorldbookValue(entries, ["角色简介", "简介", "description", "desc"]);
  const personality = pickWorldbookValue(entries, ["性格", "personality"]);
  if (!npcName) return `主角与“${title || "当前故事"}”的核心事件有关。`;
  return `主角正被卷入与${npcName}相关的复杂局面中。${summarizeImportedSentence([profile, personality].filter(Boolean).join(" "))}`;
}

function buildInventoryFromEntries(entries) {
  return selectInventoryEntries(entries).slice(0, 5).map((entry, index) => ({
    name: looksMostlyEnglish(entry.key) ? `线索 ${index + 1}` : entry.key,
    state: "待调查",
  }));
}

function buildWorldbookNotesFromEntries(entries) {
  return filterSupplementalWorldbookEntries(entries);
}

function buildOpeningFromEntries(entries, title, goal, rawOpening = "") {
  const openingSeed = pickWorldbookValue(entries, ["开场白", "初始消息", "first_mes", "first_message"]);
  const displayName = pickWorldbookValue(entries, ["角色名", "姓名", "name"]) || title || "这场故事";
  return `${openingSeed ? `${openingSeed} ` : ""}故事开始了。你已经接近“${displayName}”相关事件的入口。${goal}`;
}

function buildEventsFromEntries(entries, goal = "") {
  const scenario = pickWorldbookValue(entries, ["世界设定", "背景", "场景", "scenario"]);
  const npcName = pickWorldbookValue(entries, ["角色名", "姓名", "name"]);
  return [
    { title: npcName ? `接触${npcName}` : "开场事件", status: "active", detail: summarizeImportedSentence(scenario || goal || "主角进入故事核心场景。") },
    { title: "确认主线", status: "next", detail: goal || "根据第一轮选择确认后续方向。" },
  ];
}

function inferImportedNpcRelation(entries) {
  const source = entries.map((entry) => `${entry.key} ${entry.content}`).join(" ");
  if (/(husband|wife|married|家庭|恋人|日常)/i.test(source)) return "重要关系人";
  if (/(调查|秘密|真相|失踪|疑云)/.test(source)) return "线索人物";
  return "关键人物";
}

function buildImportedNpcNote(entries) {
  const profile = pickWorldbookValue(entries, ["角色简介", "简介", "description", "desc"]);
  const personality = pickWorldbookValue(entries, ["性格", "personality"]);
  return summarizeImportedSentence([profile, personality].filter(Boolean).join(" ")) || "从导入内容中识别出的关键人物。";
}

function summarizeImportedSentence(text) {
  const cleaned = cleanImportedText(text);
  if (!cleaned) return "";
  const sentence = cleaned.split(/[。！？!?]/)[0]?.trim() || cleaned;
  return sentence.slice(0, 120);
}

function selectWorldLoreEntries(entries) {
  return (entries || []).filter((entry) => entry?.content).slice(0, 20);
}

function selectInventoryEntries(entries) {
  return (entries || []).filter((entry) => /(钥匙|记录|地图|手机|照片|信|线索|item|prop|object)/i.test(`${entry.key} ${entry.content}`));
}

function updateCreateImportProgress(percent, stage, detail, visible = true) {
  if (!createImportProgress) return;
  createImportProgress.hidden = !visible;
  if (createImportStage) createImportStage.textContent = stage || "等待导入";
  if (createImportPercent) createImportPercent.textContent = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  if (createImportProgressFill) createImportProgressFill.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  if (createImportDetail) createImportDetail.textContent = detail || "";
}

function setCreateTranslateLoading(isLoading) {
  if (!createWorldbookTranslate) return;
  createWorldbookTranslate.disabled = isLoading || !getCreateWorldbookEntriesSnapshot().length;
  createWorldbookTranslate.textContent = isLoading ? "正在写入..." : "AI 翻译并写入";
}

function setActiveStorySilently(id) {
  if (!id || !stories.some((story) => story.id === id)) return;
  activeStoryId = id;
  localStorage.setItem(storageKeys.activeStoryId, id);
}
