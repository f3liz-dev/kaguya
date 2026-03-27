// SPDX-License-Identifier: MPL-2.0

// Removes the static HTML bar injected before JS loads
@val @scope("document")
external _getElementById: string => Nullable.t<{..}> = "getElementById"
@send external _removeEl: {..} => unit = "remove"

@jsx.component
let make = () => {
  let isLoading = PreactSignals.value(PageLoading.isLoading)
  // "completing" means the bar just finished — animate to 100% then hide
  let (completing, setCompleting) = PreactHooks.useState(() => false)
  // ref avoids stale closure: did the bar ever go active in this mount?
  let everActiveRef = PreactHooks.useRef(false)

  // Remove static HTML bar once Preact takes over
  PreactHooks.useEffect0(() => {
    _getElementById("initial-bar")
    ->Nullable.toOption
    ->Option.forEach(_removeEl)
    None
  })

  PreactHooks.useEffect1(() => {
    if isLoading {
      everActiveRef.current = true
      setCompleting(_ => false)
      None
    } else if everActiveRef.current {
      everActiveRef.current = false
      setCompleting(_ => true)
      let t = SetTimeout.make(() => setCompleting(_ => false), 600)
      Some(() => SetTimeout.clear(t))
    } else {
      None
    }
  }, [isLoading])

  if isLoading {
    <div className="page-loading-bar page-loading-bar--active" />
  } else if completing {
    <div className="page-loading-bar page-loading-bar--completing" />
  } else {
    Preact.null
  }
}
