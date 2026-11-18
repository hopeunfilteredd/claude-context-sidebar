// Claude Context Sidebar: every Claude Code chat in this workspace, with its context fill, in the Claude Code sidebar.
// Reads only local files under ~/.claude; nothing is sent anywhere.
// Titles and token counts come from each chat's saved file (~/.claude/projects/<workspace>/<id>.jsonl).
// The context-meter mod's files (~/.claude/context-meter/live/<id>.json) give the exact window where present.
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const CLAUDE = path.join(os.homedir(), '.claude')
const LIVE = path.join(CLAUDE, 'context-meter', 'live')
const MAX_CHATS = 12
const cfg = () => vscode.workspace.getConfiguration('contextMeter')
const TAIL_BYTES = 800 * 1024         // the end of a chat file holds its latest usage and title
const AMBER = () => cfg().get('amberAt', 60)
const RED = () => cfg().get('redAt', 80)

const projectDir = () => {
  const f = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
  return f ? path.join(CLAUDE, 'projects', f.uri.fsPath.replace(/[^a-zA-Z0-9]/g, '-')) : null
}

function tail(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const n = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, size - n)
    return buf.toString('utf8').split('\n')
  } finally { fs.closeSync(fd) }
}

function readChat(file) {
  let tokens = null, custom = null, ai = null, model = null
  const lines = tail(file)
  for (let i = lines.length - 1; i >= 0 && (tokens === null || (custom === null && ai === null)); i--) {
    const line = lines[i]
    if (!line) continue
    let j
    try { j = JSON.parse(line) } catch { continue }
    if (custom === null && j.type === 'custom-title' && j.customTitle) custom = j.customTitle
    else if (ai === null && j.type === 'ai-title' && j.aiTitle) ai = j.aiTitle
    else if (tokens === null && j.type === 'assistant' && !j.isSidechain && j.message && j.message.usage) {
      const u = j.message.usage
      tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
      model = j.message.model
    }
  }
  return { tokens, title: custom || ai, model }
}

const compactCache = new Map()   // file -> { pos, count, last }
function compactions(file) {
  let c = compactCache.get(file) || { pos: 0, count: 0, last: null }
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    if (size < c.pos) c = { pos: 0, count: 0, last: null }       // file was rewritten: start over
    let carry = ''
    while (c.pos < size) {
      const n = Math.min(1 << 20, size - c.pos)
      const buf = Buffer.alloc(n)
      fs.readSync(fd, buf, 0, n, c.pos)
      const text = carry + buf.toString('utf8')
      const cut = text.lastIndexOf('\n')
      if (cut < 0 && c.pos + n < size) { carry = text; c.pos += n; continue }
      const whole = cut < 0 ? text : text.slice(0, cut)
      carry = cut < 0 ? '' : text.slice(cut + 1)
      for (const line of whole.split('\n')) {
        if (!line.includes('compact_boundary')) continue
        try {
          const j = JSON.parse(line)
          if (j.type === 'system' && j.subtype === 'compact_boundary') { c.count++; c.last = j.compactMetadata || null }
        } catch {}
      }
      c.pos += n - Buffer.byteLength(carry)
      if (cut < 0) break
    }
  } finally { fs.closeSync(fd) }
  compactCache.set(file, c)
  return c
}

function liveWindow(id) {
  try { return JSON.parse(fs.readFileSync(path.join(LIVE, id + '.json'), 'utf8')).window } catch { return null }
}

function readChats() {
  const dir = projectDir()
  if (!dir || !fs.existsSync(dir)) return []
  const out = []
  let hidden = null
  try { const pat = cfg().get('hideTitlesMatching', ''); if (pat) hidden = new RegExp(pat, 'i') } catch {}
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    const file = path.join(dir, f)
    let st
    try { st = fs.statSync(file) } catch { continue }
    if (Date.now() - st.mtimeMs > cfg().get('maxAgeHours', 36) * 3600 * 1000) continue
    try {
      const c = readChat(file)
      if (c.tokens === null) continue          // no reply yet: nothing to measure
      if (hidden && hidden.test(c.title || '')) continue
      const id = f.slice(0, -6)
      const exact = liveWindow(id)
      const assumed = cfg().get('assumedWindow', 0)
      const window = exact || (assumed > 0 ? (c.tokens > assumed ? Math.max(1000000, assumed) : assumed) : null)
      let comp = { count: 0, last: null }
      try { comp = compactions(file) } catch {}
      out.push({ id, title: c.title || 'Untitled chat', tokens: c.tokens, window, estimated: !exact, updated: st.mtimeMs,
        percent: window ? Math.round((c.tokens / window) * 100) : null, compacted: comp.count, lastCompact: comp.last })
    } catch {}
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS)
}

