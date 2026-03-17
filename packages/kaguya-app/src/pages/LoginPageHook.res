// SPDX-License-Identifier: MPL-2.0

type loginMethod = [#oauth2 | #miauth | #token]

type hookResult = {
  instanceUrl: string,
  token: string,
  isSubmitting: bool,
  loginMethod: loginMethod,
  permissionMode: AuthTypes.permissionMode,
  errorMessage: option<string>,
  isSubmitDisabled: bool,
  submitLabel: string,
  helpText: string,
  handleInstanceChange: JsxEvent.Form.t => unit,
  handleTokenChange: JsxEvent.Form.t => unit,
  handlePermissionModeChange: JsxEvent.Form.t => unit,
  handleSubmit: JsxEvent.Form.t => unit,
  setLoginMethod: loginMethod => unit,
}

let useLoginForm = (): hookResult => {
  let (instanceUrl, setInstanceUrl) = PreactHooks.useState(() => "")
  let (token, setToken) = PreactHooks.useState(() => "")
  let (isSubmitting, setIsSubmitting) = PreactHooks.useState(() => false)
  let (loginMethod, setLoginMethod) = PreactHooks.useState(() => #oauth2)
  let (permissionMode, setPermissionMode) = PreactHooks.useState(() => AuthTypes.Standard)
  let authState = PreactSignals.value(AppState.authState)

  let handleInstanceChange = (e: JsxEvent.Form.t) => {
    let value = JsxEvent.Form.target(e)["value"]
    setInstanceUrl(_ => value)
  }

  let handleTokenChange = (e: JsxEvent.Form.t) => {
    let value = JsxEvent.Form.target(e)["value"]
    setToken(_ => value)
  }

  let handlePermissionModeChange = (e: JsxEvent.Form.t) => {
    let value = JsxEvent.Form.target(e)["value"]
    let mode = value == "readonly" ? AuthTypes.ReadOnly : AuthTypes.Standard
    setPermissionMode(_ => mode)
  }

  let handleSubmit = (e: JsxEvent.Form.t) => {
    JsxEvent.Form.preventDefault(e)
    if instanceUrl == "" {
      ()
    } else {
      switch loginMethod {
      | #miauth => AuthManager.startMiAuth(~origin=instanceUrl, ~mode=permissionMode, ())
      | #token =>
        if token != "" {
          setIsSubmitting(_ => true)
          let _ = (async () => {
            let _ = await AuthManager.login(~origin=instanceUrl, ~token)
            setIsSubmitting(_ => false)
          })()
        }
      | #oauth2 =>
        setIsSubmitting(_ => true)
        let _ = (async () => {
          let result = await AuthManager.startOAuth2(~origin=instanceUrl, ~mode=permissionMode, ())
          switch result {
          | Ok() => ()
          | Error(_) => setIsSubmitting(_ => false)
          }
        })()
      }
    }
  }

  let errorMessage = switch authState {
  | LoginFailed(error) =>
    Some(
      switch error {
      | InvalidCredentials => "認証情報が正しくありません。トークンを確認してください。"
      | NetworkError(msg) => "ネットワークエラー: " ++ msg
      | UnknownError(msg) => "エラー: " ++ msg
      },
    )
  | _ => None
  }

  let isSubmitDisabled = isSubmitting || instanceUrl == "" || (loginMethod == #token && token == "")

  let submitLabel = switch loginMethod {
  | #token => isSubmitting ? "接続中..." : "トークンで接続"
  | #miauth => "MiAuth でログイン"
  | #oauth2 => isSubmitting ? "接続中..." : "OAuth2 でログイン"
  }

  let helpText = switch loginMethod {
  | #miauth => "インスタンスに移動して認証します。トークンを手動で作成する必要はありません。"
  | #token => "インスタンスの 設定 → API からアクセストークンを取得してください。"
  | #oauth2 => "OAuth2 で安全に認証します。インスタンスが OAuth2 に対応していない場合は MiAuth をお試しください。"
  }

  {
    instanceUrl,
    token,
    isSubmitting,
    loginMethod,
    permissionMode,
    errorMessage,
    isSubmitDisabled,
    submitLabel,
    helpText,
    handleInstanceChange,
    handleTokenChange,
    handlePermissionModeChange,
    handleSubmit,
    setLoginMethod: nextMethod => setLoginMethod(_ => nextMethod),
  }
}
