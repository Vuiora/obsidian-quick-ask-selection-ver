const { Plugin, PluginSettingTab, SecretComponent, Notice, editorInfoField } = require('obsidian');
const { createQuickAsk } = require('../../src/quick-ask/index');
const { quickAskPage } = require('../../src/quick-ask/settings-ui');
const { quickAskControlValue, quickAskControlPatch } = require('../../src/quick-ask/settings-controls');
const { QuickAskSettings } = require('./settings-store');

// Move the panel with its header without interfering with the close button or answer selection.
function installPanelDrag(panel, header, close) {
  let drag = null;
  const owner = panel.ownerDocument.defaultView;
  function stop(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const id = drag.id; drag = null;
    if (header.hasPointerCapture?.(id)) header.releasePointerCapture(id);
    header.classList.remove('is-dragging');
  }
  header.addEventListener('pointerdown', event => {
    if (close.contains(event.target) || event.button !== 0 || drag) return;
    const rect = panel.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    header.setPointerCapture?.(event.pointerId);
    header.classList.add('is-dragging');
    event.preventDefault();
  });
  header.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const margin = 8;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const top = Math.max(margin, Math.min(drag.top + event.clientY - drag.y, owner.innerHeight - height - margin));
    panel.style.left = `${Math.max(margin, Math.min(drag.left + event.clientX - drag.x, owner.innerWidth - width - margin))}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${panel.dataset.userSized === 'true' ? owner.innerHeight - top - margin : Math.min(owner.innerHeight * .65, 600, owner.innerHeight - top - margin)}px`;
  });
  header.addEventListener('pointerup', stop);
  header.addEventListener('pointercancel', stop);
  header.addEventListener('lostpointercapture', stop);
  return () => stop();
}

// The resize handle captures the pointer, leaving answer selection and header dragging intact.
function installPanelResize(panel, handle, onSize) {
  const owner = panel.ownerDocument.defaultView;
  let resize = null;
  function stop(event) {
    if (!resize || (event && event.pointerId !== resize.id)) return;
    const id = resize.id; resize = null;
    if (handle.hasPointerCapture?.(id)) handle.releasePointerCapture(id);
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || resize) return;
    const rect = panel.getBoundingClientRect();
    resize = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, left: rect.left, top: rect.top };
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  });
  handle.addEventListener('pointermove', event => {
    if (!resize || event.pointerId !== resize.id) return;
    const availableWidth = Math.max(1, owner.innerWidth - resize.left - 8);
    const availableHeight = Math.max(1, owner.innerHeight - resize.top - 8);
    const width = Math.min(availableWidth, Math.max(Math.min(260, availableWidth), resize.width + event.clientX - resize.x));
    const height = Math.min(availableHeight, Math.max(Math.min(120, availableHeight), resize.height + event.clientY - resize.y));
    panel.dataset.userSized = 'true'; panel.style.width = `${width}px`; panel.style.height = `${height}px`;
    panel.style.maxHeight = `${availableHeight}px`;
    onSize({ width, height });
  });
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  return () => stop();
}

// Separate streamed answer text from the model-generated exploration questions.
const QUICK_ASK_SUGGESTION_MARKER = "\n<!--QA_SUGGESTIONS-->";
function splitQuickAskOutput(raw, final = false) {
  raw = typeof raw === 'string' ? raw : '';
  const index = raw.indexOf(QUICK_ASK_SUGGESTION_MARKER);
  if (index >= 0) {
    let suggestions = [];
    if (final) {
      try {
        const parsed = JSON.parse(raw.slice(index + QUICK_ASK_SUGGESTION_MARKER.length).trim());
        if (Array.isArray(parsed) && parsed.length === 3 && parsed.every(x => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= 80)) suggestions = parsed.map(x => x.trim());
      } catch {}
    }
    return { text: raw.slice(0, index).trimEnd(), suggestions };
  }
  if (!final) {
    for (let n = Math.min(raw.length, QUICK_ASK_SUGGESTION_MARKER.length - 1); n > 0; n--) {
      if (raw.endsWith(QUICK_ASK_SUGGESTION_MARKER.slice(0, n))) return { text: raw.slice(0, -n), suggestions: [] };
    }
  }
  return { text: raw, suggestions: [] };
}

