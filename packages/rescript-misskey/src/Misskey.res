// Misskey.res - Clean, intuitive API for Misskey
//
// This is the main entry point providing a simple, discoverable API
// through clear naming and autocompletion.
//
// Quick Start:
//   let client = Misskey.connect("https://misskey.io", ~token="your-token")
//   
//   // Post a note
//   let note = await client->Misskey.Notes.create("Hello, Misskey!", ())
//   
//   // Stream timeline  
//   let sub = client->Misskey.Stream.timeline(#home, note => {
//     Console.log2("New note!", note)
//   })
//
// Note: Use qualified names (Misskey.connect, Misskey.Notes, etc.) to avoid
// naming conflicts. Don't use "open Misskey".

// ============================================================================
// Client & Configuration
// ============================================================================

type t = {
  origin: string,
  token: option<string>,
  mutable streamClient: option<StreamClient.t>,
}

/// Connect to a Misskey instance
/// 
/// Example:
///   let client = Misskey.connect("https://misskey.io")
///   let authClient = Misskey.connect("https://misskey.io", ~token="abc123")
let connect = (origin: string, ~token: option<string>=?): t => {
  {
    origin,
    token,
    streamClient: None,
  }
}

// Internal helper to create apiClient on-demand
let makeApiClient = (client: t) => {
  switch client.token {
  | Some(t) => MisskeyJS_Fetch.make(~origin=client.origin, ~credential=t)
  | None => MisskeyJS_Fetch.make(~origin=client.origin)
  }
}

// ============================================================================
// Notes API - Create, delete, read notes
// ============================================================================

