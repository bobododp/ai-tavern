function renderAll() {
  renderChrome();
  renderHeader();
  renderStoryBoard();
  renderArchive();
  renderGallery();
  renderMessages();
  renderUsage();
  renderContextMeter();
  renderSystems();
  renderInputMode();
  renderPerspective();
}

function iconSvg(name) {
  const icons = {
    chevronLeft:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"></path></svg>',
    chevronRight:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg>',
    plus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
    sun:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.8v2.4"></path><path d="M12 18.8v2.4"></path><path d="M4.8 4.8l1.7 1.7"></path><path d="M17.5 17.5l1.7 1.7"></path><path d="M2.8 12h2.4"></path><path d="M18.8 12h2.4"></path><path d="M4.8 19.2l1.7-1.7"></path><path d="M17.5 6.5l1.7-1.7"></path></svg>',
    moon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18.4 15.2A8 8 0 0 1 8.8 5.6a8 8 0 1 0 9.6 9.6z"></path></svg>',
  };
  return icons[name] || "";
}

function renderChrome() {
  const collapsed = document.body.classList.contains("sidebar-collapsed");
  const isLight = document.body.classList.contains("light-theme");

  if (sidebarToggle) {
    sidebarToggle.innerHTML = `<span class="button-icon" aria-hidden="true">${iconSvg(collapsed ? "chevronRight" : "chevronLeft")}</span>`;
    const label = collapsed ? "展开侧边栏" : "收起侧边栏";
    sidebarToggle.setAttribute("aria-label", label);
    sidebarToggle.setAttribute("title", label);
  }

  if (sidebarCreateButton) {
    sidebarCreateButton.innerHTML = `<span class="action-icon" aria-hidden="true">${iconSvg("plus")}</span><span class="action-label">创建故事</span>`;
  }

  if (themeToggle) {
    const nextLabel = isLight ? "暗色" : "亮色";
    const themeIcon = isLight ? "moon" : "sun";
    themeToggle.innerHTML = `<span class="action-icon" aria-hidden="true">${iconSvg(themeIcon)}</span><span class="action-label">${nextLabel}</span>`;
    themeToggle.setAttribute("aria-label", `切换到${nextLabel}`);
    themeToggle.setAttribute("title", `切换到${nextLabel}`);
  }
}

function renderHeader() {
  const story = activeStory();
  if (!story) return;

  document.title = `AI 酒馆 - ${story.title || "未命名故事"}`;

  const eyebrow = document.querySelector(".chat-title .eyebrow");
  if (eyebrow) eyebrow.textContent = story.chapter || "当前故事";

  const title = document.querySelector(".chat-title h3");
  if (title) title.textContent = story.title || "未命名故事";

  const compactMeta = document.querySelector(".compact-meta");
  if (!compactMeta) return;
  compactMeta.innerHTML = `
    <span>${escapeHtml(story.chapter || "当前章节")}</span>
    <span>下一章：${escapeHtml(story.nextChapter || "待展开")}</span>
    <span>进度 ${Number(story.progress || 0)}%</span>
    <span id="save-status">已保存</span>
  `;
}

function renderStoryBoard() {
  if (!storyBoard) return;
  const list = sortedStoriesByRecent();
  storyBoard.innerHTML = list.length
    ? list.map(renderStoryCard).join("")
    : '<article class="empty-state">还没有故事，先创建一个新的故事档案。</article>';
}

function renderArchive() {
  if (!archiveGrid) return;
  const list = sortedStoriesByRecent();
  archiveGrid.innerHTML = list.length
    ? list.map(renderStoryCard).join("")
    : '<article class="empty-state">暂无历史故事。</article>';
}

function renderGallery() {
  if (!galleryGrid) return;
  const story = activeStory();
  if (!story) {
    galleryGrid.innerHTML = "";
    return;
  }

  const images = Array.isArray(story.images)
    ? [...story.images].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    : [];

  galleryGrid.innerHTML = images.length
    ? images.map((image) => renderImageCard(story, image)).join("")
    : `
      <article class="image-card empty gallery-empty">
        <div>+</div>
        <h3>还没有画面</h3>
        <p>可以从主页、观看输入或这里生成当前关键场景。</p>
      </article>
    `;
}

