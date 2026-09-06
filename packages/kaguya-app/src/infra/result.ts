// SPDX-License-Identifier: MPL-2.0
//
// Idiomatic Result<T, E> for TypeScript. Replaces the ReScript-flavored
// { TAG: 'Ok' | 'Error'; _0: ... } shape that leaks from
// @f3liz/mazemaze-api-misskey. All API calls are normalized to this shape
// at the lib/misskey.ts boundary — nothing else in the app should ever
// need to touch TAG/_0.

export type Ok<T> = { ok: true; value: T }
export type Err<E> = { ok: false; error: E }
export type Result<T, E = string> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok

export function mapOk<T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r
}

export function mapErr<T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> {
  return r.ok ? r : err(f(r.error))
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback
}

// ReScript interop shape emitted by @f3liz/mazemaze-api-misskey.
// Only used inside lib/misskey.ts to convert to the idiomatic Result above.
export type RescriptResult<T, E> =
  | { TAG: 'Ok'; _0: T }
  | { TAG: 'Error'; _0: E }

export function fromRescript<T, E>(r: RescriptResult<T, E>): Result<T, E> {
  return r.TAG === 'Ok' ? ok(r._0) : err(r._0)
}