module Notes = {
  type visibility = [#public | #home | #followers | #specified]
  
  /// Create a note (post)
  /// 
  /// Example:
  ///   await client->Misskey.Notes.create("Hello, world!")
  ///   await client->Misskey.Notes.create("Private post", ~visibility=#followers)
  let create = (
    client: t,
    text: string,
    ~visibility: visibility=#public,
    ~cw: option<string>=?,
    ~localOnly: bool=false,
    ~replyId: option<string>=?,
    ~renoteId: option<string>=?,
    (),
  ): promise<result<JSON.t, string>> => {
    let params = Dict.make()
    params->Dict.set("text", text->JSON.Encode.string)
    
    let vis = switch visibility {
    | #public => "public"
    | #home => "home"
    | #followers => "followers"
    | #specified => "specified"
    }
    params->Dict.set("visibility", vis->JSON.Encode.string)
    params->Dict.set("localOnly", localOnly->JSON.Encode.bool)
    
    cw->Option.forEach(v => params->Dict.set("cw", v->JSON.Encode.string))
    replyId->Option.forEach(v => params->Dict.set("replyId", v->JSON.Encode.string))
    renoteId->Option.forEach(v => params->Dict.set("renoteId", v->JSON.Encode.string))
    
    let apiClient = makeApiClient(client)
    apiClient({url: "notes/create", method_: "POST", body: Some(params->JSON.Encode.object)})
    ->Promise.then(json => Ok(json)->Promise.resolve)
    ->Promise.catch(_err => Error(%raw(`String(_err)`))->Promise.resolve)
  }
  
  /// Delete a note
  /// 
  /// Example:
  ///   await client->Misskey.Notes.delete("note-id-here")
  let delete = (client: t, noteId: string): promise<result<JSON.t, string>> => {
    let params = Dict.make()
    params->Dict.set("noteId", noteId->JSON.Encode.string)
    
    let apiClient = makeApiClient(client)
    apiClient({url: "notes/delete", method_: "POST", body: Some(params->JSON.Encode.object)})
    ->Promise.then(json => Ok(json)->Promise.resolve)
    ->Promise.catch(_err => Error(%raw(`String(_err)`))->Promise.resolve)
  }
  
  type timelineType = [
    | #home | #local | #global | #hybrid
    | #antenna(string) | #list(string) | #channel(string)
  ]
  
  /// Fetch timeline notes (one-time fetch, not streaming)
  /// 
  /// Example:
  ///   let notes = await client->Misskey.Notes.fetch(#home, ~limit=20, ())
  ///   let antennaResponse = await client->Misskey.Notes.fetch(#antenna("id"), ~limit=10, ())
  let fetch = (
    client: t,
    type_: timelineType,
    ~limit: int=10,
    ~sinceId: option<string>=?,
    ~untilId: option<string>=?,
    (),
  ): promise<result<JSON.t, string>> => {
    let (endpoint, extraParams) = switch type_ {
    | #home => ("notes/timeline", None)
    | #local => ("notes/local-timeline", None)
    | #global => ("notes/global-timeline", None)
    | #hybrid => ("notes/hybrid-timeline", None)
    | #antenna(id) => {
        let p = Dict.make()
        p->Dict.set("antennaId", id->JSON.Encode.string)
        ("antennas/notes", Some(p))
      }
    | #list(id) => {
        let p = Dict.make()
        p->Dict.set("listId", id->JSON.Encode.string)
        ("notes/user-list-timeline", Some(p))
      }
    | #channel(id) => {
        let p = Dict.make()
        p->Dict.set("channelId", id->JSON.Encode.string)
        ("channels/timeline", Some(p))
      }
    }
    
    let params = Dict.make()
    params->Dict.set("limit", limit->JSON.Encode.int)
    sinceId->Option.forEach(v => params->Dict.set("sinceId", v->JSON.Encode.string))
    untilId->Option.forEach(v => params->Dict.set("untilId", v->JSON.Encode.string))
    
    // Merge extra params if any
    extraParams->Option.forEach(extra => {
      extra->Dict.toArray->Array.forEach(((key, value)) => {
        params->Dict.set(key, value)
      })
    })
    
    let apiClient = makeApiClient(client)
    apiClient({url: endpoint, method_: "POST", body: Some(params->JSON.Encode.object)})
    ->Promise.then(json => Ok(json)->Promise.resolve)
    ->Promise.catch(_err => Error(%raw(`String(_err)`))->Promise.resolve)
  }
  
  /// Get timeline (alias for fetch)
  let timeline = fetch
  
  /// React to a note
  /// 
  /// Example:
  ///   await client->Misskey.Notes.react("note-id", "👍")
  let react = (client: t, noteId: string, reaction: string): promise<result<JSON.t, string>> => {
    let params = Dict.make()
    params->Dict.set("noteId", noteId->JSON.Encode.string)
    params->Dict.set("reaction", reaction->JSON.Encode.string)
    
    let apiClient = makeApiClient(client)
    apiClient({url: "notes/reactions/create", method_: "POST", body: Some(params->JSON.Encode.object)})
    ->Promise.then(json => Ok(json)->Promise.resolve)
    ->Promise.catch(_err => Error(%raw(`String(_err)`))->Promise.resolve)
  }
  
  /// Remove reaction from a note
  /// 
  /// Example:
  ///   await client->Misskey.Notes.unreact("note-id")
  let unreact = (client: t, noteId: string): promise<result<JSON.t, string>> => {
    let params = Dict.make()
    params->Dict.set("noteId", noteId->JSON.Encode.string)
    
    let apiClient = makeApiClient(client)
    apiClient({url: "notes/reactions/delete", method_: "POST", body: Some(params->JSON.Encode.object)})
    ->Promise.then(json => Ok(json)->Promise.resolve)
    ->Promise.catch(_err => Error(%raw(`String(_err)`))->Promise.resolve)
  }
}

// ============================================================================
// Stream API - Real-time updates via WebSocket
// ============================================================================

module Stream = {
  type subscription = {
    dispose: unit => unit,
  }
  
  let ensureStream = (client: t): StreamClient.t => {
    switch client.streamClient {
    | Some(s) => s
    | None =>
      let s = StreamClient.make(~origin=client.origin, ~credential=?client.token, ())
      client.streamClient = Some(s)
      s
    }
  }
  
  /// Listen for connection/disconnection events
  /// 
  /// Example:
  ///   client->Misskey.Stream.onConnected(() => Console.log("Connected!"))
  let onConnected = (client: t, callback: unit => unit): unit => {
    let stream = ensureStream(client)
    stream->StreamClient.onConnected(callback)
  }
  
