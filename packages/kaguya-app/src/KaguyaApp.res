// SPDX-License-Identifier: MPL-2.0

// true only during the Vite prerender pass; replaced with a literal at build time
let _isSsr: bool = %raw(`import.meta.env.SSR`)

// ---------------------------------------------------------------------------
// Route wrapper components
//
// preact-iso's Router matches children by their `path` prop, then calls
// cloneElement(child, urlParams) to inject URL segments as additional props.
// Default values ("") are never used at runtime — preact-iso always provides them.
// ---------------------------------------------------------------------------

module HomeRoute = {
  @jsx.component
  let make = (~path: string="") => {
    let _ = path
    <HomePage />
  }
}

module NotificationsRoute = {
  @jsx.component
  let make = (~path: string="") => {
    let _ = path
    <NotificationsPage />
  }
}

module PerformanceRoute = {
  @jsx.component
  let make = (~path: string="") => {
    let _ = path
    <PerformancePage />
  }
}

module AddAccountRoute = {
  @jsx.component
  let make = (~path: string="") => {
    let _ = path
    <LoginPage />
  }
}

module SettingsRoute = {
  @jsx.component
  let make = (~path: string="") => {
    let _ = path
    <SettingsPage />
  }
}

module NotesIndexRoute = {
  @jsx.component
  let make = (~path: string="") => {
    let _ = path
    <Layout>
      <div className="loading-container">
        <p> {Preact.string("ノートを選択してください")} </p>
      </div>
    </Layout>
  }
}

module NotePageRoute = {
  @jsx.component
  let make = (~path: string="", ~noteId: string="", ~host: string="") => {
    let _ = path
    <NotePage noteId host />
  }
}

// Handles push notification redirects: /push/notes/:noteId?userId=<misskeyUserId>
module PushNoteRoute = {
  @jsx.component
  let make = (~path: string="", ~noteId: string="") => {
    let _ = path
    let navigate = Wouter.useNavigateWithOptions()
    // Read query params at component level (hooks must not be called inside effects)
    let queryParams = Iso.query(Iso.useLocation())

    PreactHooks.useEffect0(() => {
      let userId = queryParams->Dict.get("userId")

      let accounts = PreactSignals.value(AppState.accounts)
      let matchedAccount = switch userId {
      | Some(uid) => accounts->Array.find(a => a.misskeyUserId == uid)
      | None => None
      }

      let opts = {Wouter.replace: true}
      switch matchedAccount {
      | Some(account) =>
        if account.id != PreactSignals.value(AppState.activeAccountId)->Option.getOr("") {
          let _ = AuthManager.switchAccount(account.id)->Promise.then(_ => {
            navigate("/notes/" ++ noteId ++ "/" ++ account.host, opts)
            Promise.resolve()
          })
        } else {
          navigate("/notes/" ++ noteId ++ "/" ++ account.host, opts)
        }
      | None =>
        let host = PreactSignals.value(AppState.instanceName)
        navigate("/notes/" ++ noteId ++ "/" ++ host, opts)
      }
      None
    })

    <Layout>
      <div className="loading-container">
        <p> {Preact.string("読み込み中...")} </p>
      </div>
    </Layout>
  }
}

let parseAcct = (acct: string): (string, option<string>) => {
  switch acct->String.indexOf("@") {
  | -1 => (acct, None)
  | idx => (
      acct->String.slice(~start=0, ~end=idx),
      Some(acct->String.slice(~start=idx + 1, ~end=String.length(acct))),
    )
  }
}

// Catch-all: handles /@user paths, falls back to HomePage.
// preact-iso injects the live `path` when rendering this as the default route.
module CatchAllRoute = {
  @jsx.component
  let make = (~path: string="", ~default: bool=false) => {
    let _ = default
    if path->String.startsWith("/@") {
      let acct = path->String.slice(~start=2, ~end=String.length(path))
      let (username, host) = parseAcct(acct)
      <UserPage username ?host />
    } else {
      <HomePage />
    }
  }
}

// ---------------------------------------------------------------------------
// AppContent — lives inside LocationProvider so useLocation() resolves correctly
// ---------------------------------------------------------------------------

module AppContent = {
  @jsx.component
  let make = () => {
    let (location, _) = Wouter.useLocation()
    let authState = PreactSignals.value(AppState.authState)

    let loggedInRoutes =
      <Iso.Router>
        <HomeRoute path="/" />
        <NotificationsRoute path="/notifications" />
        <PerformanceRoute path="/performance" />
        <AddAccountRoute path="/add-account" />
        <SettingsRoute path="/settings" />
        <NotePageRoute path="/notes/:noteId/:host" />
        <PushNoteRoute path="/push/notes/:noteId" />
        <NotesIndexRoute path="/notes" />
        <CatchAllRoute default={true} />
      </Iso.Router>

    // During the prerender pass, skip auth gating so every route renders its
    // skeleton/content rather than the login page.
    if _isSsr {
      loggedInRoutes
    } else {
      switch authState {
      | LoggingIn =>
        if location == "/miauth-callback" {
          <MiAuthCallbackPage />
        } else if location->String.startsWith("/oauth-callback") {
          <OAuthCallbackPage />
        } else {
          loggedInRoutes
        }
      | LoggedIn => loggedInRoutes
      | LoggedOut | LoginFailed(_) =>
        if location == "/miauth-callback" {
          <MiAuthCallbackPage />
        } else if location->String.startsWith("/oauth-callback") {
          <OAuthCallbackPage />
        } else {
          <LoginPage />
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Root component
// `url` is forwarded to LocationProvider for SSR route resolution;
// on the client it is always "" (LocationProvider reads window.location).
// ---------------------------------------------------------------------------

@jsx.component
let make = (~url: string="") => {
  PreactHooks.useEffect0(() => {
    let _ = AuthManager.restoreSession()
    None
  })

  let urlOpt: option<string> = if url != "" { Some(url) } else { None }

  <>
    <LoadingBar />
    <Toast />
    <Iso.LocationProvider url=?urlOpt>
      <AppContent />
    </Iso.LocationProvider>
  </>
}