const activeLabel = () => {
  try { const t = vscode.window.tabGroups.activeTabGroup.activeTab; return t ? t.label : '' } catch { return '' }
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const isActive = (title, label) => { const a = norm(title), b = norm(label); return !!b && (a === b || a.startsWith(b) || b.startsWith(a)) }

const k = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1000) + 'k')
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function card(c, here, big) {
  if (!c.window) {
    return `<div class="row${here ? ' here' : ''}"><div class="title" title="${esc(c.title)}">${here ? '<i></i>' : ''}${esc(c.title)}</div>
<div class="sub"><span>${k(c.tokens)} tokens used · window size unknown</span>${c.compacted ? `<span class="chip">↻ compacted ${c.compacted}×</span>` : ''}</div></div>`
  }
  const p = Math.max(0, c.percent), shown = Math.min(100, p)
  const level = p >= RED() ? 'red' : p >= AMBER() ? 'amber' : 'ok'
  const lc = c.lastCompact
  const tip = c.compacted ? `Compacted ${c.compacted} time${c.compacted > 1 ? 's' : ''}` +
    (lc && lc.preTokens ? `. Last: ${lc.trigger || ''} ${k(lc.preTokens)} to ${k(lc.postTokens || 0)}` : '') : ''
  return `<div class="row ${level}${here ? ' here' : ''}${big ? ' big' : ''}">
<div class="title" title="${esc(c.title)}">${here ? '<i></i>' : ''}${esc(c.title)}</div>
<div class="meter"><div class="bar"><div style="width:${shown}%"></div></div><b>${p}%</b></div>
<div class="sub"><span>${k(c.tokens)} of ${c.estimated ? '~' : ''}${k(c.window)} · ${k(Math.max(0, c.window - c.tokens))} left</span>${c.compacted ? `<span class="chip" title="${esc(tip)}">↻ compacted ${c.compacted}×</span>` : ''}</div>
${p >= RED() ? '<div class="warn">Getting full. Wrap up before a heavy step.</div>' : ''}</div>`
}

function html(mode) {
  const label = activeLabel()
  const chats = readChats()
  const current = chats.find(c => isActive(c.title, label))
  let body
  if (mode === 'this') {
    const c = current || chats[0]
    body = c ? card(c, !!current, true) + (current ? '' : '<div class="note">Showing the latest chat; no open tab matched a chat.</div>')
             : (projectDir() ? 'No chat with a reply yet.' : 'Open a folder to see its Claude Code chats.').replace(/^/, '<div class="empty">').concat('</div>')
    if (c && c.estimated && c.window) body += '<div class="note">~ window assumed (see the contextMeter.assumedWindow setting).</div>'
  } else {
    body = (chats.map(c => card(c, current === c, false)).join('') || (projectDir() ? 'No chat with a reply yet.' : 'Open a folder to see its Claude Code chats.').replace(/^/, '<div class="empty">').concat('</div>'))
    if (chats.some(c => c.estimated && c.window)) body += '<div class="note">~ window assumed (see the contextMeter.assumedWindow setting).</div>'
  }
  if (chats.some(c => !c.window)) body += `<div class="ask">Claude Code does not record how big your context window is, so the percentages cannot be shown yet.<button onclick="vs.postMessage({cmd:'setWindow'})">Tell it my window size</button></div>`
  const seg = (m, name) => `<button class="${mode === m ? 'on' : ''}" onclick="vs.postMessage({mode:'${m}'})">${name}</button>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--ok:var(--vscode-charts-blue);--amber:var(--vscode-editorWarning-foreground);--red:var(--vscode-errorForeground)}
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:4px 8px 10px;font-size:12px;line-height:1.35}
.seg{display:flex;gap:0;margin:2px 0 10px;border:1px solid color-mix(in srgb,var(--vscode-foreground) 22%,transparent);border-radius:6px;overflow:hidden}
.seg button{flex:1;font:inherit;color:inherit;background:transparent;border:0;padding:5px 6px;cursor:pointer;opacity:.7}
.seg button.on{background:color-mix(in srgb,var(--vscode-foreground) 16%,transparent);opacity:1;font-weight:600}
.row{padding:6px 8px;margin:0 0 5px;border-radius:6px;border:1px solid transparent;background:color-mix(in srgb,var(--vscode-foreground) 5%,transparent)}
.row.here{border-color:color-mix(in srgb,var(--c) 55%,transparent);background:color-mix(in srgb,var(--c) 10%,transparent)}
.ok{--c:var(--ok)}.amber{--c:var(--amber)}.red{--c:var(--red)}
.title{font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;margin-bottom:5px}
.here .title{font-weight:700}
.title i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c);margin-right:6px;vertical-align:middle}
.meter{display:flex;align-items:center;gap:7px}
.bar{flex:1;height:5px;border-radius:3px;background:color-mix(in srgb,var(--vscode-foreground) 16%,transparent);overflow:hidden}
.bar div{height:100%;border-radius:3px;background:var(--c)}
b{color:var(--c);font-variant-numeric:tabular-nums;font-size:12px;min-width:2.4em;text-align:right}
.sub{display:flex;flex-wrap:wrap;gap:2px 8px;opacity:.7;margin-top:4px;font-size:11px;font-variant-numeric:tabular-nums}
.chip{opacity:.95;border:1px solid color-mix(in srgb,var(--vscode-foreground) 30%,transparent);border-radius:9px;padding:0 6px}
.big{padding:8px 9px}.big .bar{height:7px;border-radius:4px}.big .bar div{border-radius:4px}.big .title{-webkit-line-clamp:3;font-size:13px}
.ask{margin-top:8px;padding:8px;border-radius:6px;background:color-mix(in srgb,var(--vscode-foreground) 8%,transparent);font-size:11px;line-height:1.4}.ask button{display:block;margin-top:6px;font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:4px;padding:4px 10px;cursor:pointer}
.warn{margin-top:5px;color:var(--c);font-size:11px}
.note,.empty{opacity:.55;font-size:11px;margin-top:6px}
</style></head><body><div class="seg">${seg('this', 'This chat')}${seg('all', 'All chats')}</div>${body}
<script>const vs=acquireVsCodeApi()</script></body></html>`
}

