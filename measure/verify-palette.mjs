#!/usr/bin/env node
/**
 * Self-contained checks for this bundle plugin. No dependencies, no DSH install
 * required: run `node measure/verify-palette.mjs` from anywhere.
 *
 * It covers what can be judged from this repository alone:
 *   1. the manifest declares a web Client half and a bundle patch
 *   2. client.js registers exactly one lazy factory whose id is the package name
 *   3. apply() hands the theme service a `{ light, dark }` string pair per token
 *   4. every token name is a --dsw-* custom property and every value is 6- or
 *      8-digit hex
 *   5. the patch inserts exactly one row, named after this package
 *   6. the locale dictionaries agree on their key set and the icon exists
 *   7. README's palette table matches client.js exactly (no hand-typed drift)
 *   8. the enabled CI workflow is the same file as its shipped template
 *
 * What it cannot check without a DSH installation: whether each token name
 * really exists in the product's stylesheets, and whether the alpha of a
 * translucent tint matches the stock value. Those live in the maintainer's
 * harness, which reads the installed app.asar.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const notes = []
const check = (label, ok, detail = '') => {
  if (ok) notes.push(`PASS  ${label}${detail ? ' — ' + detail : ''}`)
  else failures.push(`FAIL  ${label}${detail ? ' — ' + detail : ''}`)
}
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))

// ---------------------------------------------------------------- 1. manifest
const manifest = read('package.json')
check('name is a package name', typeof manifest.name === 'string' && manifest.name.includes('/'), manifest.name)
check('exports "./client"', manifest.exports?.['./client'] === './client.js')
check('exports "./package.json"', manifest.exports?.['./package.json'] === './package.json')
check('dsh.bundle.patch declared', typeof manifest.dsh?.bundle?.patch === 'string', manifest.dsh?.bundle?.patch)
check('dsh.client.platform is web', manifest.dsh?.client?.platform === 'web')
check('dsh.client activates immediately', manifest.dsh?.client?.immediately === true)
check(
  'dsh.client.inject orders after the theme plugin',
  Array.isArray(manifest.dsh?.client?.inject) && manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-theme'),
  JSON.stringify(manifest.dsh?.client?.inject),
)
check('no runtime dependencies', !manifest.dependencies || Object.keys(manifest.dependencies).length === 0)
if (manifest.icon) check('declared icon exists', fs.existsSync(path.join(root, manifest.icon)), manifest.icon)

// ---------------------------------------------------- 2. client factory module
const loaded = []
globalThis.window = { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }
await import(pathToFileURL(path.join(root, 'client.js')).href)
check('client.js registers exactly one module', loaded.length === 1, `loaded=${loaded.length}`)
const entry = loaded[0] ?? {}
check('module id equals the package name', entry.id === manifest.name, `${entry.id} vs ${manifest.name}`)
const plugin = typeof entry.factory === 'function' ? entry.factory() : undefined
check('plugin injects the theme service', JSON.stringify(plugin?.inject) === '["theme"]', JSON.stringify(plugin?.inject))
check('plugin exposes apply()', typeof plugin?.apply === 'function')

// ------------------------------- 3./4. payload shape against the service contract
let captured = null
let disposed = 0
const ctx = {
  effect(fn) {
    const disposer = fn()
    if (typeof disposer === 'function') disposer()
    return disposer
  },
  theme: {
    overrideTokens(source, tokens) {
      captured = { source, tokens }
      for (const [name, value] of Object.entries(tokens)) {
        if (typeof value === 'string') throw new TypeError(`bare string for ${name}`)
        if (typeof value !== 'object' || value === null) throw new TypeError(`non-object for ${name}`)
        if (typeof value.light !== 'string' || typeof value.dark !== 'string') throw new TypeError(`incomplete pair for ${name}`)
      }
      return () => {
        disposed += 1
      }
    },
  },
}
let applyError = null
try {
  plugin.apply(ctx)
} catch (error) {
  applyError = error
}
check('apply() runs without throwing', applyError === null, applyError?.message ?? '')
check('apply() stacks exactly one override layer', captured !== null)
check('override layer source is the module id', captured?.source === entry.id, captured?.source)
check('layer is disposable through the effect teardown', disposed === 1, `disposed=${disposed}`)

const tokens = captured?.tokens ?? {}
const names = Object.keys(tokens)
const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i
check('palette is non-empty', names.length > 0, `${names.length} tokens`)
check('every token is a --dsw-* custom property', names.every((n) => n.startsWith('--dsw-')))
check('every value is a 6- or 8-digit hex in both schemes', names.every((n) => HEX.test(tokens[n].light) && HEX.test(tokens[n].dark)))
// Alpha-carrying tints are the ones that must keep their stock alpha; this check
// can only list them, the stock comparison needs the installed stylesheets.
const alphaTints = names.filter((n) => HEX.exec(tokens[n].light)[2] !== undefined || HEX.exec(tokens[n].dark)[2] !== undefined)
notes.push(`NOTE  ${alphaTints.length} token(s) carry an alpha channel: ${alphaTints.join(', ') || '(none)'}`)

// -------------------------------------------------------------- 5. bundle patch
const patch = fs.readFileSync(path.join(root, manifest.dsh.bundle.patch), 'utf8')
check('patch has one insert list', (patch.match(/^- insert:/gm) ?? []).length === 1)
check('patch names this package', patch.includes(`name: '${manifest.name}'`) || patch.includes(`name: "${manifest.name}"`), manifest.name)
const rowId = patch.match(/^\s*- id: ([\w-]+)/m)?.[1]
check('patch declares a row id', typeof rowId === 'string' && rowId.length > 0, rowId)

// ------------------------------------------------------------------ 6. locales
const localeDir = path.join(root, 'locale')
const localeFiles = fs.existsSync(localeDir) ? fs.readdirSync(localeDir).filter((f) => f.endsWith('.json')) : []
check('at least two locales', localeFiles.length >= 2, localeFiles.join(', '))
const dicts = localeFiles.map((f) => JSON.parse(fs.readFileSync(path.join(localeDir, f), 'utf8')))
check('each locale carries meta.title and meta.description', dicts.every((d) => d.meta?.title && d.meta?.description))
check(
  'locales agree on their key set',
  new Set(dicts.map((d) => JSON.stringify(Object.keys(d.meta ?? {}).sort()))).size === 1,
)

// ------------------------------------------------- 7. README stays in sync
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const rows = [...readme.matchAll(/^\| `(--dsw-[\w-]+)` \|[^|]*\| `(#[0-9a-f]{6,8})` \|[^|]*\| `(#[0-9a-f]{6,8})` \|$/gmi)]
const documented = new Map(rows.map(([, name, light, dark]) => [name, { light, dark }]))
check('README documents every palette token', documented.size === names.length, `${documented.size} rows vs ${names.length} tokens`)
const drifted = names.filter((n) => !documented.has(n) || documented.get(n).light !== tokens[n].light || documented.get(n).dark !== tokens[n].dark)
check('README hex values match client.js', drifted.length === 0, drifted.join(', '))
check('README names the install targets', /github\.com\/[\w-]+\/[\w-]+/.test(readme), 'install spec present')

// ------------------------------------------- 8. CI workflow matches its template
// The workflow is enabled at .github/workflows/verify.yml while measure/ci-verify.yml
// stays as the copy other repositories start from; they must not drift apart. The
// check is skipped where the workflow is absent (a packed tarball, a fork without it).
const workflowPath = path.join(root, '.github', 'workflows', 'verify.yml')
if (fs.existsSync(workflowPath)) {
  const template = fs.readFileSync(path.join(root, 'measure', 'ci-verify.yml'), 'utf8')
  check('the CI workflow is the same file as its template', fs.readFileSync(workflowPath, 'utf8') === template)
}

// ------------------------------------------------------------------- report
console.log(notes.join('\n'))
if (failures.length > 0) {
  console.error('\n' + failures.join('\n'))
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`\nall ${notes.filter((n) => n.startsWith('PASS')).length} checks passed (${names.length} tokens)`)
