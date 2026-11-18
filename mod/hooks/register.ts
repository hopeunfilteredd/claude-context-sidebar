import type { Register } from 'claude-code'

// Context Sidebar feed. After every reply this writes one tiny file per chat,
//   <claude folder>/context-meter/live/<chat id>.json  ->  { id, tokens, window, percent, updated }
// which the Claude Context Sidebar VS Code extension reads to show the chat's exact window.
// It reads and writes only inside your own Claude folder, never sends anything anywhere, and can never
// break or slow a chat: every step is wrapped, and a failure just means no file is written.

const TAIL_BYTES = 800 * 1024

// The Claude folder, taken from the chat's own file: <claude>/projects/<project>/<id>.jsonl
async function claudeDir($: any): Promise<string | null> {
  const { transcriptPath } = await $.session.info()
  const at = transcriptPath ? String(transcriptPath).lastIndexOf('/projects/') : -1
  return at > 0 ? String(transcriptPath).slice(0, at) : null
}

async function publish($: any, tokens: number, window: number) {
  try {
    const dir = await claudeDir($)
    if (!dir || !window) return
    const id = await $.session.id()
    const percent = Math.round((tokens / window) * 100)
    await $.fs.write(`${dir}/context-meter/live/${id}.json`, JSON.stringify({ id, tokens, window, percent, updated: Date.now() }))
  } catch {}
}

// After a reload or resume the engine reports nothing until the next reply, so read the last reply's size from
// the chat's own saved file (the last reply that is not a sub-agent's).
async function seed($: any) {
  try {
    const u = await $.session.usage()
    const window: number = u.context.window
    let tokens: number | undefined = u.context.tokens
    if (tokens === undefined) {
      const { transcriptPath } = await $.session.info()
      if (!transcriptPath) return
      const { size } = await $.fs.stat(transcriptPath)
      const length = Math.min(size, TAIL_BYTES)
      const lines = String(await $.fs.read(transcriptPath, { offset: size - length, length })).split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        let j: any
        try { j = JSON.parse(lines[i] ?? '') } catch { continue }
        const use = j && j.type === 'assistant' && !j.isSidechain && j.message && j.message.usage
        if (use) {
          tokens = (use.input_tokens || 0) + (use.cache_creation_input_tokens || 0) + (use.cache_read_input_tokens || 0)
          break
        }
      }
    }
    if (tokens !== undefined) await publish($, tokens, window)
  } catch {}
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void seed($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const c = e.context
    if (c.tokens !== undefined) await publish($, c.tokens, c.window)
    return next(e)
  })
}