function renderImageCard(story, image) {
  const statusMap = {
    suggested: "画面建议，等待生成",
    pending: image.taskId ? image.error || "绘图中，等待返回图片" : image.error || "正在生成",
    done: "已生成",
    error: image.error || "生成失败",
  };
  const actionLabel =
    image.status === "done" ? "重新生成" :
    image.status === "error" ? "重试" :
    image.status === "suggested" ? "立即生成" :
    image.status === "pending" && image.taskId ? "继续等待" : "";
  const actionType = image.status === "pending" && image.taskId ? "check" : "generate";
  const visualClass = image.url ? "image-card-media generated" : image.status === "error" ? "image-card-media empty" : "image-card-media star";
  const promptSummary = escapeHtml((image.prompt || "").replace(/\s+/g, " ").slice(0, 120) || "等待生成提示词");
  const pendingProgress = image.status === "pending" && image.taskId
    ? `<div class="image-card-progress" aria-label="绘图中"><span></span></div>`
    : "";
  const extraActions = image.url
    ? `
      <button class="secondary-button small" type="button" data-image-action="preview" data-image-id="${escapeHtml(image.id)}">查看大图</button>
      <button class="secondary-button small" type="button" data-image-action="open-folder" data-image-id="${escapeHtml(image.id)}">${escapeHtml(imageFolderActionLabel(image))}</button>
      <button class="secondary-button small danger-button" type="button" data-image-action="delete" data-image-id="${escapeHtml(image.id)}">删除</button>
    `
    : image.status !== "pending"
      ? `<button class="secondary-button small danger-button" type="button" data-image-action="delete" data-image-id="${escapeHtml(image.id)}">删除</button>`
      : "";

  return `
    <article class="image-card ${image.url ? "generated" : image.status === "error" ? "empty" : "star"}" data-image-id="${escapeHtml(image.id)}">
      <button class="${visualClass}" type="button" data-image-action="${image.url ? "preview" : ""}" data-image-id="${escapeHtml(image.id)}">
        ${image.url
          ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(`${story.title} ${image.purpose}`)}" />`
          : `<span>${escapeHtml(image.status === "pending" ? "生成中" : image.status === "error" ? "失败" : image.purpose)}</span>`}
      </button>
      <h3>${escapeHtml(`${story.title || "当前故事"} · ${image.purpose || "画面"}`)}</h3>
      <p class="image-card-meta">${escapeHtml(statusMap[image.status] || "等待生成")}</p>
      ${pendingProgress}
      <p class="image-card-prompt">${promptSummary}</p>
      <div class="image-card-actions">
        ${actionLabel ? `<button class="secondary-button small" type="button" data-image-action="${actionType}" data-image-id="${escapeHtml(image.id)}">${actionLabel}</button>` : ""}
        ${extraActions}
      </div>
    </article>
  `;
}

function renderStoryCard(story) {
  const perspective = story.perspectiveLabel || perspectiveLabel(story.perspective);
  const protagonistState = displayStoryValue(story?.protagonist?.state) || "状态未设定";
  const goal = displayStoryValue(story?.world?.goal) || "继续推进当前故事";
  const chapter = story.chapter || "第一章";
  const cover = story.coverUrl
    ? `<img src="${escapeHtml(story.coverUrl)}" alt="${escapeHtml(story.title || "故事封面")}" loading="lazy" />`
    : "";

  return `
    <article class="story-card ${story.id === activeStoryId ? "active" : ""}" data-story-id="${escapeHtml(story.id)}">
      <div class="story-card-cover ${escapeHtml(story.cover || "forest")}">${cover}</div>
      <div class="story-card-body">
        <div class="chips">
          <span>${escapeHtml(story.type || "自定义故事")}</span>
          <span>${escapeHtml(perspective)}</span>
          <span>${isMatureModeEnabled(story) ? "&" : "全年龄"}</span>
        </div>
        <h3>${escapeHtml(story.title || "未命名故事")}</h3>
        <p>${escapeHtml(goal)}</p>
        <dl>
          <div><dt>章节</dt><dd>${escapeHtml(chapter)}</dd></div>
          <div><dt>主角</dt><dd>${escapeHtml(protagonistState)}</dd></div>
          <div><dt>更新</dt><dd>${escapeHtml(formatTime(story.updatedAt || new Date().toISOString()))}</dd></div>
        </dl>
        <div class="progress-line"><span style="width: ${Number(story.progress || 0)}%"></span></div>
        <div class="story-card-actions">
          <button class="primary-button" type="button" data-story-action="continue" data-story-id="${escapeHtml(story.id)}">继续</button>
          <button class="secondary-button" type="button" data-story-action="settings" data-story-id="${escapeHtml(story.id)}">故事设置</button>
          <button class="secondary-button danger-button" type="button" data-story-action="delete" data-story-id="${escapeHtml(story.id)}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderMessages() {
  if (!messages) return;
  const story = activeStory();
  if (!story) {
    messages.innerHTML = "";
    return;
  }

  const messageList = Array.isArray(story.messages) ? story.messages : [];
  const latestMessage = messageList[messageList.length - 1];
  const latestInlineChoiceBlock = extractInlineMessageChoices(latestMessage?.text || "");
  const latestChoices = latestInlineChoiceBlock?.choices?.length ? latestInlineChoiceBlock.choices : Array.isArray(latestMessage?.choices) ? latestMessage.choices : [];
  const noChoiceHint = latestMessage?.type === "npc" && !latestChoices.length
    ? '<div class="message-choice-hint">本轮未生成推荐行动，可直接输入你的下一步。</div>'
    : "";

  messages.innerHTML = messageList.map(renderMessage).join("") + noChoiceHint;
  messages.scrollTop = messages.scrollHeight;
}