  let onDisconnected = (client: t, callback: unit => unit): unit => {
    let stream = ensureStream(client)
    stream->StreamClient.onDisconnected(callback)
  }
  
  type timelineType = [
    | #home | #local | #global | #hybrid
    | #antenna(string) | #list(string) | #channel(string)
  ]
  
  /// Subscribe to timeline for real-time notes
  /// 
  /// Example:
  ///   let sub = client->Misskey.Stream.timeline(#home, note => {
  ///     Console.log("New note!", note)
  ///   })
  ///   let antennaSub = client->Misskey.Stream.timeline(#antenna("antenna-id"), note => {...})
  ///   // Later: sub.dispose()
  let timeline = (
    client: t,
    type_: timelineType,
    onNote: JSON.t => unit,
  ): subscription => {
    let stream = ensureStream(client)
    
    let (channel, params) = switch type_ {
    | #home => ("homeTimeline", None)
    | #local => ("localTimeline", None)
    | #global => ("globalTimeline", None)
    | #hybrid => ("hybridTimeline", None)
    | #antenna(id) => {
        let p = Dict.make()
        p->Dict.set("antennaId", id->JSON.Encode.string)
        ("antenna", Some(p->JSON.Encode.object))
      }
    | #list(id) => {
        let p = Dict.make()
        p->Dict.set("listId", id->JSON.Encode.string)
        ("userList", Some(p->JSON.Encode.object))
      }
    | #channel(id) => {
        let p = Dict.make()
        p->Dict.set("channelId", id->JSON.Encode.string)
        ("channel", Some(p->JSON.Encode.object))
      }
    }
    
    // Use non-shared connection for channels with params, shared for simple timelines
    let conn = switch params {
    | Some(p) => stream->StreamClient.useChannel(~channel, ~params=p, ())
    | None => stream->StreamClient.useSharedChannel(~channel, ())
    }
    
    conn->StreamConnection.on("note", onNote)
    
    {
      dispose: () => StreamConnection.dispose(conn),
    }
  }
  
  /// Subscribe to notifications
  /// 
  /// Example:
  ///   let sub = client->Misskey.Stream.notifications(notif => {
  ///     Console.log("New notification!", notif)
  ///   })
  let notifications = (client: t, onNotification: JSON.t => unit): subscription => {
    let stream = ensureStream(client)
    let conn = stream->StreamClient.useSharedChannel(~channel="main", ())
    conn->StreamConnection.on("notification", onNotification)
    
    {
      dispose: () => StreamConnection.dispose(conn),
    }
  }
  
  /// Close all streaming connections
  /// 
  /// Example:
  ///   client->Misskey.Stream.close()
  let close = (client: t): unit => {
    client.streamClient->Option.forEach(s => s->StreamClient.close)
    client.streamClient = None
  }
}

// ============================================================================
// Account & User API
// ============================================================================

/// Make generic API request to any endpoint
/// 
/// Example:
///   let user = await client->Misskey.request("i", ())
///   let customEndpoint = await client->Misskey.request("custom/endpoint", ~params=myParams, ())
let request = (
  client: t,
  endpoint: string,
  ~params: JSON.t=JSON.Encode.object(Dict.make()),
  (),
): promise<result<JSON.t, string>> => {
  let apiClient = makeApiClient(client)
  apiClient({url: endpoint, method_: "POST", body: Some(params)})
  ->Promise.then(json => Ok(json)->Promise.resolve)
  ->Promise.catch(_err => Error(%raw(`String(_err)`))->Promise.resolve)
}

/// Get current user info
/// 
/// Example:
///   let user = await client->Misskey.currentUser()
let currentUser = (client: t): promise<result<JSON.t, string>> => {
  request(client, "i", ())
}

/// Get client origin (instance URL)
let origin = (client: t): string => client.origin

/// Close client and cleanup (close streaming connections)
/// 
/// Example:
///   client->Misskey.close()
let close = (client: t): unit => {
  client.streamClient->Option.forEach(s => s->StreamClient.close)
  client.streamClient = None
}

