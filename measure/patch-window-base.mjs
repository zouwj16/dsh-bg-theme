#!/usr/bin/env node
/**
 * patch-window-base.mjs — give the Windows desktop window an opaque base colour.
 *
 * Why this exists: on Windows the desktop shell creates its main BrowserWindow
 * without a `backgroundColor`, so the native base stays Electron's default white.
 * Whenever Windows reveals the window before Chromium presents a frame — the
 * show / restore-from-minimized animation, or a surface re-created after the
 * window sat hidden in the tray — that white base is what you see. That is the
 * "white flash" when the window comes back from the taskbar or the tray.
 *
 * It cannot live in `client.js`: a DSH bundle plugin runs in the renderer/host
 * and can only override CSS tokens, so it can never reach the native window.
 * Two edits to `lib/main.js` inside the installed app.asar are needed:
 *
 *   1. the Windows primary window is created with `backgroundColor` — the same
 *      opaque sidebar fill the title-bar overlay already uses;
 *   2. `windowsAppearance` — the palette the renderer already measures through
 *      the desktop preload — also drives that base, so an installed theme
 *      plugin (this one included) recolours the flash instead of leaving it at
 *      the stock fallback.
 *
 * Both edits are byte-equal: every inserted byte is taken back out of the JSDoc
 * block above `chromeFallbackFill()`. `lib/main.js` therefore keeps its exact
 * length, every offset in the asar index stays valid, and the file is rewritten
 * in place with a matching SHA-256 in its own header. Nothing else changes, so a
 * running DSH keeps working and only needs a restart to pick the patch up.
 *
 * Usage (from this repository):
 *   node measure/patch-window-base.mjs                     # dry run: print the plan
 *   node measure/patch-window-base.mjs --apply             # patch + write the revert state
 *   node measure/patch-window-base.mjs --revert [--apply]  # restore the byte-exact backup
 *   node measure/patch-window-base.mjs --verify            # whole-archive integrity check
 *
 * Options: --asar <path>  --state <dir>  --force  --json  --help
 *
 * Zero dependencies, no DSH install required unless you actually patch or verify.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const TARGET = '/lib/main.js'
const DOC_FUNCTION = 'function chromeFallbackFill() {'

/** Replacement prose for the trimmed JSDoc; it must fit the budget the edits free. */
const DOC_PROSE = [
  '/**',
  '* Opaque chrome fill matching the built-in sidebar palette (the resolved',
  '* `--dsw-static-neutral-bluish-900` / `-50` tokens); it seeds the Windows',
  '* window base and the renderer keeps it in step with the live palette.',
  '* @returns the sidebar fill hex for the active system color scheme.',
].join('\n')

/**
 * The two shell edits. `insert` returns the rewritten source and the bytes it
 * added; `buildPlan` then proves the result by taking those bytes out again.
 */
const EDITS = [
  {
    id: 'window-base-at-creation',
    marker: 'backgroundColor: chromeFallbackFill(),',
    hint: 'Windows primary window gets an opaque base instead of white',
    insert(js) {
      const anchor = '...process.platform === "win32" && primary ? {\n'
      const at = uniqueIndex(js, anchor, 'the Windows primary-window options')
      const indent = leadingWhitespace(js, at + anchor.length)
      const text = `${indent}backgroundColor: chromeFallbackFill(),\n`
      const cut = at + anchor.length
      return { js: js.slice(0, cut) + text + js.slice(cut), at: cut, text }
    },
  },
  {
    id: 'window-base-follows-palette',
    marker: 'mainWindow.setBackgroundColor(color);',
    hint: 'the measured palette keeps the native base in step (theme plugins included)',
    insert(js) {
      const anchor = 'mainWindow.setTitleBarOverlay({'
      const at = uniqueIndex(js, anchor, 'the windowsAppearance title-bar call')
      const indent = leadingWhitespace(js, lineStart(js, at))
      const close = `\n${indent}});\n`
      const after = js.indexOf(close, at)
      if (after === -1) throw new Error('cannot find the end of the setTitleBarOverlay call')
      const cut = after + close.length
      const text = `${indent}mainWindow.setBackgroundColor(color);\n`
      return { js: js.slice(0, cut) + text + js.slice(cut), at: cut, text }
    },
  },
]

