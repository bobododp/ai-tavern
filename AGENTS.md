## Project AGENTS

## 项目类型
- 纯前端静态原型：HTML + CSS + 原生 JavaScript。
- 当前无后端、无数据库、无构建工具。
- 默认通过直接打开 `index.html` 运行。

## 项目目标
- 把当前 AI 酒馆原型稳定下来，再逐步补齐长期故事产品能力。
- 当前优先级不是继续堆新功能，而是先保证现有页面、弹窗、故事流和导入流可用。
- 后续再进入结构整理、轻后端接入、18+ 模式预留接口。

## 当前状态
- 已完成多故事结构，核心存储键为：
  - `tavern-stories`
  - `tavern-active-story-id`
  - `tavern-api-settings`
- 当前故事图片已进入故事级数据：
  - `story.images`
  - 状态包含 `suggested`、`pending`、`done`、`error`
- 已有页面与弹窗：
  - 主页
  - 故事板
  - 画廊
  - 设置
  - 创建故事弹窗
  - 故事根设置弹窗
  - 上下文预览弹窗
- 前端已拆分为 `scripts/*.js` 多文件：
  - `core.js`：常量、格式化、压缩状态基础工具
  - `dom.js`：DOM 节点缓存
  - `state.js`：全局运行时状态
  - `bootstrap.js`：启动流程
  - `story-data.js`：故事修复、示例数据、默认结构
  - `story-storage.js`：localStorage 读写
  - `story-runtime.js`：故事切换、消息写入、调用流程、状态推进
  - `story-engine.js`：上下文构建、压缩、回复解析、推荐动作
  - `story-editor.js`：创建故事、故事设置、世界书导入
  - `ui-render.js`：界面渲染
  - `ui-events.js`：事件绑定、弹窗控制
- `app.js` 目前只保留兼容入口角色。
- 目前阶段重点：
  1. 清理脚本拆分后遗留 bug
  2. 清理乱码和旧残留
  3. 完成阶段 1 验收
  4. 再进入下一阶段开发
- 创建故事的世界书导入已改为“导入会话”状态：
  - 当前文件、解析结果、读取/翻译/完成/失败状态必须保持同步。
  - 不要再直接依赖旧的 `pendingCreateWorldbookEntries` 作为唯一来源。
  - 修改导入流程后要同步检查 `createWorldbookImportSession`。
- 成人模式当前只做故事级接口预留：
  - 兼容旧字段 `matureUnlocked`。
  - 新预留结构为 `matureMode`。
  - 不要在当前阶段扩展完整成人模式策略。
- 生图当前按 OpenAI 兼容接口接入：
  - 设置页字段为 `imageApiUrl`、`imageModelName`、`imageApiKey`
  - 默认优先走本地代理 `image-proxy.js`，代理地址字段为 `imageProxyUrl`
  - 默认接口路径为 `/images/generations`
  - 创建故事时如开启“自动建议生成封面”，只写入建议卡，不自动调用接口

## 重要文件
- `index.html`：页面结构、视图容器、弹窗 DOM
- `styles.css`：整体布局、主题、侧边栏、故事板、弹窗样式
- `app.js`：兼容入口
- `scripts/core.js`
- `scripts/dom.js`
- `scripts/state.js`
- `scripts/bootstrap.js`
- `scripts/story-data.js`
- `scripts/story-storage.js`
- `scripts/story-runtime.js`
- `scripts/story-engine.js`
- `scripts/prompt-presets.js`
- `scripts/story-editor.js`
- `scripts/ui-render.js`
- `scripts/ui-events.js`
- `image-proxy.js`：本地静态服务与生图代理，避免浏览器 CORS 拦截
- `启动酒馆.bat`：一键启动本地生图代理并打开原来的 `index.html`
- `项目.md`：开发路线与阶段规划
- `问题清单.md`：当前风险和待收口问题
- `验收清单.md`：阶段 0/1 手动验收清单

## Mature Mode 约定
- 故事设置里的“解”保存到 `story.matureMode.enabled`，兼容旧字段 `matureUnlocked`。
- `scripts/prompt-presets.js` 维护模型 base preset 和 mature overlay 文案。
- `scripts/story-engine.js` 在 `buildSystemPrompt(story)` 中调用 preset layer；关闭时追加普通模式 overlay，开启时追加 mature overlay。
- 当前只做 prompt overlay，不做完整成人模式策略、账号验证、后端审计或复杂插件系统。
- `matureMode.intensity` 统一固定为 `explicit`；故事设置里不再暴露强度切换。
- Mature Mode 采用双向客户端 overlay：关闭时压制导入设定里的直白成人描写，开启时允许成熟模式叙事尺度。
- 设置页叙事规则必须影响最终 prompt：`noMajorDecision`、`autoSummary`、`nextStep`、`responseLength` 不能只保存不用。
- 消耗和上下文占用当前是前端估算，不要表述为真实后端扣费。
- 压缩目标为约 45%，不是 0%；压缩后记录 `contextBudget.lastCompression`。

## 输出要求
- 优先小步修改，保持当前原型始终可打开、可点击、可继续验证。
- 先修真实阻断问题，再补功能，再做结构优化。
- 修改前先判断属于哪一层：数据、运行时、故事引擎、编辑器、渲染、事件。
- 不做无关重构，不顺手改视觉方向。
- 生图失败时要保留提示卡和错误状态，不能直接吞掉。

## 禁止事项
- 不要擅自引入大型依赖、框架、数据库或完整后端体系。
- 不要修改 localStorage 键名，除非同时做迁移兼容。
- 不要在修 UI 时顺手重做故事数据结构。
- 不要把 API Key 持久化方案扩展成正式安全方案；当前仅限原型本地暂存。稳定生图优先通过本地代理转发，后续再迁移到正式后端。

## 检查方式
- 基础运行：直接打开 `index.html`
- 稳定生图运行：优先双击 `启动酒馆.bat`；它会后台启动 `image-proxy.js`，并打开原来的 `index.html`
- 语法检查：
  - `node --check app.js`
  - 必要时对单个 `scripts/*.js` 做 `node --check`
- 每次改动后至少手动验证：
  - 主页切换
  - 故事板切换
  - 画廊生成 / 重试 / 已生成展示（优先走本地代理）
  - 创建故事弹窗
  - 创建故事里的世界书导入与 AI 翻译写入
  - 故事设置弹窗
  - 上下文预览
  - 设置页保存
  - 亮暗色切换
  - 侧边栏展开/折叠
- 进入下一阶段前，按 `验收清单.md` 完整走一轮。
