// Waiting for the connection to come back, quietly.
//
// When the first page of a timeline fails because the network is gone (a
// reboot, a tunnel, the train), we don't want a red box and a button: we want
// a small "waiting…" line and to try again on our own — faster when the
// browser tells us we're back online or the tab became visible again.
// Same shape as sukhi-fedi's connection.ts.

const BASE_MS = 1_000
const CAP_MS = 15_000

// A fetch that never got a response, or a server that answered 5xx. 4xx is
// not a connection problem (the request itself was wrong) and stays an error.
export function isConnectivityError(message: string): boolean {
  return /<no response>|failed to fetch|networkerror|load failed|network request failed|\b50[0-4]\b|\b5\d\d\s+(bad gateway|service unavailable|gateway timeout)/i.test(message)
}

export function autoRetry(reload: () => void): { fail(): void; ok(): void; stop(): void } {
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let armed = false

  const clear = () => { if (timer) { clearTimeout(timer); timer = undefined } }
  const fire = () => { clear(); if (armed) reload() }
  const wake = () => { if (armed && document.visibilityState === 'visible') fire() }

  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)

  return {
    fail() {
      armed = true
      attempts += 1
      clear()
      timer = setTimeout(fire, Math.min(BASE_MS * 2 ** (attempts - 1), CAP_MS))
    },
    ok() { armed = false; attempts = 0; clear() },
    stop() {
      armed = false
      clear()
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
    },
  }
}