// ------------------------------------------------------------------ tiny tools
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const occurrences = (haystack, needle) => haystack.split(needle).length - 1
const uniqueIndex = (js, needle, what) => {
  const count = occurrences(js, needle)
  if (count !== 1) throw new Error(`expected exactly one ${what}, found ${count} (${JSON.stringify(needle)})`)
  return js.indexOf(needle)
}
const lineStart = (js, at) => js.lastIndexOf('\n', at) + 1
const leadingWhitespace = (js, at) => /^[\t ]*/.exec(js.slice(at))[0]

/**
 * Un-apply the edits on the patched text and require the byte-exact original
 * back. A byte-equal patch shifts everything between the two regions, so a
 * positional diff cannot prove anything; this can, and it is not circular.
 */
const verifyRoundTrip = (original, patched, inserted, docText, oldDocText) => {
  let work = patched
  for (const edit of inserted) {
    const seen = occurrences(work, edit.text)
    if (seen !== 1) throw new Error(`cannot undo ${edit.id}: its inserted bytes appear ${seen} times`)
    const at = work.indexOf(edit.text)
    work = work.slice(0, at) + work.slice(at + edit.text.length)
  }
  const docSeen = occurrences(work, docText)
  if (docSeen !== 1) throw new Error(`cannot undo the JSDoc rewrite: the new text appears ${docSeen} times`)
  const docAt = work.indexOf(docText)
  work = work.slice(0, docAt) + oldDocText + work.slice(docAt + docText.length)
  if (work !== original) throw new Error('the patched source differs from the original outside the intended edits')
}

// ---------------------------------------------------------------- asar reading
const readArchive = (buffer) => {
  if (buffer.length < 16) throw new Error('not an asar archive: too short')
  const pickleSize = buffer.readUInt32LE(4)
  const jsonLength = buffer.readUInt32LE(12)
  const headerLength = 8 + pickleSize
  const index = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString('utf8'))
  if (!index.files) throw new Error('not an asar archive: no file index')
  if (headerLength > buffer.length) throw new Error('not an asar archive: header runs past EOF')
  return { index, headerLength, jsonLength }
}

const findEntry = (node, prefix, wanted) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const full = `${prefix}/${name}`
    if (child.files) {
      const hit = findEntry(child, full, wanted)
      if (hit) return hit
    } else if (full === wanted) {
      return child
    }
  }
  return undefined
}

const collectEntries = (node, prefix, out) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const full = `${prefix}/${name}`
    if (child.files) collectEntries(child, full, out)
    else out.push([full, child])
  }
  return out
}

const readMember = (buffer, headerLength, entry) => {
  const offset = Number(entry.offset)
  const size = Number(entry.size)
  return buffer.subarray(headerLength + offset, headerLength + offset + size)
}

const blockHashes = (content, blockSize) => {
  const blocks = []
  for (let i = 0; i < content.length; i += blockSize) blocks.push(sha256(content.subarray(i, i + blockSize)))
  return blocks.length > 0 ? blocks : [sha256(content)]
}

// ------------------------------------------------------------------- planning
const locateDoc = (js) => {
  const fn = js.indexOf(DOC_FUNCTION)
  if (fn === -1) throw new Error(`cannot find ${DOC_FUNCTION}`)
  const close = js.lastIndexOf('*/', fn)
  const open = close === -1 ? -1 : js.lastIndexOf('/**', close)
  if (open === -1) throw new Error('cannot find the JSDoc block above chromeFallbackFill()')
  if (js.slice(close + 2, fn).trim() !== '') throw new Error('unexpected code between the JSDoc block and chromeFallbackFill()')
  return { start: open, end: close + 2 }
}

/**
 * Work out the patched source without touching anything on disk.
 * @param {string} original - current `lib/main.js` text.
 * @returns {{ patched: string, inserted: object[], alreadyApplied: string[], doc: object, docText: string, total: number }}
 */