// ============================================================================
// Emojis API
// ============================================================================

module Emojis = {
  type customEmoji = {
    name: string,
    url: string,
    category: option<string>,
    aliases: array<string>,
  }
  
  let decodeCustomEmoji = (json: JSON.t): option<customEmoji> => {
    switch json->JSON.Decode.object {
    | Some(obj) =>
      switch (
        obj->Dict.get("name")->Option.flatMap(JSON.Decode.string),
        obj->Dict.get("url")->Option.flatMap(JSON.Decode.string),
      ) {
      | (Some(name), Some(url)) =>
        let category = obj->Dict.get("category")->Option.flatMap(JSON.Decode.string)
        let aliases = switch obj->Dict.get("aliases")->Option.flatMap(JSON.Decode.array) {
        | Some(arr) => arr->Array.filterMap(JSON.Decode.string)->Array.filter(s => s != "")
        | None => []
        }
        Some({
          name,
          url,
          category,
          aliases,
        })
      | _ => None
      }
    | None => None
    }
  }
  
  /// Get list of custom emojis from instance
  /// 
  /// Example:
  ///   let emojis = await client->Misskey.Emojis.list()
  let list = (client: t): promise<result<array<customEmoji>, string>> => {
    request(client, "emojis", ())
    ->Promise.then(result => {
      switch result {
      | Ok(json) =>
        switch json->JSON.Decode.object {
        | Some(obj) =>
          switch obj->Dict.get("emojis")->Option.flatMap(JSON.Decode.array) {
          | Some(emojisArray) => {
              let decoded = emojisArray->Array.filterMap(decodeCustomEmoji)
              Ok(decoded)
            }
          | None => Ok([])
          }
        | None => Ok([])
        }
      | Error(e) => Error(e)
      }
      ->Promise.resolve
    })
  }
}

// ============================================================================
// Custom Timelines API (Antennas, Lists, Channels)
// ============================================================================

module CustomTimelines = {
  /// Fetch user's antennas
  /// 
  /// Example:
  ///   let antennas = await client->Misskey.CustomTimelines.antennas()
  let antennas = (client: t): promise<result<array<JSON.t>, string>> => {
    request(client, "antennas/list", ())
    ->Promise.then(result => {
      switch result {
      | Ok(json) =>
        switch json->JSON.Decode.array {
        | Some(arr) => Ok(arr)
        | None => Ok([])
        }
      | Error(e) => Error(e)
      }
      ->Promise.resolve
    })
  }
  
  /// Fetch user's lists
  /// 
  /// Example:
  ///   let lists = await client->Misskey.CustomTimelines.lists()
  let lists = (client: t): promise<result<array<JSON.t>, string>> => {
    request(client, "users/lists/list", ())
    ->Promise.then(result => {
      switch result {
      | Ok(json) =>
        switch json->JSON.Decode.array {
        | Some(arr) => Ok(arr)
        | None => Ok([])
        }
      | Error(e) => Error(e)
      }
      ->Promise.resolve
    })
  }
  
  /// Fetch user's followed channels
  /// 
  /// Example:
  ///   let channels = await client->Misskey.CustomTimelines.channels()
  let channels = (client: t): promise<result<array<JSON.t>, string>> => {
    request(client, "channels/followed", ())
    ->Promise.then(result => {
      switch result {
      | Ok(json) =>
        switch json->JSON.Decode.array {
        | Some(arr) => Ok(arr)
        | None => Ok([])
        }
      | Error(e) => Error(e)
      }
      ->Promise.resolve
    })
  }
  
  /// Extract ID and name from timeline item
  let extractIdAndName = (item: JSON.t): option<(string, string)> => {
    item
    ->JSON.Decode.object
    ->Option.flatMap(obj => {
      let id = obj->Dict.get("id")->Option.flatMap(JSON.Decode.string)
      let name = obj->Dict.get("name")->Option.flatMap(JSON.Decode.string)
      switch (id, name) {
      | (Some(id), Some(name)) => Some((id, name))
      | _ => None
      }
    })
  }
}

