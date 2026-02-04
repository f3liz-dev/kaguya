// SPDX-License-Identifier: MPL-2.0
// MiAuthCallbackPage.res - Handle MiAuth callback and complete authentication

// Helper to get URL search params
let getSearchParams = (): URLSearchParams.t => {
  %raw(`new globalThis.URLSearchParams(window.location.search)`)
}

@jsx.component
let make = () => {
  let (status, setStatus) = PreactHooks.useState(() => "checking")
  let (errorMessage, setErrorMessage) = PreactHooks.useState(() => None)
  let (retryCount, setRetryCount) = PreactHooks.useState(() => 0)
  let maxRetries = 3 // Only retry 3 times before showing error

  // Check MiAuth session when component mounts or retryCount changes
  PreactHooks.useEffect1(() => {
    let isMounted = ref(true)
    let checkAuth = async () => {
      try {
        if !isMounted.contents {
          ()
        } else {
          Console.log("MiAuthCallbackPage: Checking MiAuth session...")

          // Check if session is in URL
          let params = getSearchParams()
          let sessionFromUrl = params->URLSearchParams.get("session")
          Console.log2("MiAuthCallbackPage: Session in URL?", sessionFromUrl->Option.isSome)

          let result = await AppState.checkMiAuth()

          Console.log("MiAuthCallbackPage: Got result from checkMiAuth")
          Console.log2(
            "MiAuthCallbackPage: Result is Ok?",
            switch result {
            | Ok() => true
            | Error(_) => false
            },
          )

          switch result {
          | Ok() => {
              Console.log("MiAuthCallbackPage: MiAuth check successful")
              setStatus(_ => "success")
              // Redirect immediately - don't wait for component state changes
              Console.log("MiAuthCallbackPage: Hard redirecting to home...")
              %raw(`window.location.href = "/"`)
            }
          | Error(err) => {
              Console.error2("MiAuthCallbackPage: MiAuth check failed:", err)

              // Extract error message
              let errorMsg = switch err {
              | AppState.InvalidCredentials => "Invalid credentials"
              | AppState.NetworkError(msg) => msg
              | AppState.UnknownError(msg) => msg
              }

              let isPermanentError = String.includes(errorMsg, "Session information not found")

              if isPermanentError {
                // Permanent error: redirect to login immediately with hard redirect
                Console.log("MiAuthCallbackPage: Permanent error, hard redirecting to login...")
                setStatus(_ => "permanent_error")
                setErrorMessage(_ => Some(errorMsg))
                // Set the error state in AppState and hard redirect
                PreactSignals.setValue(AppState.authState, AppState.LoginFailed(err))
                %raw(`window.location.href = "/"`)
              } else if retryCount < maxRetries {
                // Transient error: retry
                if isMounted.contents {
                  Console.log2("MiAuthCallbackPage: Retrying... attempt", retryCount + 1)
                  setStatus(_ => "checking")
                  let _ = SetTimeout.make(() => {
                    if isMounted.contents {
                      setRetryCount(prev => prev + 1)
                    }
                  }, 1000)
                }
              } // Max retries exceeded: redirect to login with error
              else if isMounted.contents {
                Console.log("MiAuthCallbackPage: Max retries exceeded, redirecting to login...")
                setStatus(_ => "error")
                setErrorMessage(_ => Some(errorMsg))
                // Wait 2 seconds to show error, then redirect
                let _ = SetTimeout.make(() => {
                  %raw(`window.location.href = "/"`)
                }, 2000)
              }
            }
          }
        }
      } catch {
      | exn => {
          Console.error("MiAuthCallbackPage: Exception in checkAuth")
          Console.error(exn)
        }
      }
    }

    let _ = checkAuth()

    // Cleanup function: set isMounted to false when component unmounts
    Some(
      () => {
        isMounted.contents = false
      },
    )
  }, [retryCount])

  <main className="container">
    <article className="login-card">
      <header>
        <h1> {Preact.string("Completing Login...")} </h1>
      </header>
      {switch status {
      | "checking" =>
        <div className="loading-container">
          <p> {Preact.string("Verifying authorization...")} </p>
        </div>
      | "success" =>
        <div className="success-message">
          <div style={Style.make(~fontSize="2rem", ~marginBottom="0.5rem", ())}>
            {Preact.string("✓")}
          </div>
          <p> {Preact.string("Login successful!")} </p>
          <p
            style={Style.make(
              ~fontSize="0.875rem",
              ~fontWeight="400",
              ~marginTop="0.5rem",
              ~color="#158033",
              (),
            )}
          >
            {Preact.string("Redirecting to home...")}
          </p>
        </div>
      | "permanent_error" =>
        <div className="error-message">
          <p> {Preact.string("Session expired or not found.")} </p>
          <p style={Style.make(~fontSize="0.75rem", ~marginTop="0.5rem", ~color="#991b1b", ())}>
            {Preact.string("Redirecting to login...")}
          </p>
        </div>
      | "error" =>
        <div className="error-message">
          <p> {Preact.string("Authorization failed after 3 attempts.")} </p>
          {switch errorMessage {
          | Some(msg) =>
            <details style={Style.make(~marginTop="0.5rem", ())}>
              <summary style={Style.make(~fontSize="0.75rem", ~color="#991b1b", ~cursor="pointer", ())}>
                {Preact.string("Show error details")}
              </summary>
              <pre
                style={Style.make(
                  ~fontSize="0.65rem",
                  ~marginTop="0.5rem",
                  ~padding="0.5rem",
                  ~backgroundColor="#fee2e2",
                  ~borderRadius="4px",
                  ~overflow="auto",
                  ~maxWidth="100%",
                  (),
                )}
              >
                {Preact.string(msg)}
              </pre>
            </details>
          | None => Preact.null
          }}
          <p style={Style.make(~fontSize="0.75rem", ~marginTop="0.5rem", ~color="#991b1b", ())}>
            {Preact.string("Redirecting to login page in 2 seconds...")}
          </p>
        </div>
      | _ => Preact.null
      }}
    </article>
  </main>
}
