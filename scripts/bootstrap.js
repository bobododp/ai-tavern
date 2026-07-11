function applyStoredUiState() {
  if (localStorage.getItem(storageKeys.theme) === "light") {
    document.body.classList.add("light-theme");
  }

  if (localStorage.getItem(storageKeys.sidebar) === "1") {
    document.body.classList.add("sidebar-collapsed");
  }
}

function bootApplication() {
  try {
    applyStoredUiState();
  } catch (error) {
    console.error("Failed to apply stored UI state", error);
  }

  try {
    closeStrayDialogs();
  } catch (error) {
    console.error("Failed to close stray dialogs", error);
  }

  try {
    hydrateSettingsForm();
  } catch (error) {
    console.error("Failed to hydrate settings form", error);
  }

  try {
    bindUiEvents();
  } catch (error) {
    console.error("Failed to bind UI events", error);
  }

  try {
    renderAll();
  } catch (error) {
    console.error("Failed to render app", error);
  }
}