function renderMessage(message) {
  const inlineChoiceBlock = extractInlineMessageChoices(message?.text || "");
  const text = renderMessageBody(inlineChoiceBlock ? { ...message, text: inlineChoiceBlock.narrative } : message);
  const choices = inlineChoiceBlock?.choices?.length ? inlineChoiceBlock.choices : Array.isArray(message?.choices) ? message.choices : [];
  const imageMarkup = message?.image?.url
    ? `
      <button class="message-image" type="button" data-image-action="preview" data-image-id="${escapeHtml(message.image.id || "")}">
        <img src="${escapeHtml(message.image.url)}" alt="${escapeHtml(message.image.purpose || "生成画面")}" />
      </button>
    `
    : "";
  const choiceMarkup = choices.length
    ? `
      <div class="message-choices" aria-label="可选行动">
        ${choices
          .map(
            (choice, index) => `
              <button type="button" class="message-choice" data-choice-text="${escapeHtml(extractChoiceActionText(choice))}">
                <span>${index + 1}</span>
                ${escapeHtml(normalizeChoiceLabel(choice))}
              </button>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  return `
    <div class="message ${escapeHtml(message?.type || "npc")}" data-message-id="${escapeHtml(message?.id || "")}">
      <div class="message-topline">
        <div class="message-actions">
          <button type="button" data-message-action="copy">复制</button>
          <button type="button" data-message-action="edit">编辑</button>
          <button type="button" data-message-action="regenerate">重试</button>
          <button type="button" data-message-action="delete">删除</button>
        </div>
      </div>
      ${text}
      ${imageMarkup}
      ${choiceMarkup}
    </div>
  `;
}

function renderMessageBody(message) {
  const value = stripReplyPrefixes(message?.text || "");
  return `<p>${formatMessageText(value)}</p>`;
}

function extractInlineMessageChoices(text) {
  const source = stripReplyPrefixes(String(text || "")).trim();
  if (!source) return null;

  const marker = /[\[【](?:选项|选择)\s*([一二三四五六七八九十\dA-Da-d]+)[\]】]\s*/g;
  const matches = [...source.matchAll(marker)].filter((match) => typeof match.index === "number");
  if (matches.length < 2) return null;

  const choices = matches
    .map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index || source.length : source.length;
      return normalizeInlineMessageChoice(source.slice(start, end));
    })
    .filter(Boolean)
    .slice(0, 3);

  if (choices.length < 2) return null;

  return {
    narrative: source.slice(0, matches[0].index || 0).trim(),
    choices,
  };
}

