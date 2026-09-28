/**
 * Reproduce the Host's bundle revision for one client entry, so the served
 * bytes can be checked without going through the browser.
 *
 * From @deepseek-ai/dsh-client-modules/lib/index.js:
 *   shortHash(input)            = sha1(input).hex.slice(0, 12)
 *   framedHash(domain, parts)   = sha1(domain + "\0" + Σ(`${len(part)}:${part}`)).hex.slice(0, 12)
 *   artifactRevision(baseline)  = framedHash("plugin-artifact", [mtimeMs, ctimeMs, size])
 *   comboRevision(resources)    = framedHash("combo", [id, rev])
 *
 * Usage: node tmp/compute-rev.mjs <client.js path> <module id>
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'

const [clientPath, id] = process.argv.slice(2)
const framed = (domain, parts) => {
  const hash = createHash('sha1').update(domain).update('\0')
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part)
  return hash.digest('hex').slice(0, 12)
}

const st = fs.statSync(clientPath)
const artifact = framed('plugin-artifact', [String(st.mtimeMs), String(st.ctimeMs), String(st.size)])
const combo = framed('combo', [id, artifact])
console.log(JSON.stringify({ path: clientPath, id, mtimeMs: String(st.mtimeMs), ctimeMs: String(st.ctimeMs), size: String(st.size), artifact, combo }, null, 2))