function activate(ctx) {
  const views = new Set()
  let mode = ctx.globalState.get('contextMeter.mode', 'all')
  const refresh = () => { const h = html(mode); for (const v of views) v.webview.html = h }
  for (const id of ['contextMeter.inSidebar', 'contextMeter.inSessions', 'contextMeter.inSecondary', 'contextMeter.own']) {
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(id, {
      resolveWebviewView(view) {
        views.add(view)
        view.webview.options = { enableScripts: true }
        view.onDidDispose(() => views.delete(view))
        view.webview.onDidReceiveMessage(m => {
          if (m && (m.mode === 'this' || m.mode === 'all')) { mode = m.mode; ctx.globalState.update('contextMeter.mode', mode); refresh() }
          if (m && m.cmd === 'setWindow') vscode.commands.executeCommand('contextMeter.setWindow')
        })
        view.webview.html = html(mode)
      },
    }))
  }
  ctx.subscriptions.push(vscode.commands.registerCommand('contextMeter.setWindow', async () => {
    const pick = await vscode.window.showQuickPick([
      { label: '200,000 tokens', description: 'standard window', value: 200000 },
      { label: '1,000,000 tokens', description: 'the 1M window', value: 1000000 },
      { label: 'Another size...', value: -1 },
    ], { title: 'How big is your Claude Code context window?', placeHolder: 'Check with /context in a chat: its first line shows used / window' })
    if (!pick) return
    let v = pick.value
    if (v === -1) {
      const t = await vscode.window.showInputBox({ prompt: 'Context window in tokens (for example 500000)', validateInput: x => (/^\d{4,8}$/.test(x) ? null : 'Enter a number of tokens') })
      if (!t) return
      v = Number(t)
    }
    await cfg().update('assumedWindow', v, vscode.ConfigurationTarget.Global)
    refresh()
  }))
  vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('contextMeter')) refresh() }, null, ctx.subscriptions)
  // First run: if nothing tells us the window, ask once instead of guessing.
  setTimeout(() => {
    try {
      const known = cfg().get('assumedWindow', 0) > 0 || (fs.existsSync(LIVE) && fs.readdirSync(LIVE).length > 0)
      if (!known && !ctx.globalState.get('contextMeter.asked')) {
        ctx.globalState.update('contextMeter.asked', true)
        vscode.window.showInformationMessage('Claude Context Sidebar: how big is your Claude Code context window? It cannot be read from disk, and a wrong guess would show wrong percentages.', 'Tell it now', 'Later')
          .then(a => { if (a === 'Tell it now') vscode.commands.executeCommand('contextMeter.setWindow') })
      }
    } catch {}
  }, 4000)
  let wait = null
  const soon = () => { clearTimeout(wait); wait = setTimeout(refresh, 250) }
  ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(soon), vscode.window.tabGroups.onDidChangeTabGroups(soon))
  const dir = projectDir()
  if (dir && fs.existsSync(dir)) { try { const w = fs.watch(dir, soon); ctx.subscriptions.push({ dispose: () => w.close() }) } catch {} }
  const timer = setInterval(refresh, 10000)
  ctx.subscriptions.push({ dispose: () => { clearInterval(timer); clearTimeout(wait) } })
}
function deactivate() {}
module.exports = { activate, deactivate }
