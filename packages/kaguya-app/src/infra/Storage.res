// SPDX-License-Identifier: MPL-2.0

@val @scope("localStorage")
external getItem: string => Nullable.t<string> = "getItem"

@val @scope("localStorage")
external setItem: (string, string) => unit = "setItem"

@val @scope("localStorage")
external removeItem: string => unit = "removeItem"

// Legacy single-account keys
let keyOrigin = "kaguya:instanceOrigin"
let keyToken = "kaguya:accessToken"
let keyMiAuthSession = "kaguya:miAuthSession"
let keyMiAuthOrigin = "kaguya:miAuthOrigin"
let keyPermissionMode = "kaguya:permissionMode"

// Multi-account storage keys
let keyAccounts = "kaguya:accounts"
let keyActiveAccountId = "kaguya:activeAccountId"

// Push notification: maps accountId -> Misskey userId
let keyPushUserIdPrefix = "kaguya:pushUserId:"

// OAuth2 storage keys
let keyOAuth2CodeVerifier = "kaguya:oauth2:codeVerifier"
let keyOAuth2State = "kaguya:oauth2:state"
let keyOAuth2Origin = "kaguya:oauth2:origin"
let keyOAuth2Scope = "kaguya:oauth2:scope"

// Guard all localStorage access: during the prerender pass there is no window.
let _isBrowser: bool = %raw(`typeof window !== "undefined"`)

let get = (key: string): option<string> => {
  if _isBrowser { getItem(key)->Nullable.toOption } else { None }
}

let set = (key: string, value: string): unit => {
  if _isBrowser { setItem(key, value) }
}

let remove = (key: string): unit => {
  if _isBrowser { removeItem(key) }
}