function normalizeInlineMessageChoice(text) {
  return String(text || "")
    .replace(/^\s*[：:\-—]+\s*/, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function stripReplyPrefixes(text) {
  let value = String(text || "").trim();
  for (let index = 0; index < 4; index += 1) {
    const next = value
      .replace(/^(?:旁白|系统|助手|Narrator)\s*[:：]\s*/i, "")
      .replace(/^【正文】\s*/m, "")
      .replace(/^正文\s*[:：]\s*/m, "")
      .trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

function renderUsage() {
  const story = activeStory();
  if (!story) return;
  if (sessionCost) sessionCost.textContent = `约 ¥${Number(story.usage?.cost || 0).toFixed(2)}`;
  if (tokenCount) tokenCount.textContent = `${Number(story.usage?.tokens || 0).toFixed(1)}K`;
  if (budgetValue) budgetValue.textContent = `${Number(story.contextBudget?.percent || 0)}%`;
}

function renderContextMeter() {
  const story = activeStory();
  if (!story) return;

  const stats = typeof calculateContextStats === "function" ? calculateContextStats(story) : { percent: calculateContextPercent(story), status: "normal" };
  const percent = stats.percent;
  story.contextBudget.percent = percent;

  if (contextPercent) contextPercent.textContent = `${percent}%`;
  if (contextBar) {
    contextBar.style.width = `${percent}%`;
    contextBar.className = percent > 90 ? "danger" : percent >= 70 ? "warn" : "";
  }

  const lastCompression = story.contextBudget?.lastCompression;
  const compressionText = lastCompression
    ? `上次 ${lastCompression.beforePercent}% -> ${lastCompression.afterPercent}%，压缩 ${lastCompression.compressedCount} 条`
    : "";
  const statusText = percent > 90 ? "强烈建议压缩" : percent >= 70 ? "建议压缩" : compressionText || "估算正常";
  if (contextStatus) contextStatus.textContent = statusText;
  if (contextRing) contextRing.textContent = `${percent}%`;

  const compressButton = document.querySelector(".context-compress-button");
  if (compressButton) {
    compressButton.style.setProperty("--context-percent", `${percent}%`);
    compressButton.title =
      percent > 90 ? "上下文接近上限，建议现在压缩到约 35%-50%" : percent >= 70 ? "上下文偏高，可以压缩到约 35%-50%" : "上下文估算正常";
  }

  if (contextBottomStatus) {
    contextBottomStatus.textContent = percent > 90 ? "建议压缩" : percent >= 70 ? "偏高" : compressionText || "正常";
  }
}

function renderSystems() {
  const story = activeStory();
  if (!story) return;
  renderStatusPanel(story);
  renderStorySystemsPanel(story);
  renderEventSummaryPanel(story);
}

function renderStatusPanel(story) {
  const panel = document.querySelector(".status-panel");
  if (!panel) return;

  const collapsed = Boolean(story.ui?.statusCollapsed);
  panel.classList.toggle("collapsed", collapsed);

  const toggle = panel.querySelector("[data-toggle-status-panel]");
  if (toggle) toggle.textContent = collapsed ? "展开" : "收起";

  const grid = panel.querySelector(".status-grid");
  if (grid) {
    grid.innerHTML = buildStatusTiles(story)
      .map(
        (tile) => `
          <div class="${tile.wide ? "wide" : ""}">
            <span>${escapeHtml(tile.label)}</span>
            <strong>${escapeHtml(tile.value)}</strong>
            ${tile.meta ? `<p>${escapeHtml(tile.meta)}</p>` : ""}
          </div>
        `,
      )
      .join("");
  }

  const progress = panel.querySelector(".progress-line span");
  if (progress) progress.style.width = `${Number(story.progress || 0)}%`;
}

function renderStorySystemsPanel(story) {
  if (!storySystems) return;
  const labels = storyStatusLabels(story);
  storySystems.innerHTML = [
    renderSystemDetails("主角信息", [
      ["身份", displayStoryValue(story?.protagonist?.profile) || "待补全"],
      ["当前状态", displayStoryValue(story?.protagonist?.state) || "待补全"],
      [labels.ability, [story?.protagonist?.cultivation, story?.protagonist?.luck].map(displayStoryValue).filter(Boolean).join(" / ") || "待补全"],
    ], true),
    renderSystemDetails("物品状态", (story.inventory || []).map((item) => [item.name, item.state || "待补全"])),
    renderSystemDetails("NPC 信息", (story.npcs || []).map((npc) => [npc.name, [npc.relation, npc.note].filter(Boolean).join(" / ")])),
    renderSystemDetails("事件与行动", buildCurrentProgressRows(story), true),
    renderSystemDetails("世界观", [
      [labels.goal, story?.world?.goal || "待补全"],
      ["世界设定", story?.world?.setting || "待补全"],
      ["内容模式", isMatureModeEnabled(story) ? "&" : "全年龄"],
    ]),
    renderSystemDetails("世界书", (story.worldbook || []).map((entry) => [entry.key, entry.content])),
    renderSystemDetails("记忆摘要", [
      ["长期记忆", story.memory || "待补全"],
      ["压缩摘要", story.compressedContext || "尚未压缩"],
    ]),
    renderSystemDetails("运行状态", buildRuntimeRows(story)),
  ].join("");
}

function renderEventSummaryPanel(story) {
  const list = document.querySelector(".event-list");
  if (!list) return;
  const events = Array.isArray(story.events) ? story.events : [];
  list.innerHTML = events.length
    ? events.map((event) => {
      const label = event.status === "done" ? "已完成" : event.status === "active" ? "进行中" : "下一步";
      const className = event.status === "done" ? "done" : event.status === "active" ? "active" : "";
      return `
        <article class="event-card ${className}">
          <span>${escapeHtml(label)}</span>
          <h4>${escapeHtml(event.title || "未命名事件")}</h4>
          <p>${escapeHtml(event.detail || "待补全")}</p>
        </article>
      `;
    }).join("")
    : '<article class="event-card"><span>暂无</span><h4>等待开始</h4><p>当前故事还没有事件摘要。</p></article>';
}

function renderSystemDetails(title, rows, open = false) {
  const validRows = (rows || [])
    .filter((row) => Array.isArray(row))
    .map(([label, value]) => [label, displayStoryValue(value)])
    .filter((row) => String(row[1] || "").trim());
  if (!validRows.length) return "";

  return `
    <details class="system-details" ${open ? "open" : ""}>
      <summary>${escapeHtml(title)}</summary>
      <div class="system-detail-body">
        ${validRows.map(([label, value]) => `
          <div class="system-row">
            <span>${escapeHtml(label)}</span>
            <p>${escapeHtml(value)}</p>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function displayStoryValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(displayStoryValue).filter(Boolean).join(" / ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, entryValue]) => [key, displayStoryValue(entryValue)].filter(Boolean).join("："))
      .filter(Boolean)
      .join("；");
  }
  return String(value);
}

function buildStatusTiles(story) {
  const labels = storyStatusLabels(story);
  const activeEvent = (story.events || []).find((event) => event.status === "active");
  const nextEvent = (story.events || []).find((event) => event.status === "next");
  const runtimeState = story.runtimeState || {};
  return [
    {
      label: "章节",
      value: story.chapter || "第一章",
      meta: nextEvent ? `下一章：${nextEvent.title}` : story.nextChapter ? `下一章：${story.nextChapter}` : "",
    },
    {
      label: "进度",
      value: `${Number(story.progress || 0)}%`,
      meta: runtimeState.tension || activeEvent?.detail || "",
    },
    {
      label: labels.goal,
      value: story?.world?.goal || "继续推进当前故事",
      meta: runtimeState.focus || "",
      wide: true,
    },
    {
      label: "主角状态",
      value: story?.protagonist?.state || "待补全",
      meta: story?.protagonist?.profile || "",
      wide: true,
    },
  ];
}

function storyStatusLabels(story) {
  const source = `${story?.title || ""} ${story?.type || ""} ${story?.world?.setting || ""} ${story?.world?.goal || ""}`;
  if (/建材|商业|公司|老板|经营|市场|销售|客户|都市/.test(source)) {
    return { goal: "经营目标", ability: "能力 / 优势" };
  }
  if (/修仙|宗门|灵根|炼气|筑基|金丹/.test(source)) {
    return { goal: "主线目标", ability: "修为 / 气运" };
  }
  if (/科幻|星空|飞船|宇宙|裂隙|文明/.test(source)) {
    return { goal: "探索目标", ability: "能力 / 状态" };
  }
  return { goal: "主线目标", ability: "能力 / 立场" };
}

function buildLatestChoiceRows(story) {
  const latestChoiceMessage = [...(story.messages || [])]
    .reverse()
    .find((message) => message.type === "npc" && Array.isArray(message.choices) && message.choices.length);
  if (!latestChoiceMessage) return [];
  return latestChoiceMessage.choices.slice(0, 3).map((choice, index) => [`推荐行动 ${index + 1}`, normalizeChoiceLabel(choice)]);
}

function buildCurrentProgressRows(story) {
  const activeEvent = (story.events || []).find((event) => event.status === "active");
  const nextEvent = (story.events || []).find((event) => event.status === "next");
  const runtimeState = story.runtimeState || {};
  return [
    activeEvent ? ["当前事件", `${activeEvent.title} / ${activeEvent.detail || "待补全"}`] : null,
    runtimeState.focus ? ["当前焦点", runtimeState.focus] : null,
    runtimeState.tension ? ["局势变化", runtimeState.tension] : null,
    nextEvent ? ["下一步", `${nextEvent.title} / ${nextEvent.detail || "待补全"}`] : null,
  ].filter(Boolean);
}

function buildActionSuggestionRows(story) {
  const latest = buildLatestChoiceRows(story);
  if (latest.length) return latest;
  return buildDefaultChoices(story).slice(0, 3).map((choice, index) => [`推荐行动 ${index + 1}`, normalizeChoiceLabel(choice)]);
}

function buildEventChainRows(story) {
  return (story.events || []).slice(0, 6).map((event) => {
    const label = event.status === "done" ? "已完成" : event.status === "active" ? "当前阶段" : "后续阶段";
    return [label, `${event.title} / ${event.detail || "待补全"}`];
  });
}

function buildRuntimeRows(story) {
  const runtimeState = story.runtimeState || {};
  const stateUpdate = runtimeState.lastStateUpdate || {};
  return [
    ["最近焦点", runtimeState.focus || ""],
    ["局势变化", runtimeState.tension || ""],
    ["事件推进", runtimeState.lastEventTransition || ""],
    ["下一步提示", runtimeState.lastNextHint || ""],
    ["最近状态写入", summarizeRuntimeUpdate(stateUpdate)],
  ].filter((row) => String(row[1] || "").trim());
}

function summarizeRuntimeUpdate(stateUpdate) {
  if (!stateUpdate || !Object.keys(stateUpdate).length) return "";
  const parts = [
    stateUpdate.eventTitle ? `事件=${stateUpdate.eventTitle}` : "",
    stateUpdate.goal ? `目标=${stateUpdate.goal}` : "",
    stateUpdate.keyNpc ? `人物=${stateUpdate.keyNpc}` : "",
    stateUpdate.keyItem ? `物品=${stateUpdate.keyItem}` : "",
    Number.isFinite(Number(stateUpdate.progressDelta)) && Number(stateUpdate.progressDelta) !== 0
      ? `进度=${Number(stateUpdate.progressDelta) > 0 ? "+" : ""}${stateUpdate.progressDelta}`
      : "",
  ].filter(Boolean);
  return parts.join("；");
}

function renderInputMode() {
  const story = activeStory();
  if (!story) return;
  inputModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.inputMode === story.inputMode);
  });
  if (!messageInput) return;
  const placeholders = {
    action: "输入你的行动，例如：我先观察周围环境",
    say: "输入你想说的话，例如：你刚才那句话是什么意思？",
    story: "补充你的描写，例如：我把灯光压低，先不惊动任何人",
    see: "描述想看的画面，例如：生成当前场景的关键画面",
  };
  messageInput.placeholder = placeholders[story.inputMode] || placeholders.action;
}

function renderPerspective() {
  const story = activeStory();
  if (!story) return;
  perspectiveButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.perspective === story.perspective);
  });
}
