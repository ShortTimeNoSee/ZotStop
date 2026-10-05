import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

function tokenName(parts: string[]) {
  return parts.slice(0, -1).join('-').replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

function flatten(node: Record<string, unknown>, path: string[] = []): string[][] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (value && typeof value === 'object' && 'value' in value) return [[...path, key, String((value as { value: unknown }).value)]]
    return flatten(value as Record<string, unknown>, [...path, key])
  })
}

test('generated CSS contains every design token', () => {
  const tokens = JSON.parse(readFileSync(new URL('../../../packages/tokens/tokens.json', import.meta.url), 'utf8')) as Record<string, unknown>
  const css = readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8')
  for (const parts of flatten(tokens)) expect(css).toContain(`--${tokenName(parts)}: ${parts.at(-1)};`)
})