// ============================================================================
// MiAuth - OAuth-like authentication
// ============================================================================

module MiAuth = {
  // Permission types
  type permission = [
    | #read_account | #write_account
    | #read_blocks | #write_blocks
    | #read_drive | #write_drive
    | #read_favorites | #write_favorites
    | #read_following | #write_following
    | #read_messaging | #write_messaging
    | #read_mutes | #write_mutes
    | #write_notes
    | #read_notifications | #write_notifications
    | #read_reactions | #write_reactions
    | #write_votes
    | #read_pages | #write_pages
    | #write_page_likes | #read_page_likes
    | #read_user_groups | #write_user_groups
    | #read_channels | #write_channels
    | #read_gallery | #write_gallery
    | #read_gallery_likes | #write_gallery_likes
    | #read_flash | #write_flash
    | #read_flash_likes | #write_flash_likes
  ]
  
  let permissionToString = (perm: permission): string => {
    switch perm {
    | #read_account => "read:account"
    | #write_account => "write:account"
    | #read_blocks => "read:blocks"
    | #write_blocks => "write:blocks"
    | #read_drive => "read:drive"
    | #write_drive => "write:drive"
    | #read_favorites => "read:favorites"
    | #write_favorites => "write:favorites"
    | #read_following => "read:following"
    | #write_following => "write:following"
    | #read_messaging => "read:messaging"
    | #write_messaging => "write:messaging"
    | #read_mutes => "read:mutes"
    | #write_mutes => "write:mutes"
    | #write_notes => "write:notes"
    | #read_notifications => "read:notifications"
    | #write_notifications => "write:notifications"
    | #read_reactions => "read:reactions"
    | #write_reactions => "write:reactions"
    | #write_votes => "write:votes"
    | #read_pages => "read:pages"
    | #write_pages => "write:pages"
    | #write_page_likes => "write:page-likes"
    | #read_page_likes => "read:page-likes"
    | #read_user_groups => "read:user-groups"
    | #write_user_groups => "write:user-groups"
    | #read_channels => "read:channels"
    | #write_channels => "write:channels"
    | #read_gallery => "read:gallery"
    | #write_gallery => "write:gallery"
    | #read_gallery_likes => "read:gallery-likes"
    | #write_gallery_likes => "write:gallery-likes"
    | #read_flash => "read:flash"
    | #write_flash => "write:flash"
    | #read_flash_likes => "read:flash-likes"
    | #write_flash_likes => "write:flash-likes"
    }
  }
  
  type authSession = {
    sessionId: string,
    authUrl: string,
  }
  
  type checkResult = {
    token: option<string>,
    user: option<JSON.t>,
  }
  
  @val external encodeURIComponent: string => string = "encodeURIComponent"
  @val @scope("crypto") external getRandomValues: Js.TypedArray2.Uint8Array.t => Js.TypedArray2.Uint8Array.t = "getRandomValues"
  @new external makeUint8Array: int => Js.TypedArray2.Uint8Array.t = "Uint8Array"
  
  let generateSessionId = (): string => {
    let array = makeUint8Array(16)
    let _ = getRandomValues(array)
    let hex = ref("")
    for i in 0 to 15 {
      let byte = Js.TypedArray2.Uint8Array.unsafe_get(array, i)
      let hexByte = byte->Int.toString(~radix=16)
      let padded = String.length(hexByte) == 1 ? "0" ++ hexByte : hexByte
      hex := hex.contents ++ padded
    }
    hex.contents
  }
  
