// Petites assertions (le registre jsr n'est pas toujours accessible).
import { deepStrictEqual, ok } from 'node:assert/strict'

export function assert(cond: unknown, msg?: string): asserts cond {
  ok(cond, msg)
}
export function assertEquals<T>(actual: T, expected: T, msg?: string) {
  deepStrictEqual(actual, expected, msg)
}
export function assertMatch(actual: string, re: RegExp) {
  ok(re.test(actual), `${actual} ne correspond pas à ${re}`)
}
export function assertStringIncludes(actual: string, part: string) {
  ok(actual.includes(part), `« ${part} » absent de : ${actual.slice(0, 200)}`)
}
