function loadStories() {
  const savedStories = readJson(storageKeys.stories);
  if (Array.isArray(savedStories) && savedStories.length) {
    const normalizedStories = savedStories.map((story, index) => {
      try {
        return normalizeStory(story);
      } catch (error) {
        console.error("Failed to normalize saved story", story?.id || index, error);
        return normalizeStory({
          ...sampleStoryFallback(story?.id),
          id: story?.id || `recovered-${index + 1}`,
        });
      }
    });
    localStorage.setItem(storageKeys.stories, JSON.stringify(normalizedStories));
    return normalizedStories;
  }

  const legacy = readJson(storageKeys.legacyStory);
  if (legacy) {
    let migrated;
    try {
      migrated = normalizeStory({ ...legacy, id: legacy.id || "legacy-forest" });
    } catch (error) {
      console.error("Failed to migrate legacy story", error);
      migrated = normalizeStory({ ...sampleStoryFallback("forest"), id: legacy.id || "legacy-forest" });
    }
    const initial = [migrated, ...sampleStories().filter((story) => story.id !== migrated.id)];
    localStorage.setItem(storageKeys.stories, JSON.stringify(initial));
    localStorage.setItem(storageKeys.activeStoryId, migrated.id);
    return initial;
  }

  const samples = sampleStories();
  localStorage.setItem(storageKeys.stories, JSON.stringify(samples));
  localStorage.setItem(storageKeys.activeStoryId, samples[0].id);
  return samples;
}

function loadActiveStoryId(storyList) {
  const savedId = localStorage.getItem(storageKeys.activeStoryId);
  return storyList.some((story) => story.id === savedId) ? savedId : storyList[0].id;
}

function loadSettings() {
  const defaults = {
    chatApiUrl: "",
    chatModelName: "",
    chatApiKey: "",
    imageApiUrl: "",
    imageModelName: "",
    imageApiKey: "",
    imageProxyUrl: getDefaultImageProxyUrl(),
    useImageProxy: true,
    imageDefaultPurpose: "关键节点画面",
    askImageCover: true,
    noMajorDecision: true,
    autoSummary: true,
    nextStep: false,
    responseLength: "long",
  };

  return repairSettingsData({ ...defaults, ...(readJson(storageKeys.settings) || {}) });
}

function saveStories() {
  localStorage.setItem(storageKeys.stories, JSON.stringify(stories));
  localStorage.setItem(storageKeys.activeStoryId, activeStoryId);
  markSaved("已保存");
}

function saveActiveStoryId(id) {
  activeStoryId = id;
  localStorage.setItem(storageKeys.activeStoryId, id);
}

function saveSettings() {
  localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
}
