import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const tokens = JSON.parse(await readFile(join(root, 'packages/tokens/tokens.json'), 'utf8'))

function tokenName(parts) {
  return parts.slice(0, -1).join('-').replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

function flattenTokens(node, path = []) {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' && 'value' in value ? [[...path, key, value.value]] : flattenTokens(value, [...path, key]),
  )
}

const css = `:root {\n${flattenTokens(tokens).map(parts => `  --${tokenName(parts)}: ${parts.at(-1)};`).join('\n')}\n}\n`
const destination = join(root, 'apps/web/src/styles')
await mkdir(destination, { recursive: true })
await writeFile(join(destination, 'tokens.css'), css)