  /// Generate MiAuth URL for user authorization
  /// 
  /// Example:
  ///   let session = Misskey.MiAuth.generateUrl(
  ///     ~origin="https://misskey.io",
  ///     ~name="My App",
  ///     ~permissions=[#read_account, #write_notes],
  ///     ()
  ///   )
  ///   // Redirect user to session.authUrl
  let generateUrl = (
    ~origin: string,
    ~name: string,
    ~permissions: array<permission>,
    ~callback: option<string>=?,
    ~icon: option<string>=?,
    (),
  ): authSession => {
    let sessionId = generateSessionId()
    let permissionStrings = permissions->Array.map(permissionToString)
    let permissionParam = permissionStrings->Array.join(",")
    let encodedName = encodeURIComponent(name)
    let encodedPermission = encodeURIComponent(permissionParam)
    
    let baseUrl = `${origin}/miauth/${sessionId}?name=${encodedName}&permission=${encodedPermission}`
    
    let withCallback = switch callback {
    | Some(cb) => {
        let encodedCallback = encodeURIComponent(cb)
        `${baseUrl}&callback=${encodedCallback}`
      }
    | None => baseUrl
    }
    
    let authUrl = switch icon {
    | Some(ic) => {
        let encodedIcon = encodeURIComponent(ic)
        `${withCallback}&icon=${encodedIcon}`
      }
    | None => withCallback
    }
    
    {sessionId, authUrl}
  }
  
  module Fetch = {
    type response
    type requestInit = {method: [#POST]}
    
    @val external fetch: (string, requestInit) => promise<response> = "fetch"
    
    module Response = {
      @get external ok: response => bool = "ok"
      @get external status: response => int = "status"
      @send external json: response => promise<JSON.t> = "json"
    }
  }
  
  /// Check if user has authorized the session
  /// 
  /// Example:
  ///   let result = await Misskey.MiAuth.check(~origin="https://misskey.io", ~sessionId=session.sessionId)
  ///   switch result {
  ///   | Ok({token: Some(token), user}) => // Success!
  ///   | Ok({token: None}) => // Still pending
  ///   | Error(e) => // Error
  ///   }
  let check = async (~origin: string, ~sessionId: string): result<checkResult, string> => {
    try {
      let url = `${origin}/api/miauth/${sessionId}/check`
      let response = await Fetch.fetch(url, {method: #POST})
      let ok = response->Fetch.Response.ok
      
      if !ok {
        Ok({token: None, user: None})
      } else {
        let json = await response->Fetch.Response.json
        let obj = json->JSON.Decode.object
        
        switch obj {
        | Some(obj) => {
            let token = obj->Dict.get("token")->Option.flatMap(JSON.Decode.string)
            let user = obj->Dict.get("user")
            Ok({token, user})
          }
        | None => Ok({token: None, user: None})
        }
      }
    } catch {
    | error => Error(%raw(`String(error)`))
    }
  }
  
  @val @scope("window") @scope("location") external windowLocationAssign: string => unit = "assign"
  
  /// Open auth URL in same window
  let openUrl = (authUrl: string): unit => {
    windowLocationAssign(authUrl)
  }
  
  @val @scope("window") external windowOpen: (string, string, string) => Nullable.t<{..}> = "open"
  
  /// Open auth URL in new window
  let openUrlInNewWindow = (authUrl: string): unit => {
    let _ = windowOpen(authUrl, "_blank", "width=600,height=800")
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

type apiError = {
  code: string,
  message: string,
  id: string,
}

/// Check if error is permission denied
let isPermissionDenied = (error: JSON.t): bool => {
  switch error->JSON.Decode.object {
  | Some(obj) =>
    switch obj->Dict.get("code")->Option.flatMap(JSON.Decode.string) {
    | Some("PERMISSION_DENIED") => true
    | _ => false
    }
  | None => false
  }
}

/// Check if error is API error and extract error info
let isAPIError = (error: JSON.t): option<apiError> => {
  switch error->JSON.Decode.object {
  | Some(obj) =>
    switch (
      obj->Dict.get("code")->Option.flatMap(JSON.Decode.string),
      obj->Dict.get("message")->Option.flatMap(JSON.Decode.string),
      obj->Dict.get("id")->Option.flatMap(JSON.Decode.string),
    ) {
    | (Some(code), Some(message), Some(id)) => Some({code, message, id})
    | _ => None
    }
  | None => None
  }
}

// ============================================================================
// Re-export useful constants
// ============================================================================

module Visibility = MisskeyJS_Constants.Visibility
module NotificationType = MisskeyJS_Constants.NotificationType
