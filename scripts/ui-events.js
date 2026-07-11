let uiEventsBound = false;

function closeStrayDialogs() {
  document.querySelectorAll("dialog[open]").forEach((dialog) => {
    try {
      dialog.close();
    } catch {
      dialog.removeAttribute("open");
    }
  });
}

function showDialog(dialog) {
  if (!dialog) {
    console.error("Dialog not found");
    return false;
  }
  if (dialog.open) closeDialog(dialog);
  closeStrayDialogs();
  try {
    dialog.showModal();
    return true;
  } catch (error) {
    console.error("Failed to open dialog with showModal()", error);
    dialog.setAttribute("open", "");
    return true;
  }
}

function closeDialog(dialog) {
  if (!dialog) return;
  try {
    dialog.close();
  } catch {
    dialog.removeAttribute("open");
  }
}

function resetPrototypeRuntimeState() {
  window.clearTimeout(generationTimer);
  generationTimer = null;
  isGenerating = false;
  generatedDraft = null;
  pendingStoryWorldbookEntries = [];
  resetCreateWorldbookImportSession();
  closeDialog(createDialog);
  closeDialog(storySettingsDialog);
  closeDialog(contextDialog);
  closeDialog(imagePromptDialog);
  closeDialog(imagePreviewDialog);
  if (sendButton) sendButton.disabled = false;
  if (generationStatus) generationStatus.hidden = true;
  if (settingsStatus) settingsStatus.textContent = "运行状态已刷新，故事和 API 设置未清空。";
  renderAll();
}

