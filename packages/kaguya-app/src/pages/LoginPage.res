// SPDX-License-Identifier: MPL-2.0

@jsx.component
let make = () => {
  let {
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
    setLoginMethod,
  } = LoginPageHook.useLoginForm()

  <main className="container login-page">
    <article className="login-card">
      <header>
        <h1 className="login-title"> {Preact.string("かぐや")} </h1>
        <p className="login-subtitle"> {Preact.string("やさしくて、しんぷるな Misskey クライアント")} </p>
      </header>

      <form onSubmit={handleSubmit}>
        // Instance URL — shared across all methods
        <label htmlFor="instance">
          {Preact.string("インスタンス")}
          <input
            type_="text"
            id="instance"
            name="instance"
            placeholder="misskey.io"
            value={instanceUrl}
            onChange={handleInstanceChange}
            disabled={isSubmitting}
            autoFocus=true
            required=true
          />
        </label>

        // Login method tabs
        <div className="login-method-tabs">
          <button
            className={loginMethod == #oauth2 ? "active" : ""}
            onClick={_ => setLoginMethod(#oauth2)}
            type_="button"
          >
            {Preact.string("OAuth2")}
          </button>
          <button
            className={loginMethod == #miauth ? "active" : ""}
            onClick={_ => setLoginMethod(#miauth)}
            type_="button"
          >
            {Preact.string("MiAuth")}
          </button>
          <button
            className={loginMethod == #token ? "active" : ""}
            onClick={_ => setLoginMethod(#token)}
            type_="button"
          >
            {Preact.string("トークン")}
          </button>
        </div>

        // Token input — only for token method
        {if loginMethod == #token {
          <label htmlFor="token">
            {Preact.string("アクセストークン")}
            <input
              type_="password"
              id="token"
              name="token"
              placeholder="アクセストークン"
              value={token}
              onChange={handleTokenChange}
              disabled={isSubmitting}
              required=true
            />
          </label>
        } else {
          // Permission mode — for OAuth2 and MiAuth only
          <label htmlFor="permission-mode">
            {Preact.string("権限モード")}
            <select
              id="permission-mode"
              name="permission-mode"
              value={permissionMode == AuthTypes.ReadOnly ? "readonly" : "standard"}
              onChange={handlePermissionModeChange}
            >
              <option value="standard"> {Preact.string("標準（読み書き）")} </option>
              <option value="readonly"> {Preact.string("読み取り専用")} </option>
            </select>
          </label>
        }}

        {switch errorMessage {
        | Some(msg) =>
          <div className="error-message" role="alert">
            <p> {Preact.string(msg)} </p>
          </div>
        | None => Preact.null
        }}

        <button type_="submit" disabled={isSubmitDisabled}>
          {Preact.string(submitLabel)}
        </button>

        <small className="login-help"> {Preact.string(helpText)} </small>
      </form>
    </article>
  </main>
}