const buildPlan = (original) => {
  let js = original
  const inserted = []
  const alreadyApplied = []
  for (const edit of EDITS) {
    if (js.includes(edit.marker)) {
      alreadyApplied.push(edit.id)
      continue
    }
    const result = edit.insert(js)
    inserted.push({ id: edit.id, hint: edit.hint, text: result.text })
    js = result.js
  }
  const total = inserted.reduce((sum, edit) => sum + edit.text.length, 0)
  const doc = locateDoc(js)
  if (total === 0) return { patched: original, inserted, alreadyApplied, doc, docText: js.slice(doc.start, doc.end), total }

  const docLength = doc.end - doc.start
  const target = docLength - total
  const pad = target - DOC_PROSE.length - 3 // the newline and `*/`, the padding rides the last prose line
  if (pad < 0) {
    throw new Error(
      `the JSDoc block above chromeFallbackFill() is ${docLength} bytes, ${-pad} short of the ${total} bytes these edits insert; shorten DOC_PROSE`,
    )
  }
  const docText = `${DOC_PROSE}${' '.repeat(pad)}\n*/`
  const patched = js.slice(0, doc.start) + docText + js.slice(doc.end)

  if (patched.length !== original.length) throw new Error(`patch is not byte-equal: ${original.length} -> ${patched.length}`)
  for (const edit of inserted) {
    const seen = occurrences(patched, edit.text)
    if (seen !== 1) throw new Error(`inserted bytes for ${edit.id} appear ${seen} times in the patched source`)
    edit.finalAt = patched.indexOf(edit.text)
  }
  verifyRoundTrip(original, patched, inserted, docText, js.slice(doc.start, doc.end))
  return { patched, inserted, alreadyApplied, doc, docText, total }
}

