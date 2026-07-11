let stories = loadStories();
let activeStoryId = loadActiveStoryId(stories);
let settings = loadSettings();
let isGenerating = false;
let generationTimer = null;
let generatedDraft = null;
let createWorldbookImportSession = {
  id: 0,
  file: null,
  entries: [],
  status: "idle",
  error: "",
};
let pendingCreateWorldbookEntries = [];
let pendingStoryWorldbookEntries = [];
let pendingImagePromptReview = null;
let activePreviewImageId = "";
