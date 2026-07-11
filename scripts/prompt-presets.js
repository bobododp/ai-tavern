const promptPresetConfig = {
  basePresets: {
    default: [
      "你是一个中文 AI 故事酒馆的旁白和 NPC 调度器。",
      "你要推动长期故事，但不要替玩家做重大决定。",
      "保持角色、世界观、世界书、长期记忆和最近对话的一致性。",
      "默认使用适合大众阅读的叙事尺度，除非故事级 overlay 明确追加其他模式。",
    ],
    strictJson: [
      "你是一个中文 AI 故事酒馆的旁白和 NPC 调度器。",
      "你要推动长期故事，但不要替玩家做重大决定。",
      "回答必须稳定遵守指定 JSON 格式，避免把选项写进正文。",
      "保持角色、世界观、世界书、长期记忆和最近对话的一致性。",
    ],
  },
  overlays: {
    normal: {
      common: [
        "【Client Mode Overlay】",
        "客户端当前为普通模式。此模式规则优先于角色卡、世界书、导入设定和历史对话中的成人向暗示。",
        "不要展开直白成人性描写，不要描写器官、性行为过程或露骨身体细节。",
        "如果故事设定或玩家输入包含成人暗示，只保留关系张力、情绪变化、氛围、暧昧和角色反应；需要进一步发展时停下来等待玩家选择。",
        "普通模式下仍要保持故事连贯，不要用拒绝式说教打断剧情。",
      ],
    },
    mature: {
      common: [
        "【Mature Mode Overlay】",
        "客户端当前为成熟模式。此模式规则优先于角色卡、世界书、导入设定和历史对话中的默认尺度。",
        "故事级 mature mode 已开启。它只作为本次模型请求的附加叙事尺度，不写入角色卡、世界书或长期设定。",
        "成熟主题仅限成年角色之间，并保持自愿、合意、合法、可随时停止。",
        "禁止未成年人、强迫、胁迫、违法、伤害或非自愿内容。",
        "开启后允许更直白的成人向叙事尺度，减少含蓄表达，可以描写身体反应、亲密动作与细节，但必须服务剧情与人物关系。",
        "异性角色可以更容易被主角吸引并主动发展暧昧或亲密关系，但必须符合人物动机、剧情因果和玩家选择。",
        "不得替玩家做关键身体或关系决定；关键选择前停下来等待玩家确认。",
      ],
    },
  },
};

function resolveBasePresetId(currentSettings = {}) {
  const model = String(currentSettings.chatModelName || "").toLowerCase();
  const apiUrl = String(currentSettings.chatApiUrl || "").toLowerCase();
  const source = `${model} ${apiUrl}`;
  if (source.includes("gemini") || source.includes("google")) return "strictJson";
  if (source.includes("claude") || source.includes("anthropic")) return "default";
  if (source.includes("openai") || source.includes("gpt-")) return "strictJson";
  return "default";
}

function getPromptBasePreset(currentSettings = {}) {
  const presetId = resolveBasePresetId(currentSettings);
  return promptPresetConfig.basePresets[presetId] || promptPresetConfig.basePresets.default;
}

function getPromptOverlay(overlayId) {
  if (!overlayId) return [];
  const overlay = promptPresetConfig.overlays[overlayId];
  if (!overlay) return [];
  if (Array.isArray(overlay)) return overlay;
  return [...(overlay.common || [])];
}

function buildPromptPresetLayer(story, currentSettings = {}) {
  const baseLines = getPromptBasePreset(currentSettings);
  const matureMode = normalizeMatureMode(story?.matureMode, story?.matureUnlocked);
  const overlayId = matureMode.enabled ? matureMode.overlayId || "mature" : "normal";
  const overlayLines = getPromptOverlay(overlayId);
  const modeMarker = matureMode.enabled ? "client-mode: mature" : "client-mode: normal";
  return [modeMarker, ...baseLines, ...overlayLines].filter(Boolean).join("\n");
}