// Generate suggestions from the completed answer without adding a conversation turn.
function parseSelectionSuggestions(raw) {
  const value = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let items;
  try { const parsed = JSON.parse(value); items = Array.isArray(parsed) ? parsed : parsed?.questions ?? parsed?.suggestions; } catch {}
  if (!Array.isArray(items)) items = value.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.、)）])\s*/, '').trim()).filter(Boolean);
  if (items.length !== 3 || !items.every(item => typeof item === 'string' && item.trim().length > 0 && item.trim().length <= 100)) return [];
  return items.map(item => item.trim());
}
async function requestSelectionSuggestions(plugin, question, answer, signal) {
  const { sessionConfigSnapshot } = require('../../src/quick-ask/settings');
  const { protocolFor } = require('../../src/quick-ask/protocol');
  const { streamAttempt } = require('../../src/quick-ask/transport');
  const config = sessionConfigSnapshot(plugin.settings.values().quickAsk);
  const environment = plugin.quickAsk.environment;
  const protocol = protocolFor(config);
  const apiKey = environment.secrets.resolve(config.secretId);
  if (!apiKey) throw new Error('请检查模型密钥设置');
  const prompt = `请根据以下问题和已生成的回答，提出三个不同且具体的后续探索问题。仅返回包含三个字符串的 JSON 数组。\n\n问题：${question}\n\n回答：${answer}`;
  const body = protocol.buildRequestBody({ model: config.model, instructions: '依据所给回答提出问题，不要回答问题。', input: [protocol.userMessage(prompt)], tools: [], toolChoice: 'none', reasoningEffort: 'none', maxOutputTokens: 400, store: false });
  const result = await streamAttempt({ protocol, network: environment.network, scheduler: environment.scheduler, baseUrl: config.baseUrl, body, apiKey, signal, idleTimeoutMs: 45000 });
  if (result.status !== 'completed') throw new Error('建议生成未完成');
  const suggestions = parseSelectionSuggestions(result.text);
  if (suggestions.length !== 3) throw new Error('建议格式不正确');
  return suggestions;
}

// Save an explicit snapshot without overwriting existing notes.
async function saveSelectionConversation(plugin, sourcePath, levels) {
  if (!levels.some(level => level.answer)) throw new Error('暂无可保存的回答');
  const vault = plugin.app.vault;
  const slash = sourcePath.lastIndexOf('/');
  const folder = slash < 0 ? '' : sourcePath.slice(0, slash + 1);
  const basename = sourcePath.slice(slash + 1).replace(/\.md$/i, '');
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const quote = value => String(value).split(/\r?\n/).map(line => `> ${line}`).join('\n');
  const parts = ['# AI 解释记录', '', `来源笔记：${sourcePath}`, ''];
  levels.forEach((level, index) => {
    parts.push(`## ${index + 1}. 提问`, '', quote(level.question || ''), '');
    if (Number.isInteger(level.parentIndex) && level.parentIndex >= 0) parts.push(`上级解释：第 ${level.parentIndex + 1} 条`, '');
    if (level.status === 'running') parts.push('状态：生成中（以下为保存时已有的内容）', '');
    else if (level.status === 'stopped') parts.push('状态：已停止或未完成', '');
    else if (level.status === 'failed') parts.push('状态：生成失败或未完成', '');
    parts.push('### 回答', '', level.answer || '（暂无回答）', '');
  });
  const contents = parts.join('\n');
  for (let suffix = 1; suffix <= 1000; suffix++) {
    const path = `${folder}${basename} - AI解释 ${stamp}${suffix === 1 ? '' : `-${suffix}`}.md`;
    if (vault.getAbstractFileByPath(path)) continue;
    try { await vault.create(path, contents); return path; }
    catch (error) { if (vault.getAbstractFileByPath(path)) continue; throw error; }
  }
  throw new Error('无法找到可用的文件名');
}

