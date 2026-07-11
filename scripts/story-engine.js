function resolveLiveSettings() {
  const nextSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  settings = repairSettingsData({ ...(settings || {}), ...(nextSettings || {}) });
  localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
  return settings;
}

async function callChatApi(story, overrideMessages, options = {}) {
  const liveSettings = resolveLiveSettings();
  const messages = overrideMessages || (story ? buildApiMessages(story) : []);

  if (!messages.length) {
    throw new Error("未生成可发送给模型的消息内容");
  }

  const response = await fetch(buildChatEndpoint(liveSettings.chatApiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${liveSettings.chatApiKey}`,
    },
    body: JSON.stringify({
      model: liveSettings.chatModelName,
      messages,
      stream: false,
      max_tokens: options.maxTokens || responseMaxTokens(liveSettings.responseLength),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);

  if (story && payload.usage) {
    story.usage = story.usage || { cost: 0, tokens: 0 };
    story.usage.tokens += (payload.usage.total_tokens || 0) / 1000;
    saveStories();
  }

  return payload.choices?.[0]?.message?.content?.trim() || "模型没有返回内容。";
}

function buildApiMessages(story) {
  story.compressedState = refreshCompressedStateFromStory(story);
  story.compressedContext = formatCompressedStateText(story.compressedState);
  const systemPrompt = buildSystemPrompt(story);

  return [
    { role: "system", content: systemPrompt },
    ...story.messages.slice(-18).map((message) => ({
      role: message.type === "user" ? "user" : "assistant",
      content: `${message.name}：${message.text}`,
    })),
  ];
}

function buildSystemPrompt(story) {
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const lengthGuide = responseLengthGuide(currentSettings.responseLength || settings.responseLength);
  const presetLines = typeof buildPromptPresetLayer === "function"
    ? buildPromptPresetLayer(story, currentSettings)
    : ["你是一个中文 AI 故事酒馆的旁白和 NPC 调度器。", "你要推动长期故事，但不要替玩家做重大决定。"];
  const inventoryText = story.inventory.map((item) => `${item.name}=${item.state}`).join("；") || "暂无";
  const npcText = story.npcs.map((npc) => `${npc.name}=${npc.relation}，${npc.note}`).join("；") || "暂无";
  const eventText = story.events.map((event) => `${event.title}=${event.detail}`).join("；") || "暂无";
  const worldbookText = story.worldbook.map((entry) => `${entry.key}=${entry.content}`).join("；") || "暂无";

  return [
    ...presetLines,
    "【故事设定】",
    `当前故事：${story.title}`,
    `当前章节：${story.chapter}`,
    `下一章：${story.nextChapter}`,
    `世界观：${story.world.setting}`,
    `当前主线目标：${story.world.goal}`,
    `主角信息：${story.protagonist.profile}`,
    `主角当前状态：${story.protagonist.state}`,
    `能力/气运：${story.protagonist.cultivation}；${story.protagonist.luck}`,
    `物品状态：${inventoryText}`,
    `NPC 信息：${npcText}`,
    `事件状态：${eventText}`,
    `世界书：${worldbookText}`,
    `长期记忆：${story.memory}`,
    `压缩上下文：${story.compressedContext}`,
    `叙事视角：${perspectiveLabel(story.perspective)}`,
    `回复长度：${lengthGuide}`,
    "【输出规则】",
    "每次回复必须直接写在主对话内容里，不要只依赖右侧状态栏。",
    "只返回一个合法 JSON 对象，不要 Markdown，不要代码块，不要额外解释。",
    'JSON 结构：{"narrative":"正文","choices":["选项1","选项2","选项3"],"state_update":{"focus":"可选","tension":"可选","goal":"可选","protagonist_state":"可选","key_npc":"可选","key_item":"可选","event_title":"可选","event_detail":"可选","progress_delta":"可选"}}',
    ...buildNarrativeRuleLines(currentSettings),
    "narrative 只写主要叙事，只保留场景推进和人物反应，不要再拆成场地、人物心态、当前局势这些小标题。",
    "state_update 用来更新故事状态：focus 写当前焦点，tension 写局势变化，goal 写新的短期目标，protagonist_state 写主角当前状态，key_npc/key_item 写本轮最关键的人物或物品，event_title/event_detail 写当前事件名称和描述，progress_delta 写 -5 到 10 的整数。",
    "如果剧情只是继续同一件事，event_title 不要乱改；只有明显进入新阶段、新地点、新目标时，才切换 event_title。",
    "next_hint 用一句话写下一步最可能展开的事件，方便系统生成下一章。",
    "关键选择前停下来等待玩家。",
  ].join("\n");
}

function buildNarrativeRuleLines(currentSettings = {}) {
  const lines = [];

  lines.push(currentSettings.noMajorDecision
    ? "重大决定规则：不要替玩家做关键选择、关系定性、危险行动或不可逆决定；关键节点必须停下来等玩家输入。"
    : "重大决定规则：可以更主动推进场景和 NPC 行动，但仍不得直接替玩家完成核心选择。");

  lines.push(currentSettings.autoSummary
    ? "自动总结规则：每轮尽量在 state_update 中写入可用于压缩的焦点、局势、短期目标、关键人物、关键物品和事件变化。"
    : "自动总结规则：保持 state_update 简短，只记录确实发生变化的状态，不强行总结。");

  if (currentSettings.nextStep) {
    lines.push("下一步建议：choices 必须正好 3 项，每项都要能直接点击执行，不能省略，不能返回空数组。");
    lines.push("下一步建议必须围绕本轮正文刚刚出现的关键信息推进，不能复述系统提示、上下文压缩提示或泛泛而谈。");
    lines.push("三个选项要彼此差异明显，不要套固定模板，不要总是使用继续推进、观察、围绕、核对这类空泛措辞。");
    lines.push("只允许把选项写进 JSON 的 choices 字段，不要在 narrative 正文里再重复写选项1/2/3、可选行动或下一步行动推荐。");
  } else {
    lines.push("下一步建议：不要强制输出 choices；只有当前剧情自然需要给玩家明确分支时，才返回 choices，否则返回空数组。");
    lines.push("如果返回 choices，只允许写进 JSON 的 choices 字段，不要在 narrative 正文里写选项1/2/3、可选行动或下一步行动推荐。");
  }

  lines.push("正文必须自然分段，段落之间空一行；每段只写 1-3 句，不要把整轮回复挤成一个大段落。");
  lines.push("如果选择了较长或沉浸长度，优先增加有效剧情、动作、对话和心理变化，不要用空泛总结凑字数。");

  return lines;
}

function openContextPreview() {
  const story = activeStory();
  if (!story || !contextPreview) return;
  contextPreview.textContent = formatContextPreview(story);
  showDialog(contextDialog);
}

function compressContext() {
  const story = activeStory();
  if (!story) return;

  const beforeStats = calculateContextStats(story);
  const targetPercent = 45;
  const minRecentMessages = Math.min(4, story.messages.length);
  const maxRecentMessages = Math.min(12, story.messages.length);
  let keepCount = maxRecentMessages;

  for (let count = maxRecentMessages; count >= minRecentMessages; count -= 2) {
    const stats = calculateContextStats(story, story.messages.slice(-count));
    keepCount = count;
    if (stats.percent <= targetPercent || count === minRecentMessages) break;
  }

  const olderMessages = story.messages.slice(0, -keepCount);
  if (!olderMessages.length) {
    story.compressedState = buildCompressedContextState(story, []);
  } else {
    story.compressedState = buildCompressedContextState(story, olderMessages);
    story.messages = story.messages.slice(-keepCount);
  }

  story.compressedContext = formatCompressedStateText(story.compressedState);
  const afterStats = calculateContextStats(story);
  story.contextBudget = {
    ...(story.contextBudget || {}),
    percent: afterStats.percent,
    lastCompression: {
      beforePercent: beforeStats.percent,
      afterPercent: afterStats.percent,
      compressedCount: olderMessages.length,
      keptMessages: story.messages.length,
      targetPercent,
      at: new Date().toISOString(),
    },
  };
  story.updatedAt = new Date().toISOString();
  saveStories();
  addMessage("系统", `上下文已压缩：${olderMessages.length} 条较早消息已写入摘要，估算占用 ${beforeStats.percent}% → ${afterStats.percent}%，保留最近 ${story.messages.length} 条消息。`, "npc");
}

function buildCompressedContextState(story, olderMessages) {
  const baseState = refreshCompressedStateFromStory(story);
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;

  if (!olderMessages.length) {
    return normalizeCompressedState({
      ...baseState,
      status: "尚未执行压缩",
      compressedCount: 0,
      currentScene: baseState.currentScene || activeSceneFromStory(story),
      playerIntent: baseState.playerIntent || "暂无明显倾向",
      unresolved: baseState.unresolved || "暂无",
    });
  }

  if (!currentSettings.autoSummary) {
    const latestOlderMessage = olderMessages[olderMessages.length - 1];
    return normalizeCompressedState({
      ...baseState,
      status: "已执行轻量压缩",
      compressedCount: olderMessages.length,
      currentScene: summarizeCompressionMessage(latestOlderMessage?.text || activeSceneFromStory(story)) || baseState.currentScene,
      playerIntent: baseState.playerIntent || "自动总结关闭，未深度推断玩家意图",
      unresolved: baseState.unresolved || "自动总结关闭，仅保留轻量摘要",
    });
  }

  const recentOlderMessages = olderMessages.slice(-12);
  const npcMessages = recentOlderMessages.filter((message) => message.type === "npc");
  const userMessages = recentOlderMessages.filter((message) => message.type === "user");
  const latestNpc = npcMessages[npcMessages.length - 1];
  const latestUser = userMessages[userMessages.length - 1];
  const activeEvent = story.events.find((event) => event.status === "active");
  const completedEvents = story.events.filter((event) => event.status === "done").map((event) => event.title);
  const nextEvent = story.events.find((event) => event.status === "next");
  const keyNpcSummary = story.npcs.slice(0, 3).map((npc) => [npc.name, npc.relation, npc.note].filter(Boolean).join(" | ")).filter(Boolean);
  const keyItemSummary = story.inventory.slice(0, 3).map((item) => [item.name, item.state].filter(Boolean).join(" | ")).filter(Boolean);

  return normalizeCompressedState({
    ...baseState,
    status: "已执行压缩",
    compressedCount: olderMessages.length,
    mainGoal: story.world.goal || baseState.mainGoal,
    activeEvent: activeEvent?.title || baseState.activeEvent,
    completedNodes: completedEvents,
    pendingNode: nextEvent?.title || baseState.pendingNode,
    currentScene: summarizeCompressionMessage(latestNpc?.text || activeEvent?.detail || story.world.goal) || baseState.currentScene,
    playerIntent: summarizeCompressionMessage(latestUser?.text || "暂无明显倾向") || baseState.playerIntent,
    unresolved: detectCompressionOpenQuestion(latestNpc?.text || latestUser?.text || story.world.goal) || baseState.unresolved,
    keyNpcs: keyNpcSummary,
    keyItems: keyItemSummary,
    longTermMemory: story.memory || baseState.longTermMemory,
  });
}

function activeSceneFromStory(story) {
  const activeEvent = story.events.find((event) => event.status === "active");
  return summarizeCompressionMessage(activeEvent?.detail || story.world.goal || "");
}

function summarizeCompressionMessage(text) {
  const cleaned = stripReplyPrefixes(String(text || "")).replace(/\s+/g, " ").trim();
  if (!cleaned) return "暂无";
  const sentence = cleaned.split(/[。！？!?]/)[0]?.trim() || cleaned;
  return sentence.slice(0, 60);
}

function detectCompressionOpenQuestion(text) {
  const cleaned = stripReplyPrefixes(String(text || "")).replace(/\s+/g, " ").trim();
  if (!cleaned) return "暂无";

  const quoteMatch = [...cleaned.matchAll(/[“"](.{2,50}?[？?])[”"]/g)].map((match) => match[1].trim());
  if (quoteMatch.length) return quoteMatch[quoteMatch.length - 1];

  const questionLine = cleaned
    .split(/[。！!\n]/)
    .map((part) => part.trim())
    .find((part) => /[？?]/.test(part));

  if (questionLine) return questionLine;
  return `${summarizeCompressionMessage(cleaned)} 仍需验证`;
}

function normalizeAssistantReply(rawText) {
  const story = activeStory();
  const payload = parseAssistantPayload(rawText);
  const useStructuredChoicesOnly = hasRealApiSettings();
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const shouldShowChoices = Boolean(currentSettings.nextStep);
  let text = payload.narrative;
  const sourceForFallback = payload.narrative || String(rawText || "").trim();
  const choices = [];
  const actionBlock = text.match(/(?:^|\n)(?:可选行动|下一步行动推荐)\s*([\s\S]*)$/);

  if (shouldShowChoices) {
    payload.choices.forEach((choice) => {
      if (choice && !choices.includes(choice)) choices.push(choice);
    });
  }

  if (shouldShowChoices && !useStructuredChoicesOnly && actionBlock) {
    choices.push(...parseChoiceLines(actionBlock[1]));
    text = text.slice(0, actionBlock.index).trim();
  } else if (shouldShowChoices && !useStructuredChoicesOnly) {
    const lines = text.split(/\n/);
    const trailingChoices = [];
    while (lines.length) {
      const parsed = parseChoiceLine(lines[lines.length - 1]);
      if (!parsed) break;
      trailingChoices.unshift(parsed);
      lines.pop();
    }
    if (trailingChoices.length >= 2) {
      choices.push(...trailingChoices);
      text = lines.join("\n").trim();
    }
  }

  if (shouldShowChoices && choices.length < 3 && !useStructuredChoicesOnly) {
    const fallbackSource = text || payload.narrative || sourceForFallback;
    buildDefaultChoices(story, fallbackSource).forEach((choice) => {
      if (choices.length < 3 && !choices.includes(choice)) choices.push(choice);
    });
  }

  const finalChoices = shouldShowChoices ? choices.slice(0, 3) : [];

  return {
    text: ensureNarrativeStructure(text || sourceForFallback),
    choices: finalChoices,
    stateUpdate: normalizeStateUpdate(payload.stateUpdate, story, text || sourceForFallback, finalChoices),
  };
}

async function generateChoicesViaApi(story, narrativeText) {
  if (!story || !hasRealApiSettings()) return [];

  const activeEvent = story.events.find((event) => event.status === "active");
  const recentMessages = story.messages
    .slice(-6)
    .map((message) => `${message.type === "user" ? "用户" : "旁白"}：${stripReplyPrefixes(message.text || "")}`)
    .join("\n");

  const messages = [
    {
      role: "system",
      content: [
        "你是中文互动故事的行动建议生成器。",
        "只返回一个合法 JSON 对象，不要 Markdown，不要解释。",
        'JSON 结构：{"choices":["选项1","选项2","选项3"]}',
        "必须正好返回 3 个 choices。",
        "每个 choice 都必须是玩家下一步可以直接点击执行的行动句。",
        "三个 choice 必须彼此差异明显，并且紧贴刚刚这段剧情。",
        "不要写空泛模板句，不要写“继续推进、观察、围绕、核对”这类套话，除非剧情真的需要。",
        "不要复述系统提示，不要总结剧情，只生成下一步行动。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `故事：${story.title}`,
        `当前事件：${activeEvent?.title || story.chapter || "当前剧情"}`,
        `主线目标：${story.world.goal}`,
        `主角状态：${story.protagonist.state}`,
        "",
        "最近上下文：",
        recentMessages || "暂无",
        "",
        "刚刚生成的正文：",
        stripReplyPrefixes(narrativeText || ""),
        "",
        "请只补全 3 个下一步行动。",
      ].join("\n"),
    },
  ];

  const raw = await callChatApi(null, messages, { maxTokens: 500 });
  const parsed = parseAssistantJsonPayload(raw) || safeJsonParse(String(raw || "").trim());
  const choices = normalizeChoiceEntries(parsed?.choices || parsed?.actions || []);
  return choices.slice(0, 3);
}

function parseAssistantPayload(rawText) {
  const raw = String(rawText || "").trim();
  const jsonPayload = parseAssistantJsonPayload(raw);

  if (jsonPayload) {
    return {
      narrative: String(jsonPayload.narrative || jsonPayload.text || jsonPayload.body || "").trim(),
      choices: normalizeChoiceEntries(jsonPayload.choices || jsonPayload.actions || []),
      stateUpdate: jsonPayload.state_update || jsonPayload.stateUpdate || {},
    };
  }

  return { narrative: raw, choices: [], stateUpdate: {} };
}

function parseAssistantJsonPayload(raw) {
  const cleaned = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const direct = safeJsonParse(cleaned);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;

  const block = extractFirstJsonObject(cleaned);
  if (!block) return null;
  const parsed = safeJsonParse(block);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(value) {
  const source = String(value || "");
  const start = source.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return "";
}

function normalizeChoiceEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (!entry || typeof entry !== "object") return "";
      const text = String(entry.text || entry.content || entry.label || "").trim();
      return text;
    })
    .map(normalizeChoiceLabel)
    .filter(isStoryChoiceText)
    .filter(Boolean);
}

function normalizeChoiceLabel(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\-*•+\s]+/, "")
    .replace(/^选项\s*[一二三四五六七八九十\dA-Da-d]+[：:.、)]\s*/, "")
    .trim();
}

function extractChoiceActionText(value) {
  return normalizeChoiceLabel(value).replace(/^(?:追问|调查|观察|转场|行动|建议|选项)[：:、\s]+/u, "").trim();
}

function isStoryChoiceText(value) {
  const text = normalizeChoiceLabel(value);
  if (!text) return false;
  return !/(上下文已压缩|记忆摘要|结构化状态|系统提示|API|JSON|模型返回)/.test(text);
}

function isUtilityMessageText(value) {
  const text = stripReplyPrefixes(String(value || "")).replace(/\s+/g, " ").trim();
  if (!text) return true;
  return /(上下文已压缩|记忆摘要|结构化状态|系统提示|API|JSON|已加入生图队列|压缩状态)/.test(text);
}

function ensureNarrativeStructure(text) {
  const value = stripReplyPrefixes(String(text || ""))
    .replace(/^\s*(?:【正文】|\[正文\]|正文[:：]?|旁白[:：]?)+\s*/u, "")
    .replace(/\r/g, "")
    .trim();

  if (!value) return "";

  const normalized = value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (normalized.length >= 2) {
    return normalized.join("\n\n");
  }

  const sentences = value
    .replace(/\n+/g, " ")
    .split(/(?<=[。！？!?”」])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return value;

  const paragraphs = [];
  let current = [];

  sentences.forEach((sentence) => {
    current.push(sentence);
    const joined = current.join("");
    if (current.length >= 2 || joined.length >= 90) {
      paragraphs.push(joined);
      current = [];
    }
  });

  if (current.length) paragraphs.push(current.join(""));
  return paragraphs.join("\n\n");
}

function parseChoiceLines(text) {
  return String(text || "")
    .split(/\n/)
    .map(parseChoiceLine)
    .map(normalizeChoiceLabel)
    .filter(isStoryChoiceText)
    .filter(Boolean);
}

function parseChoiceLine(line) {
  const source = String(line || "").trim();
  const bracket = source.match(/^[【\[](?:选择|选项)?\s*([一二三四五六七八九十\dA-Da-d]+)[】\]]\s*(.+)$/);
  if (bracket) return bracket[2].trim();
  const numbered = source.match(/^(?:[-*]\s*)?(?:选项\s*)?(?:[一二三四五六七八九十\dA-Da-d])[.)、：:]\s*(.+)$/);
  if (numbered) return numbered[1].replace(/^[“"']+|[”"']+$/g, "").trim();
  return "";
}

function buildDefaultChoices(story, sourceText = "") {
  const activeEvent = story.events.find((event) => event.status === "active");
  const nextEvent = story.events.find((event) => event.status === "next");
  const latestAssistant = [...story.messages].reverse().find((message) => message.type === "npc" && message.name !== "系统" && !isUtilityMessageText(message.text));
  const latestUser = [...story.messages].reverse().find((message) => message.type === "user");
  const narrativeText = extractNarrativeChoiceSource(sourceText || latestAssistant?.text || activeEvent?.detail || story.world.goal);
  const context = buildActionContext(story, {
    activeEvent,
    nextEvent,
    narrativeText,
    dialogueQuestion: extractDialogueQuestion(narrativeText),
    userIntent: summarizeActionFocus(latestUser?.text || ""),
    mentionedNpc: story.npcs.find((npc) => narrativeText.includes(npc.name))?.name || story.npcs[0]?.name || "",
    mentionedItem: story.inventory.find((item) => narrativeText.includes(item.name))?.name || story.inventory[0]?.name || "",
    narrativeSignals: extractNarrativeSignals(narrativeText, story),
    compressedState: refreshCompressedStateFromStory(story),
  });

  const candidates = [
    ...buildStateDrivenChoices(context),
    context.keyNpc ? `直接向${context.keyNpc}追问最关键的问题。` : "",
    context.keyItem ? `先检查${context.keyItem}，确认它和眼前线索的关系。` : "",
    context.unresolved ? `优先确认“${context.unresolved}”这件事。` : "",
  ].filter(Boolean);

  return [...new Set(candidates)].slice(0, 3);
}

function buildActionContext(story, input) {
  return {
    story,
    activeEvent: input.activeEvent,
    nextEvent: input.nextEvent,
    currentFocus: story.runtimeState?.focus || summarizeActionFocus(input.narrativeText || input.activeEvent?.detail || story.world.goal),
    unresolved: input.compressedState.unresolved || "",
    playerIntent: input.userIntent || input.compressedState.playerIntent || "",
    nextHint: story.runtimeState?.lastNextHint || "",
    pendingNode: input.compressedState.pendingNode || input.nextEvent?.title || "",
    keyNpc: input.mentionedNpc || input.compressedState.keyNpcs?.[0]?.split(" | ")[0] || "",
    keyItem: input.mentionedItem || input.compressedState.keyItems?.[0]?.split(" | ")[0] || "",
    risk: input.narrativeSignals.risk || "",
    place: input.narrativeSignals.place || "",
    emotion: input.narrativeSignals.emotion || "",
    motion: input.narrativeSignals.motion || "",
    dialogueQuestion: input.dialogueQuestion || "",
  };
}

function buildStateDrivenChoices(context) {
  return [
    context.unresolved ? `先把“${context.unresolved}”问清楚。` : "",
    context.currentFocus ? `围绕“${context.currentFocus}”继续推进。` : "",
    context.keyNpc && context.dialogueQuestion ? `盯住${context.keyNpc}的反应，继续追问“${context.dialogueQuestion}”。` : "",
    context.keyItem && context.currentFocus ? `重新核对${context.keyItem}和“${context.currentFocus}”之间的联系。` : "",
    context.pendingNode ? `顺着当前推进往下走，为“${context.pendingNode}”做准备。` : "",
    context.nextHint ? `先推动“${context.nextHint}”落地。` : "",
  ].filter(Boolean);
}

function summarizeActionFocus(text) {
  const cleaned = stripReplyPrefixes(String(text || "")).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const sentence = cleaned.split(/[。！？!?]/)[0]?.trim() || cleaned;
  return sentence.slice(0, 24);
}

function extractNarrativeChoiceSource(text) {
  const cleaned = stripReplyPrefixes(String(text || ""))
    .replace(/(?:可选行动|下一步行动推荐)[\s\S]*$/m, "")
    .replace(/上下文已压缩[^。！？!?\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = cleaned.split(/(?<=[。！？!?])/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.slice(-2).join(" ");
}

function extractDialogueQuestion(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";

  const quoted = [...cleaned.matchAll(/[“"](.{2,40}?[？?])[”"]/g)].map((match) => match[1].trim());
  if (quoted.length) return quoted[quoted.length - 1].replace(/[？?]$/, "");

  const questions = cleaned.split(/[。！!\n]/).map((part) => part.trim()).filter((part) => /[？?]/.test(part));
  return questions.length ? questions[questions.length - 1].replace(/[？?]$/, "") : "";
}

function extractNarrativeSignals(text, story) {
  const cleaned = stripReplyPrefixes(String(text || "")).replace(/\s+/g, " ").trim();
  const source = cleaned || `${story.world.goal} ${story.events.map((event) => event.detail).join(" ")}`;
  const firstSentence = source.split(/[。！？!?]/)[0]?.trim() || "";
  const placeMatch = source.match(/(?:在|进入|来到|沿着|回到|靠近)([^，。！？!?]{2,16})/);
  const emotionMatch = source.match(/(慌乱|迟疑|紧张|沉默|愤怒|恐惧|惊讶|警惕|动摇|失控)/);
  const riskMatch = source.match(/(异常|危险|裂缝|监控|脚步声|敲门声|陌生人|失踪|录音|追踪|钥匙|伤口|停电|封锁)/);
  const motionMatch = firstSentence.match(/(转身|靠近|后退|停下|开门|关门|伸手|掏出|拿起|跟上|躲开|观察|询问|逼近|离开)/);

  return {
    place: placeMatch?.[1]?.trim() || "",
    emotion: emotionMatch?.[1] || "",
    risk: riskMatch?.[1] || "",
    motion: motionMatch?.[1] || "",
  };
}

function getRecentChoiceHistory(story) {
  return [...story.messages]
    .reverse()
    .filter((message) => message.type === "npc" && Array.isArray(message.choices) && message.choices.length)
    .slice(0, 2)
    .flatMap((message) => message.choices)
    .map((choice) => String(choice || "").trim())
    .filter(Boolean);
}

function buildMockReply() {
  const story = activeStory();
  const lastUserMessage = [...story.messages].reverse().find((message) => message.type === "user");
  const cleanLast = lastUserMessage ? lastUserMessage.text.replace(/^\[[^\]]+\]\s*/, "") : "";
  const hook = cleanLast ? `你刚才选择了“${cleanLast}”。` : "";
  const activeEvent = story.events.find((event) => event.status === "active");

  return JSON.stringify({
    narrative: `${hook}${activeEvent?.detail || story.world.goal}。你重新梳理眼前的信息：一边是已经出现的异常，一边是还没有被验证的猜测。空气里有某种快要断裂的安静，仿佛只要你开口或伸手，整件事就会朝一个更明确的方向倾斜。`,
    choices: [
      "先观察现场，找出最不自然的细节。",
      "主动开口，向关键人物确认隐藏信息。",
      "整理已有线索，选择更稳妥的推进路线。",
    ],
    state_update: {
      focus: activeEvent?.title || story.title,
      tension: "信息正在收束，但关键真相仍未确认。",
      goal: activeEvent?.detail || story.world.goal,
      protagonist_state: story.protagonist.state,
      key_npc: story.npcs[0]?.name || "",
      key_item: story.inventory[0]?.name || "",
      event_title: activeEvent?.title || story.title,
      event_detail: activeEvent?.detail || story.world.goal,
      progress_delta: 3,
    },
  });
}

function normalizeStateUpdate(rawUpdate, story, narrativeText, choices) {
  const update = rawUpdate && typeof rawUpdate === "object" ? rawUpdate : {};
  const fallback = buildFallbackStateUpdate(story, narrativeText, choices);

  return {
    focus: cleanStateText(update.focus) || fallback.focus,
    tension: cleanStateText(update.tension) || fallback.tension,
    goal: cleanStateText(update.goal || update.current_goal) || fallback.goal,
    protagonistState: cleanStateText(update.protagonist_state || update.protagonistState || update.state) || fallback.protagonistState,
    keyNpc: cleanStateText(update.key_npc || update.keyNpc || update.npc) || fallback.keyNpc,
    keyItem: cleanStateText(update.key_item || update.keyItem || update.item) || fallback.keyItem,
    eventTitle: cleanStateText(update.event_title || update.eventTitle || update.event) || fallback.eventTitle,
    eventDetail: cleanStateText(update.event_detail || update.eventDetail || update.detail) || fallback.eventDetail,
    progressDelta: normalizeProgressDelta(update.progress_delta ?? update.progressDelta, fallback.progressDelta),
    nextHint: cleanStateText(update.next_hint || update.nextHint) || fallback.nextHint,
    lastChoices: Array.isArray(choices) ? choices.slice(0, 3) : [],
    lastAppliedAt: new Date().toISOString(),
    lastRawNarrative: summarizeStoryEventDetail(narrativeText),
  };
}

function buildFallbackStateUpdate(story, narrativeText, choices) {
  const activeEvent = story.events.find((event) => event.status === "active");
  return {
    focus: summarizeActionFocus(narrativeText || activeEvent?.detail || story.world.goal),
    tension: summarizeStoryEventDetail(narrativeText || activeEvent?.detail || "局势仍在推进中。"),
    goal: story.world.goal,
    protagonistState: story.protagonist.state,
    keyNpc: story.npcs[0]?.name || "",
    keyItem: story.inventory[0]?.name || "",
    eventTitle: activeEvent?.title || story.title,
    eventDetail: activeEvent?.detail || story.world.goal,
    progressDelta: 2,
    nextHint: Array.isArray(choices) ? choices.find(Boolean) || "" : "",
  };
}

function cleanStateText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^【?[^】\]]+[】\]]\s*/g, "")
    .trim();
}

function normalizeProgressDelta(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(-5, Math.min(10, Math.round(parsed)));
}

function summarizeStoryEventDetail(text) {
  const cleaned = stripReplyPrefixes(String(text || "")).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[。！？!?])/).map((part) => part.trim()).filter(Boolean);
  return (sentences.slice(-2).join("") || cleaned).slice(0, 120);
}

function calculateContextPercent(story) {
  return calculateContextStats(story).percent;
}

function calculateContextStats(story, messageOverride) {
  const messages = [
    { role: "system", content: buildSystemPrompt(story) },
    ...(messageOverride || story.messages || []).slice(-18).map((message) => ({
      role: message.type === "user" ? "user" : "assistant",
      content: `${message.name}：${message.text}`,
    })),
  ];
  const approxChars = JSON.stringify(messages).length;
  const estimatedTokens = Math.max(1, Math.round(approxChars / 1.8));
  const maxTokens = Number(story.contextBudget?.maxTokens || 32000);
  const percent = Math.min(100, Math.max(1, Math.round((estimatedTokens / maxTokens) * 100)));
  const status = percent > 90 ? "danger" : percent >= 70 ? "warn" : "normal";
  return { messages, approxChars, estimatedTokens, maxTokens, percent, status };
}

function formatContextPreview(story) {
  const apiMessages = buildApiMessages(story);
  const contextStats = calculateContextStats(story);
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const runtimeState = story.runtimeState || {};
  const runtimeUpdate = runtimeState.lastStateUpdate || {};
  const compressedState = refreshCompressedStateFromStory(story);
  const lastCompression = story.contextBudget?.lastCompression;

  const sections = [
    `【系统提示词】\n${buildSystemPrompt(story)}`,
    `【Prompt 模式】\n客户端模式：${isMatureModeEnabled(story) ? "成熟 / 显式成人向" : "普通 / 压制直白成人描写"}\n不替玩家重大决定：${currentSettings.noMajorDecision ? "开启" : "关闭"}\n自动总结：${currentSettings.autoSummary ? "开启" : "关闭"}\n下一步建议：${currentSettings.nextStep ? "开启" : "关闭"}\n回复长度：${currentSettings.responseLength || "long"}`,
    `【上下文估算】\n估算字符：${contextStats.approxChars}\n估算 Token：${contextStats.estimatedTokens}\n窗口上限：${contextStats.maxTokens}\n估算占用：${contextStats.percent}%\n最近压缩：${lastCompression ? `${lastCompression.beforePercent}% → ${lastCompression.afterPercent}%，压缩 ${lastCompression.compressedCount} 条，保留 ${lastCompression.keptMessages} 条` : "暂无"}`,
    `【故事设定】\n世界观：${story.world.setting}\n主线目标：${story.world.goal}`,
    `【主角】\n简介：${story.protagonist.profile}\n状态：${story.protagonist.state}\n能力/气运：${story.protagonist.cultivation} / ${story.protagonist.luck}`,
    `【NPC】\n${story.npcs.length ? story.npcs.map((npc) => `${npc.name} | ${npc.relation} | ${npc.note}`).join("\n") : "暂无"}`,
    `【物品】\n${story.inventory.length ? story.inventory.map((item) => `${item.name} | ${item.state}`).join("\n") : "暂无"}`,
    `【事件】\n${story.events.length ? story.events.map((event) => `${event.title} | ${event.status} | ${event.detail}`).join("\n") : "暂无"}`,
    `【运行时状态】\n最近焦点：${runtimeState.focus || "暂无"}\n局势变化：${runtimeState.tension || "暂无"}\n事件推进：${runtimeState.lastEventTransition || "暂无"}\n下一步提示：${runtimeState.lastNextHint || "暂无"}`,
    `【最近一次 state_update】\n${Object.keys(runtimeUpdate).length ? JSON.stringify(runtimeUpdate, null, 2) : "暂无"}`,
    `【世界书】\n${story.worldbook.length ? story.worldbook.map((entry) => `${entry.key} | ${entry.content}`).join("\n") : "暂无"}`,
    `【长期记忆】\n${story.memory || "暂无"}`,
    `【压缩上下文】\n${formatCompressedStateText(compressedState)}`,
    `【最近消息】\n${story.messages.slice(-18).map((message) => `${message.type === "user" ? "用户" : "旁白"} | ${message.name}：${message.text}`).join("\n\n") || "暂无"}`,
    `【最终发送 messages】\n${JSON.stringify(apiMessages, null, 2)}`,
  ];

  return sections.join("\n\n");
}

function hasRealApiSettings() {
  const currentSettings = typeof readSettingsForm === "function" ? readSettingsForm() : settings;
  const key = currentSettings?.chatApiKey || "";
  return Boolean(currentSettings?.chatApiUrl && currentSettings?.chatModelName && key && !/^sk-0+$/.test(key));
}

function buildChatEndpoint(apiUrl) {
  const url = String(apiUrl || "").replace(/\/$/, "");
  if (url.endsWith("/chat/completions")) return url;
  return `${url}/chat/completions`;
}
