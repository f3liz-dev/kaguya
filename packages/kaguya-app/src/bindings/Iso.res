// SPDX-License-Identifier: MPL-2.0
// preact-iso bindings

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

// Opaque hook result; accessors below
type locationHook

@module("preact-iso")
external useLocation: unit => locationHook = "useLocation"

// Current path (no query string)
@get external path: locationHook => string = "path"

// Full URL (path + query)
@get external url: locationHook => string = "url"

// The navigate function bound to the current LocationProvider context.
// Signature: route(url, replace?)  — we expose two flavours.
@get external _navigate: locationHook => (string => unit) = "route"
@get external _navigateReplace: locationHook => ((string, bool) => unit) = "route"

// Query params as a string dict
@get external query: locationHook => Dict.t<string> = "query"

// ---------------------------------------------------------------------------
// LocationProvider — wraps the app and provides routing context
// ---------------------------------------------------------------------------

module LocationProvider = {
  @module("preact-iso") @react.component
  external make: (~url: string=?, ~children: Preact.element) => Preact.element = "LocationProvider"
}

// ---------------------------------------------------------------------------
// Router — renders the first child whose `path` prop matches the current URL.
// Each child receives URL params injected as additional props via cloneElement.
// Use `default={true}` on the fallback child.
// ---------------------------------------------------------------------------

module Router = {
  @module("preact-iso") @react.component
  external make: (~children: Preact.element) => Preact.element = "Router"
}

// ---------------------------------------------------------------------------
// SSR prerendering
// ---------------------------------------------------------------------------

type prerenderResult = {html: string}

@module("preact-iso")
external prerender: Preact.element => promise<prerenderResult> = "prerender"
