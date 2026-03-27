// SPDX-License-Identifier: MPL-2.0
// Routing shim: same API surface as wouter-preact, backed by preact-iso.
// All existing consumers (NoteCard, NoteActions, NoteHeader, Layout,
// AccountSwitcher, MfmRenderer, …) compile unchanged.

// ---------------------------------------------------------------------------
// Types (unchanged from old wouter-preact API)
// ---------------------------------------------------------------------------

type params = Dict.t<string>

type navigationOptions = {
  replace: bool,
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

// useLocation → (currentPath, navigate)
let useLocation = (): (string, string => unit) => {
  let loc = Iso.useLocation()
  (Iso.path(loc), Iso._navigate(loc))
}

// useLocationWithOptions → (currentPath, (path, opts) => ())
let useLocationWithOptions = (): (string, (string, navigationOptions) => unit) => {
  let loc = Iso.useLocation()
  let navigate = Iso._navigateReplace(loc)
  (Iso.path(loc), (path, opts) => navigate(path, opts.replace))
}

// useNavigate → navigate function (no options)
let useNavigate = (): (string => unit) => {
  Iso._navigate(Iso.useLocation())
}

// useNavigateWithOptions → navigate with replace option
let useNavigateWithOptions = (): ((string, navigationOptions) => unit) => {
  let navigate = Iso._navigateReplace(Iso.useLocation())
  (path, opts) => navigate(path, opts.replace)
}

// ---------------------------------------------------------------------------
// Link — client-side anchor; lets browser handle modifier keys & middle-click
// ---------------------------------------------------------------------------

module Link = {
  @jsx.component
  let make = (
    ~href: string,
    ~children: Preact.element,
    ~className: string="",
    ~onClick: JsxEvent.Mouse.t => unit=?,
  ) => {
    let navigate = useNavigate()
    <a
      href
      className
      onClick={e => {
        let modified: bool =
          (e->Obj.magic)["ctrlKey"] ||
          (e->Obj.magic)["metaKey"] ||
          (e->Obj.magic)["altKey"] ||
          (e->Obj.magic)["shiftKey"]
        let button: int = (e->Obj.magic)["button"]
        if !modified && button == 0 {
          JsxEvent.Mouse.preventDefault(e)
          switch onClick {
          | Some(f) => f(e)
          | None => ()
          }
          navigate(href)
        }
      }}
    >
      children
    </a>
  }
}

// ---------------------------------------------------------------------------
// Redirect — navigate on mount
// ---------------------------------------------------------------------------

module Redirect = {
  @jsx.component
  let make = (~to: string) => {
    let navigate = useNavigate()
    PreactHooks.useEffect0(() => {
      navigate(to)
      None
    })
    Preact.null
  }
}