function bindUiEvents() {
  if (uiEventsBound) return;
  uiEventsBound = true;

  navItems.forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });

  viewTargetButtons.forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewTarget));
  });

  perspectiveButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const story = activeStory();
      if (!story) return;
      story.perspective = button.dataset.perspective;
      addMessage("系统", `叙事视角已切换为${button.textContent.trim()}。后续回复会按这个视角继续。`, "npc");
      saveStories();
      renderAll();
    });
  });

  inputModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const story = activeStory();
      if (!story) return;
      story.inputMode = button.dataset.inputMode;
      saveStories();
      renderInputMode();
    });
  });

  composer?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const story = activeStory();
    const value = messageInput?.value.trim();
    if (!story || !value || isGenerating) return;

    if (story.inputMode === "see") {
      await queueImage(value, { purpose: "场景氛围" });
      messageInput.value = "";
      return;
    }

    addMessage("你", formatUserText(value), "user");
    updateUsage(0.03, 0.4);
    messageInput.value = "";
    generateAssistantReply();
  });

  messages?.addEventListener("click", async (event) => {
    const choice = event.target.closest("[data-choice-text]");
    if (choice) {
      const story = activeStory();
      if (!story) return;
      story.inputMode = "action";
      messageInput.value = extractChoiceActionText(choice.dataset.choiceText || "");
      saveStories();
      renderInputMode();
      messageInput.focus();
      return;
    }

    const action = event.target.closest("[data-message-action]");
    if (!action) return;

    const story = activeStory();
    const id = action.closest(".message")?.dataset.messageId;
    const message = story?.messages.find((item) => item.id === id);
    if (!story || !message) return;

    if (action.dataset.messageAction === "copy") {
      await copyText(message.text);
      markSaved("已复制");
      return;
    }

    if (action.dataset.messageAction === "delete") {
      story.messages = story.messages.filter((item) => item.id !== id);
      saveStories();
      renderAll();
      return;
    }

    if (action.dataset.messageAction === "edit") {
      const nextText = window.prompt("编辑这条消息", message.text);
      if (nextText === null) return;
      message.text = nextText.trim() || message.text;
      story.updatedAt = new Date().toISOString();
      saveStories();
      renderAll();
      return;
    }

    if (action.dataset.messageAction === "regenerate") {
      const stripped = message.text
        .replace(/(?:\n|^)\s*(?:可选行动|下一步行动推荐)[\s\S]*$/m, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      message.text = `${stripped}\n\n（已标记为需要重新生成）`;
      updateUsage(0.04, 0.7);
      saveStories();
      renderAll();
    }
  });

  document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) {
      if (closeButton.closest("dialog") === imagePromptDialog) pendingImagePromptReview = null;
      closeDialog(closeButton.closest("dialog"));
      return;
    }

    const imageAction = event.target.closest("[data-image-action]");
    if (imageAction) {
      if (imageAction.dataset.imageAction === "preview") {
        openImagePreview(imageAction.dataset.imageId || "");
      } else if (imageAction.dataset.imageAction === "delete") {
        deleteImageRecord(imageAction.dataset.imageId || "");
      } else if (imageAction.dataset.imageAction === "open-folder") {
        void openImageFolder(imageAction.dataset.imageId || "");
      } else if (imageAction.dataset.imageAction === "check") {
        void checkImageResult(imageAction.dataset.imageId || "");
      } else {
        void queueImage("", { imageId: imageAction.dataset.imageId || "" });
      }
      return;
    }

    const storyAction = event.target.closest("[data-story-action]");
    if (storyAction) {
      const id = storyAction.dataset.storyId || storyAction.closest("[data-story-id]")?.dataset.storyId || activeStoryId;
      if (storyAction.dataset.storyAction === "continue") setActiveStory(id);
      if (storyAction.dataset.storyAction === "settings") openStorySettings(id);
      if (storyAction.dataset.storyAction === "delete") deleteStory(id);
      return;
    }

    if (event.target.closest("[data-open-create]") || event.target.closest('[data-action="create-story"]')) {
      openCreateDialog();
      return;
    }

    if (event.target.closest("[data-generate-image]")) {
      void queueImage("根据当前关键节点生成一张氛围画面");
      return;
    }

    if (event.target.closest("[data-compress-context]")) {
      const confirmed = window.confirm("确认压缩较早对话吗？压缩后会把早期内容写入摘要，主对话区只保留最近消息。");
      if (!confirmed) return;
      compressContext();
      return;
    }

    if (event.target.closest("[data-open-context]")) {
      openContextPreview();
      return;
    }

    if (event.target.closest("[data-toggle-status-panel]")) {
      const story = activeStory();
      if (!story) return;
      story.ui = { ...(story.ui || {}), statusCollapsed: !story.ui?.statusCollapsed };
      saveStories();
      renderSystems();
      return;
    }

    if (event.target.closest("[data-toggle-sidebar]")) {
      const collapsed = document.body.classList.toggle("sidebar-collapsed");
      localStorage.setItem(storageKeys.sidebar, collapsed ? "1" : "0");
      renderChrome();
      return;
    }

    if (event.target.closest("[data-theme-toggle]")) {
      document.body.classList.toggle("light-theme");
      localStorage.setItem(storageKeys.theme, document.body.classList.contains("light-theme") ? "light" : "dark");
      renderChrome();
    }
  });

  document.querySelectorAll("[data-save-settings]").forEach((button) => {
    button.addEventListener("click", () => {
      settings = readSettingsForm();
      saveSettings();
      if (settingsStatus) settingsStatus.textContent = "全局 API 设置已保存。";
    });
  });

  document.querySelector("[data-test-image-settings]")?.addEventListener("click", async () => {
    const imageSettingsStatus = document.querySelector("#image-settings-status");
    settings = readSettingsForm();
    saveSettings();
    if (imageSettingsStatus) imageSettingsStatus.textContent = "正在检测生图配置...";
    if (settingsStatus) settingsStatus.textContent = "正在检测生图配置...";
    const result = await testImageSettingsConnection();
    if (imageSettingsStatus) imageSettingsStatus.textContent = result.message;
    if (settingsStatus) settingsStatus.textContent = result.message;
  });

  document.querySelector("[data-reset-runtime-state]")?.addEventListener("click", () => {
    resetPrototypeRuntimeState();
  });

  document.querySelector("#save-story-settings")?.addEventListener("click", () => {
    saveStorySettingsFromDialog();
  });

  document.querySelector("#story-generate-cover")?.addEventListener("click", async () => {
    const story = activeStory();
    if (!story) return;
    saveStorySettingsFromDialog();
    await requestImagePromptReview(buildCoverSuggestionPrompt(story), {
      purpose: "章节封面",
      openGallery: false,
    });
  });

  document.querySelector("#enhance-outline")?.addEventListener("click", async () => {
    await enhanceCreateOutline();
  });

  document.querySelector("#create-story-confirm")?.addEventListener("click", () => {
    createStoryFromDialog();
  });

  imagePromptConfirm?.addEventListener("click", () => {
    void confirmPendingImagePrompt();
  });

  imagePromptReviewButton?.addEventListener("click", async () => {
    const promptText = String(imagePromptText?.value || "").trim();
    if (!promptText) return;
    if (imagePromptStatus) imagePromptStatus.textContent = "正在审查并优化提示词...";
    const result = await reviewImagePromptForImageApi(promptText);
    if (imagePromptText) imagePromptText.value = result.prompt;
    if (imagePromptStatus) imagePromptStatus.textContent = result.notes || "审查完成。";
  });

  imagePromptStylePreset?.addEventListener("change", () => {
    rebuildPendingImagePrompt(true);
  });

  imagePromptStyleNote?.addEventListener("change", () => {
    rebuildPendingImagePrompt(true);
  });

  imagePreviewFolder?.addEventListener("click", () => {
    void openImageFolder(activePreviewImageId);
  });

  topCreateButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleOpenCreateDialog("top");
  });

  sidebarCreateButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleOpenCreateDialog("sidebar");
  });

  createWorldbookPick?.addEventListener("click", () => createWorldbookFile?.click());
  storyWorldbookPick?.addEventListener("click", () => storyWorldbookFile?.click());

  createWorldbookFile?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      resetCreateWorldbookImportSession();
      return;
    }

    const sessionId = beginCreateWorldbookRead(file);
    try {
      const entries = await readWorldbookFile(file);
      commitCreateWorldbookRead(sessionId, file, entries);
    } catch (error) {
      failCreateWorldbookRead(sessionId, file, error);
    }
  });

  storyWorldbookFile?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const entries = file ? await readWorldbookFile(file) : [];
    pendingStoryWorldbookEntries = entries;
    renderStoryWorldbookImport(file, entries);
  });

  createWorldbookTranslate?.addEventListener("click", async () => {
    await translateWorldbookIntoDraft();
  });

  storyWorldbookImport?.addEventListener("click", () => {
    applyWorldbookEntriesToStory(pendingStoryWorldbookEntries);
    renderStoryWorldbookImport(null, []);
    pendingStoryWorldbookEntries = [];
    if (storyWorldbookFile) storyWorldbookFile.value = "";
  });

  stopGenerationButton?.addEventListener("click", () => {
    if (isGenerating) stopGeneration("已停止生成");
  });
}