// A compact, independent explanation for a selection in a Markdown note.
function installSelectionAsk(plugin) {
  const doc = document;
  let toolbar = null, panel = null, abort = null, timer = null, closed = false, generation = 0, clearAnswer = null, clearDrag = null, clearResize = null, manualSize = null, activeLevels = [];
  function clearToolbar() { toolbar?.remove(); toolbar = null; }
  function closePanel() {
    clearToolbar();
    closed = true; generation++;
    abort?.abort(); abort = null;
    if (timer) clearInterval(timer);
    timer = null;
    clearAnswer?.(); clearAnswer = null;
    clearDrag?.(); clearDrag = null;
    clearResize?.(); clearResize = null;
    activeLevels = [];
    panel?.remove(); panel = null;
  }
  function position(el, rect) {
    const margin = 8;
    el.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - el.offsetWidth - margin))}px`;
    const below = rect.bottom + 8;
    const reservedHeight = el.classList.contains("quick-ask-selection-panel") ? Math.min(window.innerHeight * .65, 600) : el.offsetHeight;
    el.style.top = `${Math.max(margin, Math.min(below, window.innerHeight - reservedHeight - margin))}px`;
  }
  function selectionToolbar() {
    if (!plugin.quickAsk.isRegistered()) { clearToolbar(); return; }
    const selection = doc.getSelection();
    const text = selection?.toString().trim();
    if (!text || !selection.rangeCount) { clearToolbar(); return; }
    const range = selection.getRangeAt(0);
    if (panel?.contains(range.startContainer) || panel?.contains(range.endContainer)) {
      const level = activeLevels.find(item => item.body.contains(range.startContainer) && item.body.contains(range.endContainer));
      if (!level || !level.answer()) { clearToolbar(); return; }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { clearToolbar(); return; }
      clearToolbar();
      toolbar = doc.createElement('div'); toolbar.className = 'quick-ask-selection-toolbar';
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = '继续解释';
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => { const history = activeLevels.map(item => ({ question: item.question, answer: item.answer(), suggestions: item.suggestions(), parentIndex: item.parentIndex, status: item.status() === 'running' ? 'stopped' : item.status() })); const parent = { question: level.question, answer: level.answer(), index: activeLevels.indexOf(level) }; clearToolbar(); void ask(text, rect, level.sourcePath, history, parent); });
      toolbar.appendChild(button); doc.body.appendChild(toolbar); position(toolbar, rect);
      return;
    }
    const element = node => node?.nodeType === 1 ? node : node?.parentElement;
    const start = element(range.startContainer)?.closest('.markdown-source-view, .markdown-preview-view');
    const end = element(range.endContainer)?.closest('.markdown-source-view, .markdown-preview-view');
    if (!start || start !== end || !start.closest('.workspace-leaf-content[data-type="markdown"]')) { clearToolbar(); return; }
    // Bind the selection to the leaf that owns it, not the currently active leaf.
    let sourcePath = null;
    plugin.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (view?.getViewType?.() === 'markdown' && view.file?.path &&
          view.containerEl?.contains(range.startContainer) && view.containerEl.contains(range.endContainer)) {
        sourcePath = view.file.path;
      }
    });
    if (!sourcePath) { clearToolbar(); return; }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) { clearToolbar(); return; }
    clearToolbar();
    toolbar = doc.createElement('div'); toolbar.className = 'quick-ask-selection-toolbar';
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'Ask for AI';
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => { clearToolbar(); void ask(text, rect, sourcePath); });
    toolbar.appendChild(button); doc.body.appendChild(toolbar); position(toolbar, rect);
  }
  async function ask(text, rect, sourcePath, history = [], parent = null, exploration = false) {
    // Preserve the reader's chosen position when switching to a new selection.
    const previousPosition = panel ? { left: panel.style.left, top: panel.style.top, maxHeight: panel.style.maxHeight } : null;
    closePanel(); closed = false; const current = generation;
    panel = doc.createElement('section'); panel.className = 'quick-ask-selection-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'quick-ask-selection-accessible-name');
    const label = doc.createElement('span'); label.id = 'quick-ask-selection-accessible-name'; label.className = 'quick-ask-selection-accessible-name'; label.textContent = '选中文字的解释';
    const header = doc.createElement('div'); header.className = 'quick-ask-selection-header';
    const close = doc.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closePanel);
    const save = doc.createElement('button'); save.type = 'button'; save.textContent = '保存'; save.className = 'quick-ask-selection-save';
    save.addEventListener('pointerdown', event => event.stopPropagation());
    save.addEventListener('click', async () => {
      const levels = activeLevels.map(item => ({ question: item.question, answer: item.answer(), parentIndex: item.parentIndex, status: item.status() }));
      save.disabled = true;
      try { const path = await saveSelectionConversation(plugin, sourcePath, levels); new Notice(`已保存到 ${path}`); }
      catch (error) { new Notice(`保存失败：${error?.message || error}`); }
      finally { save.disabled = false; }
    });
    header.append(close, label, save);
    clearDrag = installPanelDrag(panel, header, close);
    const content = doc.createElement('div'); content.className = 'quick-ask-selection-content';
    function makeColumn(question, getAnswer, initialSuggestions = [], parentIndex = null, getStatus = () => 'complete') {
      const column = doc.createElement('div'); column.className = 'quick-ask-selection-column';
      const selected = doc.createElement('div'); selected.className = 'quick-ask-selection-selected'; selected.textContent = `解释：${question}`;
      const searchStatus = doc.createElement('div'); searchStatus.className = 'quick-ask-selection-search-status'; searchStatus.setAttribute('role', 'status');
      selected.style.order = '0'; searchStatus.style.order = '1'; searchStatus.hidden = true;
      const body = doc.createElement('div'); body.className = 'quick-ask-selection-answer';
      let suggestionsData = initialSuggestions, suggestionPending = false;
      body.style.order = '2';
      const level = { body, sourcePath, question, answer: getAnswer, suggestions: () => suggestionsData, parentIndex, status: getStatus };
      const suggestions = doc.createElement('div'); suggestions.className = 'quick-ask-selection-suggestions'; suggestions.style.order = '3';
      function setSuggestions(items, final = false) {
        suggestionsData = Array.isArray(items) ? items : [];
        suggestions.replaceChildren();
        if (!suggestionsData.length) {
          const status = doc.createElement('span'); status.className = 'quick-ask-suggestions-status';
          status.textContent = final ? '探索建议生成失败' : '正在生成探索建议…';
          suggestions.appendChild(status);
          if (final && getAnswer()) { const retry = doc.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.addEventListener('click', () => void generateSuggestions()); suggestions.appendChild(retry); }
          return;
        }
        for (const prompt of suggestionsData) {
          const button = doc.createElement('button'); button.type = 'button'; button.textContent = prompt;
          button.addEventListener('pointerdown', event => event.stopPropagation());
          button.addEventListener('click', () => {
            const answer = level.answer();
            if (!answer || !activeLevels.includes(level)) return;
            const history = activeLevels.map(item => ({ question: item.question, answer: item.answer(), suggestions: item.suggestions(), parentIndex: item.parentIndex, status: item.status() === 'running' ? 'stopped' : item.status() }));
            const parent = { question: level.question, answer, index: activeLevels.indexOf(level) };
            const rect = column.getBoundingClientRect();
            clearToolbar(); void ask(prompt, rect, level.sourcePath, history, parent, true);
          });
          suggestions.appendChild(button);
        }
      }
      async function generateSuggestions() {
        if (suggestionPending || !level.answer() || !isCurrent()) return;
        suggestionPending = true; setSuggestions([], false);
        try {
          const task = suggestionQueue.then(() => isCurrent() ? requestSelectionSuggestions(plugin, level.question, level.answer(), controller.signal) : null);
          suggestionQueue = task.catch(() => {});
          const values = await task; if (isCurrent() && values) setSuggestions(values, true);
        }
        catch { if (isCurrent()) setSuggestions([], true); }
        finally { suggestionPending = false; }
      }
      setSuggestions(initialSuggestions, !!getAnswer());
      const followup = doc.createElement('div'); followup.className = 'quick-ask-selection-followup'; followup.style.order = '4';
      const input = doc.createElement('input'); input.type = 'text'; input.placeholder = '继续提问…'; input.setAttribute('aria-label', '继续提问');
      const send = doc.createElement('button'); send.type = 'button'; send.textContent = '发送';
      function refreshFollowup() { input.disabled = !level.answer(); send.disabled = !level.answer() || !String(input.value ?? '').trim(); }
      function submitFollowup() {
        const questionText = String(input.value ?? '').trim(), answer = level.answer();
        if (!questionText || !answer || !activeLevels.includes(level)) return;
        const history = activeLevels.map(item => ({ question: item.question, answer: item.answer(), suggestions: item.suggestions(), parentIndex: item.parentIndex, status: item.status() === 'running' ? 'stopped' : item.status() }));
        const parent = { question: level.question, answer, index: activeLevels.indexOf(level) };
        const rect = column.getBoundingClientRect();
        clearToolbar(); void ask(questionText, rect, level.sourcePath, history, parent, true);
      }
      input.addEventListener('input', refreshFollowup);
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submitFollowup(); } });
      send.addEventListener('click', submitFollowup);
      followup.append(input, send); refreshFollowup();
      column.append(selected, body, suggestions, followup, searchStatus); content.appendChild(column); activeLevels.push(level);
      return { body, searchStatus, setSuggestions, refreshFollowup, generateSuggestions };
    }
    const ancestors = history.map((entry, index) => {
      const column = makeColumn(entry.question, () => entry.answer, entry.suggestions ?? [], entry.parentIndex, () => entry.status || 'complete');
      return { ...column, entry };
    });
    let lastText = '', finalStatus = 'running';
    const currentColumn = makeColumn(text, () => lastText, [], parent?.index ?? null, () => finalStatus);
    const body = currentColumn.body; body.textContent = '正在等待 AI 回复…';
    const resizeHandle = doc.createElement('div'); resizeHandle.className = 'quick-ask-selection-resize';
    panel.append(header, content, resizeHandle); panel.style.width = `min(${460 * (history.length + 1)}px, calc(100vw - 16px))`;
    doc.body.appendChild(panel);
    if (previousPosition) {
      const left = Number.parseFloat(previousPosition.left);
      panel.style.left = `${Math.max(8, Math.min(Number.isFinite(left) ? left : 8, window.innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = previousPosition.top;
      if (previousPosition.maxHeight) panel.style.maxHeight = previousPosition.maxHeight;
    } else position(panel, rect);
    if (manualSize) {
      const width = Math.max(1, Math.min(manualSize.width, window.innerWidth - 16));
      const height = Math.max(1, Math.min(manualSize.height, window.innerHeight - 16));
      const left = Math.max(8, Math.min(Number.parseFloat(panel.style.left) || 8, window.innerWidth - width - 8));
      const top = Math.max(8, Math.min(Number.parseFloat(panel.style.top) || 8, window.innerHeight - height - 8));
      panel.dataset.userSized = 'true'; panel.style.width = `${width}px`; panel.style.height = `${height}px`;
      panel.style.left = `${left}px`; panel.style.top = `${top}px`;
      panel.style.maxHeight = `${window.innerHeight - top - 8}px`;
    }
    clearResize = installPanelResize(panel, resizeHandle, size => { manualSize = size; });
    let userScrolled = false;
    content.addEventListener('wheel', () => { userScrolled = true; }, { passive: true });
    content.addEventListener('touchstart', () => { userScrolled = true; }, { passive: true });
    content.scrollTop = content.scrollHeight;
    abort = new AbortController(); const controller = abort;
    const isCurrent = () => generation === current && !controller.signal.aborted;
    let polling = null, unsubscribeSearch = null;
    let suggestionQueue = Promise.resolve();
    for (const ancestor of ancestors) if (ancestor.entry.answer && !(ancestor.entry.suggestions?.length)) void ancestor.generateSuggestions();
    const ui = plugin.quickAsk.environment.ui;
    let displayed = null, requested = null, rendering = false, renderedText = '', renderTimer = null;
    const tail = doc.createElement('span'); tail.className = 'quick-ask-selection-stream-tail';
    function clearRendered(element) { if (element) ui.clear(element); }
    const ancestorRoots = new Set();
    clearAnswer = () => { if (renderTimer !== null) clearTimeout(renderTimer); renderTimer = null; unsubscribeSearch?.(); unsubscribeSearch = null; clearRendered(displayed); displayed = null; for (const root of ancestorRoots) clearRendered(root); ancestorRoots.clear(); };
    const ancestorPaints = [];
    for (const { body: ancestorBody, entry } of ancestors) {
      const root = doc.createElement('div'); root.className = 'markdown-rendered quick-ask-selection-markdown';
      ancestorRoots.add(root);
      ancestorPaints.push(ui.renderMarkdown(root, entry.answer || '已停止生成。', sourcePath).catch(() => { clearRendered(root); root.textContent = entry.answer || '已停止生成。'; }).then(() => {
        if (!isCurrent()) { clearRendered(root); ancestorRoots.delete(root); return; }
        ancestorBody.replaceChildren(root);
      }));
    }
    void Promise.all(ancestorPaints).then(() => { if (isCurrent() && !userScrolled) content.scrollTop = content.scrollHeight; });
    async function renderAnswer() {
      if (rendering || !isCurrent()) return;
      rendering = true;
      while (isCurrent() && requested !== null) {
        const markdown = requested; requested = null;
        const next = doc.createElement('div'); next.className = 'markdown-rendered quick-ask-selection-markdown';
        try { await ui.renderMarkdown(next, markdown, sourcePath); }
        catch { clearRendered(next); next.textContent = markdown; }
        if (!isCurrent()) { clearRendered(next); continue; }
        clearRendered(displayed); displayed = next; renderedText = markdown;
        tail.textContent = lastText.startsWith(renderedText) ? lastText.slice(renderedText.length) : lastText;
        body.replaceChildren(next, tail);
      }
      rendering = false;
    }
    function updateAnswer(text) {
      if (!text || text === lastText) return;
      const delta = text.startsWith(lastText) ? text.slice(lastText.length) : null;
      lastText = text;
      if (!displayed) body.replaceChildren(tail);
      if (delta === null) tail.textContent = text.startsWith(renderedText) ? text.slice(renderedText.length) : text;
      else if (delta) {
        const chunk = doc.createElement('span'); chunk.className = 'quick-ask-stream-chunk'; chunk.textContent = delta;
        tail.appendChild(chunk);
      }
      // Give incoming text time to fade in before replacing it with formatted Markdown.
      requested = text;
      if (renderTimer === null) renderTimer = setTimeout(() => { renderTimer = null; void renderAnswer(); }, 240);
    }
    try {
      const runtime = plugin.quickAsk.conversation;
      const { sessionConfigSnapshot } = require('../../src/quick-ask/settings');
      const session = await plugin.quickAsk.sessionStore.createSession({ config: sessionConfigSnapshot(plugin.settings.values().quickAsk), title: '选中文本解释' });
      if (!isCurrent()) return;
      await runtime.load(session.id);
      if (!isCurrent()) return;
      // Use the configured search route only when it is valid. Never claim to
      // have searched when the service is unavailable or no tool was called.
      let searchReady = false;
      try { searchReady = runtime.validateSearchForSend?.(session.id, true)?.valid === true; } catch {}
      currentColumn.searchStatus.hidden = false;
      currentColumn.searchStatus.textContent = searchReady ? '需要时可联网查证' : '联网搜索不可用；请在 Quick Ask 设置中检查搜索服务及密钥。将基于现有信息回答。';
      if (searchReady && typeof runtime.subscribe === 'function') {
        unsubscribeSearch = runtime.subscribe(session.id, value => {
          if (!isCurrent() || value?.projection?.kind !== 'search-status') return;
          const state = value.projection.status;
          if (state === 'running') currentColumn.searchStatus.textContent = '正在联网查证…';
          else if (state === 'complete') currentColumn.searchStatus.textContent = '联网查证完成';
          else if (state === 'failed') currentColumn.searchStatus.textContent = '联网查证失败；请检查搜索服务及网络。';
        });
      }
      // The file tracker handles reading, validation and model context framing.
      const tracker = plugin.quickAsk.trackerFor(session.id);
      const staged = tracker.stageFile(sourcePath);
      if (!staged?.staged) throw new Error('无法读取选区所属笔记');
      const additions = await tracker.mutationsForSend();
      if (!isCurrent()) return;
      if (!additions.some(item => item.kind === 'file' && item.path === sourcePath)) throw new Error('无法读取选区所属笔记');
      const startedAt = Date.now();
      polling = timer = setInterval(() => {
        if (!isCurrent()) return;
        const snapshot = runtime.snapshot(session.id);
        if (snapshot?.text) { updateAnswer(splitQuickAskOutput(snapshot.text).text); currentColumn.refreshFollowup(); }
        else if (snapshot?.reasoning) body.textContent = '模型正在处理，等待回答…';
        else if (Date.now() - startedAt > 30000) body.textContent = '模型仍在处理，请稍候；也可关闭此窗口取消。';
      }, 150);
      const parentContext = parent ? `\n\n上一级问题：${parent.question}\n上一级回答：${parent.answer}\n${exploration ? '请结合笔记和上一级回答回答探索问题。' : '请结合这段上一级回答解释其中选中的文字。'}` : '';
      const task = exploration ? '请直接回答以下探索问题' : '请解释以下选中文本';
      const structure = exploration ? '' : '请按三个方面组织回答：\n1. 是什么：解释概念、作用和含义。\n2. 为什么设计：说明设计目的以及有依据时的背景；如果该内容并非设计出来的事物，可解释其产生或使用的原因，不要编造历史。\n3. 如何用：说明使用方法或实际应用；若不适用则说明不适用。\n';
      const searchInstruction = searchReady ? '若笔记和已有知识不足以可靠回答，请先使用可用的联网搜索查证，再结合可靠来源作答；不要把整篇笔记或密钥作为搜索词，搜索失败或证据不足时要说明。' : '当前无法联网查证，不要声称已经搜索；如信息不足，请明确说明。';
      const result = await runtime.send(session.id, `${task}，使用与原文相同的语言。${structure}${searchInstruction}以已有信息为依据；如果信息不足，请明确指出，不要猜测。中文约 600 字，根据问题适当调整；其他语言保持相当详略。结构清晰，不要展示推理过程或列举无关含义。回答正文结束后另起一行，严格输出 <!--QA_SUGGESTIONS-->，紧接着输出一个 JSON 数组，包含三个根据本回答内容生成的具体简短后续问题；不要用代码围栏，不要输出其他文字：\n\n${text}${parentContext}`, { signal: controller.signal, additions, webSearch: searchReady, reasoning: "none", selectionFast: true });
      if (!isCurrent()) return;
      if (Array.isArray(result?.searchStatuses) && result.searchStatuses.some(status => status?.status === 'failed')) {
        currentColumn.searchStatus.textContent = '联网查证失败；请检查搜索服务及网络。';
      }
      finalStatus = result?.status === 'complete' || result?.status === 'completed' ? 'complete' : 'failed';
      clearInterval(polling); if (timer === polling) timer = null;
      const snapshot = runtime.snapshot(session.id);
      if (snapshot?.text) {
        const parsed = splitQuickAskOutput(snapshot.text, true);
        const display = splitQuickAskOutput(typeof result?.displayText === 'string' ? result.displayText : snapshot.text, true);
        let sources = [];
        if (Array.isArray(result?.sources) && result.sources.length) {
          const { normalizeSources } = require('../../src/quick-ask/web-search');
          sources = normalizeSources(result.sources);
        }
        const sourceList = sources.length ? '\n\n**来源**\n' + sources.map(source => {
          const title = String(source.title || source.url).replace(/[\\\[\]\r\n]/g, ' ').trim();
          const url = source.url.replace(/[()<>]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
          return `- [${title}](${url})`;
        }).join('\n') : '';
        updateAnswer((display.text || parsed.text) + sourceList);
        currentColumn.refreshFollowup(); currentColumn.setSuggestions(parsed.suggestions, true);
        if (!parsed.suggestions.length && parsed.text) void currentColumn.generateSuggestions();
      }
      else { currentColumn.setSuggestions([], true); body.textContent = result?.error?.message || (result?.errors ? '请检查 Quick Ask 的模型、API 地址和密钥设置。' : '') || '未能生成解释，请检查 Quick Ask 的模型和 API 设置。'; }
    } catch (error) {
      if (isCurrent()) {
        finalStatus = 'failed';
        if (polling) clearInterval(polling); if (timer === polling) timer = null;
        currentColumn.setSuggestions([], true); body.textContent = `生成解释失败：${error?.message || error}`;
      }
    }
  }
  const deferSelection = event => {
    if (toolbar?.contains(event.target)) return;
    if (panel?.contains(event.target)) { selectionToolbar(); return; }
    window.setTimeout(selectionToolbar, 0);
  };
  plugin.registerDomEvent(doc, 'mouseup', deferSelection);
  plugin.registerDomEvent(doc, 'keyup', event => { if (event.shiftKey || event.key === 'Escape') { if (event.key === 'Escape') { clearToolbar(); closePanel(); } else deferSelection(event); } });
  plugin.registerDomEvent(doc, 'scroll', clearToolbar, true);
  plugin.register(() => { clearToolbar(); closePanel(); });
}

class QuickAskSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.settings = plugin.settings;
    this.quickAskIntegration = plugin.quickAsk;
  }
  current() { return this.settings.values(); }
  getControlValue(key) {
    return key === 'language' ? this.current().language : quickAskControlValue(this.current(), key);
  }
  async setControlValue(key, value) {
    const patch = key === 'language' ? { language: value } : { quickAsk: quickAskControlPatch(key, value) };
    await this.settings.update(patch);
    if (key === 'quickAsk.enable') this.quickAskIntegration.syncEnabled();
    if (key === 'quickAsk.toolConcurrency') this.quickAskIntegration.refreshToolConcurrency();
    if (key.startsWith('quickAsk.display.') || key.startsWith('quickAsk.webSearch.') || key === 'language') this.quickAskIntegration.refreshAppearance();
    // Keep the custom capacity input mounted while the user types.
    if (key !== 'quickAsk.contextWindowTokens') this.update();
  }
  getSettingDefinitions() {
    const chinese = this.current().language === 'zh-CN';
    return [{
      name: chinese ? '界面语言' : 'Interface language',
      control: { type: 'dropdown', key: 'language', options: { en: 'English', 'zh-CN': '简体中文' } },
    }, {
      name: chinese ? '从 Scholar Workbench 切换' : 'Switching from Scholar Workbench',
      desc: chinese
        ? '建议关闭 Scholar Workbench 内置的快速提问。两者独立保存会话；可使用数据导出／导入迁移会话，并重新选择 API 密钥和模型。'
        : 'Disable Quick Ask inside Scholar Workbench when switching. History is stored separately; use Export/Import to transfer sessions and select your API secret and model again.',
    }, ...quickAskPage(this, SecretComponent).items];
  }
}

module.exports = class QuickAskPlugin extends Plugin {
  async onload() {
    this.settings = new QuickAskSettings(await this.loadData(), data => this.saveData(data));
    this.quickAsk = createQuickAsk({
      plugin: this,
      getSettings: () => this.settings.values(),
      loadEditorModules: () => ({ EditorView: require.desktop('@codemirror/view').EditorView, editorInfoField }),
    });
    this.quickAsk.sync();
    installSelectionAsk(this);
    const tab = new QuickAskSettingsTab(this.app, this);
    this.addSettingTab(tab);
    void this.quickAsk.refreshStorageSummary().then(() => tab.update()).catch(error => {
      console.error('Quick Ask: storage summary failed', error);
      new Notice(this.settings.values().language === 'zh-CN' ? '快速提问：无法读取会话存储信息。' : 'Quick Ask: could not read session storage information.');
    });
  }
};
