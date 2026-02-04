// Unified client that manages both REST API and WebSocket streaming
// This is the main entry point for most Misskey operations
//
// ⚠️ DEPRECATION NOTICE ⚠️
// This module is DEPRECATED. Use the new Misskey API instead:
//
// OLD: MisskeyJS.Client.make(~origin, ~credential, ())
// NEW: Misskey.connect(origin, ~token)
//
// See MIGRATION.md for the complete migration guide.

module Stream_Bindings = NativeStreamBindings

// ============================================================
// Metrics Callback Types
// ============================================================

type apiCallMetrics = {
  endpoint: string,
  durationMs: float,
  success: bool,
}

type metricsCallback = apiCallMetrics => unit

// ============================================================
// Client Type
// ============================================================

// Internal representation - now uses generated fetch instead of misskey-js
type rec t = {
  origin: string,
  credential: option<string>,
  fetch: MisskeyJS_Fetch.fetchFn,
  mutable streamClient: option<Stream_Bindings.stream>,
  mutable metricsCallback: option<metricsCallback>,
}

// ============================================================
// Client Creation
// ============================================================

// Create a unified client
let make = (~origin: string, ~credential: option<string>=?, ()): t => {
  let fetch = MisskeyJS_Fetch.make(~origin, ~credential?)
  {
    origin,
    credential,
    fetch,
    streamClient: None,
    metricsCallback: None,
  }
}

// ============================================================
// Metrics Callback Management
// ============================================================

// Set metrics callback for tracking API calls
let setMetricsCallback = (client: t, callback: metricsCallback): unit => {
  client.metricsCallback = Some(callback)
}

// Clear metrics callback
let clearMetricsCallback = (client: t): unit => {
  client.metricsCallback = None
}

// Internal: Track API call metrics
let trackApiCall = (client: t, ~endpoint: string, ~durationMs: float, ~success: bool): unit => {
  switch client.metricsCallback {
  | Some(callback) => callback({endpoint, durationMs, success})
  | None => ()
  }
}

// ============================================================
// Wrapped API Request
// ============================================================

// Wrapped request that tracks metrics
// This is now a thin wrapper around the fetch function
let request = async (
  client: t,
  ~endpoint: string,
  ~params: option<JSON.t>=?,
  ~credential: option<string>=?,
): JSON.t => {
  let startTime = Date.now()

  try {
    // Use the generated fetch function
    let result = await client.fetch({
      url: endpoint,
      method_: "POST",
      body: params
    })
    let duration = Date.now() -. startTime
    trackApiCall(client, ~endpoint, ~durationMs=duration, ~success=true)
    result
  } catch {
  | error => {
      let duration = Date.now() -. startTime
      trackApiCall(client, ~endpoint, ~durationMs=duration, ~success=false)
      throw(error)
    }
  }
}

// ============================================================
// Accessors
// ============================================================
let origin = (client: t): string => client.origin
let credential = (client: t): option<string> => client.credential

// Get the fetch function (for use with generated code)
let fetch = (client: t): MisskeyJS_Fetch.fetchFn => client.fetch

// Get or lazily initialize the stream client
let streamClient = (client: t): Stream_Bindings.stream => {
  switch client.streamClient {
  | Some(stream) => stream
  | None => {
      let user = client.credential->Option.map((t): Stream_Bindings.streamUser => {token: t})
      let stream = Stream_Bindings.make(~origin=client.origin, ~user?, ())
      client.streamClient = Some(stream)
      stream
    }
  }
}

// Check if stream is connected
let isStreamConnected = (client: t): bool => {
  switch client.streamClient {
  | Some(stream) => Stream_Bindings.state(stream) == #connected
  | None => false
  }
}

// Stream connection event handlers
let onConnected = (client: t, callback: unit => unit): unit => {
  let stream = streamClient(client)
  Stream_Bindings.onConnected(stream, callback)
}

let onDisconnected = (client: t, callback: unit => unit): unit => {
  let stream = streamClient(client)
  Stream_Bindings.onDisconnected(stream, callback)
}

// Close the client (closes stream if open)
let close = (client: t): unit => {
  switch client.streamClient {
  | Some(stream) => Stream_Bindings.close(stream)
  | None => ()
  }
}