// --------------------------------------------------------------- archive write
const writeInPlace = (file, chunks) => {
  const handle = fs.openSync(file, 'r+')
  try {
    for (const { at, buffer } of chunks) fs.writeSync(handle, buffer, 0, buffer.length, at)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
}

const headerWithEntry = (headerBytes, entry, replacement) => {
  const before = Buffer.from(JSON.stringify(entry), 'utf8')
  const after = Buffer.from(JSON.stringify(replacement), 'utf8')
  if (before.length !== after.length) throw new Error('rewritten asar index entry changed length')
  const seen = occurrences(headerBytes.toString('latin1'), before.toString('latin1'))
  if (seen !== 1) throw new Error(`cannot locate the ${TARGET} index entry in the asar header (found ${seen})`)
  const at = headerBytes.indexOf(before)
  return Buffer.concat([headerBytes.subarray(0, at), after, headerBytes.subarray(at + before.length)])
}

// ----------------------------------------------------------------------- modes
const defaultAsar = () => {
  const candidates = [
    process.env.DSH_DESKTOP_ASAR,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
    process.env.HOME && path.join(process.env.HOME, 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar'),
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
  ].filter(Boolean)
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error(`cannot find app.asar; pass --asar <path> (looked at: ${candidates.join(', ')})`)
  return found
}

const loadArchive = (asar) => {
  const buffer = fs.readFileSync(asar)
  const { index, headerLength } = readArchive(buffer)
  const entry = findEntry(index, '', TARGET)
  if (!entry) throw new Error(`${TARGET} is not in ${asar}`)
  if (entry.unpacked || entry.offset === undefined) throw new Error(`${TARGET} is not stored in the archive`)
  const content = readMember(buffer, headerLength, entry).toString('utf8')
  return { buffer, index, headerLength, entry, content }
}

const describe = (asar, archive, plan) => {
  const lines = [`archive    ${asar}`, `member     ${TARGET} (${archive.content.length} chars, length preserved)`]
  if (plan.total === 0) lines.push('plan       nothing to do: every edit is already applied')
  else {
    for (const edit of plan.inserted) {
      lines.push(`insert     ${edit.id} (+${edit.text.length} bytes at ${TARGET} offset ${edit.finalAt})`)
      lines.push(`           ${JSON.stringify(edit.text.trim())}  — ${edit.hint}`)
    }
    lines.push(`trim       JSDoc above chromeFallbackFill(): ${plan.doc.end - plan.doc.start} -> ${plan.docText.length} bytes`)
  }
  if (plan.alreadyApplied.length > 0) lines.push(`already    ${plan.alreadyApplied.join(', ')}`)
  return lines.join('\n')
}

const summary = (mode, asar, extra) => JSON.stringify({ mode, asar, ...extra })

const modeApply = (options) => {
  const { asar } = options
  const archive = loadArchive(asar)
  const plan = buildPlan(archive.content)
  console.log(describe(asar, archive, plan))
  if (plan.total === 0) {
    console.log('\nnothing to apply (the archive already carries every edit)')
    if (options.json) console.log(summary('apply', asar, { inserted: [], alreadyApplied: plan.alreadyApplied, total: 0 }))
    return 0
  }

  const currentSha = sha256(Buffer.from(archive.content, 'utf8'))
  if (archive.entry.integrity && archive.entry.integrity.hash.toLowerCase() !== currentSha) {
    throw new Error('the asar header does not describe the current lib/main.js; refusing to patch an inconsistent archive')
  }
  const patched = Buffer.from(plan.patched, 'utf8')
  const afterSha = sha256(patched)
  const blockSize = Number(archive.entry.integrity?.blockSize ?? 4194304)
  const nextEntry = {
    ...archive.entry,
    integrity: { ...(archive.entry.integrity ?? {}), hash: afterSha, blocks: blockHashes(patched, blockSize) },
  }
  const header = headerWithEntry(archive.buffer.subarray(0, archive.headerLength), archive.entry, nextEntry)

  // Syntax gate: only a real parser counts, and it is optional so this stays dependency-free.
  const scratch = path.join(os.tmpdir(), `dsh-window-base-${process.pid}.mjs`)
  fs.writeFileSync(scratch, patched)
  const check = spawnSync(process.execPath, ['--check', scratch], { stdio: 'ignore' })
  fs.rmSync(scratch, { force: true })
  const syntax = check.error ? 'skipped (cannot spawn a child process here)' : check.status === 0 ? 'ok' : 'FAILED'
  console.log(`syntax     node --check ${syntax}`)
  if (syntax === 'FAILED') throw new Error('the patched lib/main.js does not parse; nothing was written')

  if (!options.apply) {
    console.log('\ndry run — nothing written. Re-run with --apply to patch the installed archive.')
    if (options.json) console.log(summary('apply', asar, { dryRun: true, inserted: plan.inserted.map((e) => e.id), total: plan.total }))
    return 0
  }

  const state = options.state
  const stateFile = path.join(state, 'state.json')
  if (fs.existsSync(stateFile)) {
    const recorded = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (!options.force && recorded.asarSize !== archive.buffer.length) {
      throw new Error(`the revert state in ${state} belongs to another archive (${recorded.asarSize} vs ${archive.buffer.length} bytes); pass --force to replace it`)
    }
  }
  fs.mkdirSync(state, { recursive: true })
  fs.writeFileSync(path.join(state, 'header.bin'), archive.buffer.subarray(0, archive.headerLength))
  fs.writeFileSync(path.join(state, 'main.js.bin'), Buffer.from(archive.content, 'utf8'))
  const dshPackage = findEntry(archive.index, '', '/dsh/package.json')
  let dshVersion = null
  try {
    dshVersion = dshPackage ? JSON.parse(readMember(archive.buffer, archive.headerLength, dshPackage).toString('utf8')).version : null
  } catch {
    dshVersion = null
  }
  const state$ = {
    format: 'dsh-bg-theme/window-base-backup@1',
    asar,
    asarSize: archive.buffer.length,
    headerLength: archive.headerLength,
    member: TARGET,
    offset: Number(archive.entry.offset),
    size: Number(archive.entry.size),
    beforeSha256: currentSha,
    afterSha256: afterSha,
    appliedAt: new Date().toISOString(),
    dshVersion,
  }
  fs.writeFileSync(stateFile, `${JSON.stringify(state$, null, 2)}\n`)

  writeInPlace(asar, [
    { at: 0, buffer: header },
    { at: archive.headerLength + Number(archive.entry.offset), buffer: patched },
  ])
  const verify = loadArchive(asar)
  if (sha256(Buffer.from(verify.content, 'utf8')) !== afterSha) throw new Error('read-back mismatch after writing; restore with --revert')
  console.log(`applied    ${asar}`)
  console.log(`state      ${state} (header.bin, main.js.bin, state.json)`)
  console.log('\nrestart DeepSeek Harness (tray icon → quit, then relaunch) for the patch to take effect.')
  console.log('a DSH update replaces app.asar: re-run --apply afterwards, and use --verify to check.')
  if (options.json) console.log(summary('apply', asar, { inserted: plan.inserted.map((e) => e.id), total: plan.total, afterSha256: afterSha }))
  return 0
}

const modeRevert = (options) => {
  const { asar } = options
  const stateFile = path.join(options.state, 'state.json')
  if (!fs.existsSync(stateFile)) throw new Error(`no revert state at ${stateFile}`)
  const state$ = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const header = fs.readFileSync(path.join(options.state, 'header.bin'))
  const mainJs = fs.readFileSync(path.join(options.state, 'main.js.bin'))
  const archive = loadArchive(asar)
  const currentSha = sha256(Buffer.from(archive.content, 'utf8'))

  if (currentSha === state$.beforeSha256) {
    console.log(`already pristine: ${asar} carries the original ${TARGET}`)
    return 0
  }
  if (currentSha !== state$.afterSha256) {
    throw new Error(
      `refusing to overwrite: ${TARGET} is neither the patched (${state$.afterSha256.slice(0, 12)}…) nor the original revision — the archive changed since the backup`,
    )
  }
  if (header.length !== state$.headerLength || archive.buffer.length !== state$.asarSize) {
    throw new Error('the archive is not the one this state was captured from; refusing to write')
  }
  if (!options.apply) {
    console.log(`revert plan: restore the header region (${header.length} bytes) and ${TARGET} (${mainJs.length} bytes) in ${asar}`)
    console.log('dry run — re-run with --revert --apply to write')
    return 0
  }
  writeInPlace(asar, [
    { at: 0, buffer: header },
    { at: state$.headerLength + state$.offset, buffer: mainJs },
  ])
  const verify = loadArchive(asar)
  if (sha256(Buffer.from(verify.content, 'utf8')) !== state$.beforeSha256) throw new Error('read-back mismatch after restoring')
  console.log(`restored   ${asar} (${TARGET} byte-identical to the pre-patch revision)`)
  console.log('restart DeepSeek Harness for the change to take effect')
  if (options.json) console.log(summary('revert', asar, { restored: true }))
  return 0
}

const modeVerify = (options) => {
  const archive = loadArchive(options.asar)
  const entries = collectEntries(archive.index, '', [])
  const checked = { files: 0, skipped: 0 }
  const bad = []
  for (const [name, entry] of entries) {
    const integrity = entry.integrity
    if (entry.offset === undefined || entry.unpacked || !integrity) {
      checked.skipped += 1
      continue
    }
    const content = readMember(archive.buffer, archive.headerLength, entry)
    const whole = sha256(content)
    const blocks = blockHashes(content, Number(integrity.blockSize))
    const ok = whole === integrity.hash.toLowerCase() && JSON.stringify(blocks) === JSON.stringify(integrity.blocks.map((b) => b.toLowerCase()))
    if (!ok) bad.push(name)
    checked.files += 1
  }
  const plan = buildPlan(archive.content)
  const patchState = plan.total === 0 ? 'both window-base edits present' : `missing: ${plan.inserted.map((e) => e.id).join(', ')}`
  console.log(`archive    ${options.asar} (${archive.buffer.length} bytes, ${entries.length} entries)`)
  console.log(`integrity  ${checked.files} stored files checked, ${checked.skipped} unpacked/no metadata, ${bad.length} mismatch(es)`)
  for (const name of bad.slice(0, 10)) console.log(`           ${name}`)
  console.log(`patch      ${patchState}`)
  if (options.json) {
    console.log(summary('verify', options.asar, { files: checked.files, skipped: checked.skipped, mismatches: bad, patch: plan.total === 0 ? 'applied' : 'missing' }))
  }
  return bad.length === 0 ? 0 : 1
}

// ------------------------------------------------------------------ self test
/**
 * The real JSDoc block (376 bytes, as shipped in 0.1.7) plus both anchor
 * regions, so the byte accounting and the round trip can be checked without an
 * installed Harness and without touching one.
 */
const FIXTURE = `/**
* Opaque chrome fallback matching the built-in sidebar palette (the resolved
* \`--dsw-static-neutral-bluish-900\` / \`-50\` tokens). An approximation for
* custom themes: Windows swaps in the renderer's measured palette over the
* windowsAppearance IPC, and macOS shows it only while minimized or hidden.
* @returns the sidebar fill hex for the active system color scheme.
*/
function chromeFallbackFill() {
\treturn nativeTheme.shouldUseDarkColors ? "#1b1b1c" : "#f9fafb";
}
function createWindow(preload, show = false, primary = false) {
\tconst window = new BrowserWindow({
\t\tshow,
\t\t...process.platform === "win32" && primary ? {
\t\t\ttitleBarStyle: "hidden",
\t\t\ttitleBarOverlay: {
\t\t\t\theight: 40,
\t\t\t\tcolor: chromeFallbackFill(),
\t\t\t\tsymbolColor: "#0f1115"
\t\t\t}
\t\t} : {},
\t\twebPreferences: {}
\t});
}
ipcMain.on(DESKTOP_IPC.windowsAppearance, (event, language, color, symbolColor) => {
\tif (process.platform === "win32") {
\t\tconst validColor = (value) => typeof value === "string";
\t\tif (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({
\t\t\tcolor,
\t\t\tsymbolColor
\t\t});
\t}
});
`

const modeSelfTest = () => {
  const checks = []
  const expect = (label, ok, detail = '') => checks.push({ label, ok, detail })
  const ids = EDITS.map((edit) => edit.id).join(',')
  const first = buildPlan(FIXTURE)
  expect('fixture looks like a pristine archive', first.alreadyApplied.length === 0)
  expect('both edits are planned', first.inserted.map((edit) => edit.id).join(',') === ids)
  expect('the patched source keeps its length', first.patched.length === FIXTURE.length, `${FIXTURE.length} -> ${first.patched.length}`)
  expect('every marker is present afterwards', EDITS.every((edit) => first.patched.includes(edit.marker)))
  expect('the fixture doc block is the shipped 376-byte one', first.doc.end - first.doc.start === 376, `${first.doc.end - first.doc.start} bytes`)
  expect('the doc block absorbs exactly the inserted bytes', first.docText.length === 376 - first.total, `${first.docText.length} bytes for ${first.total} inserted`)

  const second = buildPlan(first.patched)
  expect('a patched source is recognised as patched', second.total === 0 && second.alreadyApplied.length === 2)
  expect('re-planning is a no-op', second.patched === first.patched)

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.label}${check.detail ? ' — ' + check.detail : ''}`)
  if (failed.length > 0) return 1
  console.log(`\nself-test passed (${checks.length} checks, ${first.total} inserted bytes, doc 376 -> ${first.docText.length})`)
  return 0
}

// ------------------------------------------------------------------------- cli
const HELP = `patch-window-base.mjs — opaque native window base for the Windows desktop shell

  node measure/patch-window-base.mjs [--apply] [--revert] [--verify] [options]

  (no flags)      dry run: print the plan, write nothing
  --apply         write the patch (and the revert state) into app.asar
  --revert        restore app.asar from the revert state
  --verify        check every stored file against its SHA-256 in the asar header
  --self-test     check this script against a built-in fixture (no install needed)
  --asar <path>   archive to patch (default: the installed DeepSeek Harness)
  --state <dir>   where the revert state lives (default: <asar>.window-base-backup)
  --force         replace an existing revert state that belongs to another archive
  --json          also print a machine-readable summary
  --help          this text
`

const main = () => {
  const argv = process.argv.slice(2)
  const take = (flag) => {
    const at = argv.indexOf(flag)
    if (at === -1) return undefined
    const value = argv[at + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    argv.splice(at, 2)
    return value
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    return 0
  }
  if (argv.includes('--self-test')) return modeSelfTest()
  const asar = path.resolve(take('--asar') ?? defaultAsar())
  const state = path.resolve(take('--state') ?? `${asar}.window-base-backup`)
  const flags = ['--apply', '--revert', '--verify', '--force', '--json']
  const options = {
    asar,
    state,
    apply: argv.includes('--apply'),
    revert: argv.includes('--revert'),
    verify: argv.includes('--verify'),
    force: argv.includes('--force'),
    json: argv.includes('--json'),
  }
  const unknown = argv.filter((arg) => arg.startsWith('--') && !flags.includes(arg))
  if (unknown.length > 0) throw new Error(`unknown option(s): ${unknown.join(', ')} (see --help)`)
  if (!fs.existsSync(asar)) throw new Error(`no such archive: ${asar}`)

  if (options.verify) return modeVerify(options)
  if (options.revert) return modeRevert(options)
  return modeApply(options)
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
}
