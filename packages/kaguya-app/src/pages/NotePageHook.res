// SPDX-License-Identifier: MPL-2.0

type state =
  | Loading
  | Loaded({
      note: NoteView.t,
      conversation: array<NoteView.t>,
      replies: array<NoteView.t>,
    })
  | Error(string)

type hookResult = {
  state: state,
  mainNoteRef: PreactHooks.ref<Nullable.t<Dom.element>>,
}

let resolveNote = async (
  client: Misskey.t,
  noteId: string,
  host: string,
  localHost: string,
): result<(string, JSON.t), string> => {
  if host == localHost {
    let result = await client->Misskey.Notes.show(noteId)
    switch result {
    | Ok(json) => Ok((noteId, json))
    | Error(msg) => Error(msg)
    }
  } else {
    let remoteUri = "https://" ++ host ++ "/notes/" ++ noteId
    let params = Dict.make()
    params->Dict.set("uri", remoteUri->JSON.Encode.string)
    let apResult = await client->Misskey.request("ap/show", ~params=params->JSON.Encode.object, ())
    switch apResult {
    | Ok(json) =>
      switch json->JSON.Decode.object {
      | Some(obj) =>
        let type_ = obj->Dict.get("type")->Option.flatMap(JSON.Decode.string)
        let object = obj->Dict.get("object")
        switch (type_, object) {
        | (Some("Note"), Some(noteJson)) =>
          let localNoteId = switch noteJson->JSON.Decode.object {
          | Some(noteObj) => noteObj->Dict.get("id")->Option.flatMap(JSON.Decode.string)->Option.getOr(noteId)
          | None => noteId
          }
          Ok((localNoteId, noteJson))
        | _ => Error("リモートURIがノートとして解決できませんでした")
        }
      | None => Error("ap/show の応答形式が不正です")
      }
    | Error(msg) => Error("リモートノートの取得に失敗: " ++ msg)
    }
  }
}

let useNoteThread = (~noteId: string, ~host: string): hookResult => {
  let (state, setState) = PreactHooks.useState(() => Loading)
  let (_, navigate) = Wouter.useLocation()
  let mainNoteRef: PreactHooks.ref<Nullable.t<Dom.element>> = PreactHooks.useRef(Nullable.null)

  PreactHooks.useEffect1(() => {
    switch state {
    | Loaded(_) =>
      mainNoteRef.current
      ->Nullable.toOption
      ->Option.forEach(HtmlElement.scrollIntoViewInstant)
    | _ => ()
    }
    None
  }, [state])

  PreactSignals.useSignalEffect(() => {
    setState(_ => Loading)
    PageLoading.start()

    // callDone is idempotent — only the first call decrements the counter.
    // Both the async path and the cleanup call it so they can't double-decrement.
    let doneRef = ref(false)
    let callDone = () => {
      if !doneRef.contents {
        doneRef := true
        PageLoading.done_()
      }
    }

    let fetchNote = async () => {
      let clientOpt = PreactSignals.value(AppState.client)
      let authState = PreactSignals.value(AppState.authState)
      let localHost = PreactSignals.value(AppState.instanceName)

      switch clientOpt {
      | Some(client) => {
          let resolved = await resolveNote(client, noteId, host, localHost)
          switch resolved {
          | Ok((localNoteId, _noteJson)) if host != localHost =>
            callDone()
            navigate("/notes/" ++ localNoteId ++ "/" ++ localHost)
          | Ok((localNoteId, noteJson)) =>
            switch NoteDecoder.decode(noteJson) {
            | Some(note) => {
                let (convResult, repliesResult) = await Promise.all2((
                  client->Misskey.Notes.conversation(localNoteId, ()),
                  client->Misskey.Notes.children(localNoteId, ()),
                ))

                let conversation = switch convResult {
                | Ok(json) => NoteDecoder.decodeManyFromJson(json)->Array.toReversed
                | Error(_) => []
                }
                let replies = switch repliesResult {
                | Ok(json) => NoteDecoder.decodeManyFromJson(json)
                | Error(_) => []
                }
                callDone()
                setState(_ => Loaded({note, conversation, replies}))
              }
            | None =>
              callDone()
              setState(_ => Error("ノートの解析に失敗しました"))
            }
          | Error(msg) =>
            callDone()
            setState(_ => Error(msg))
          }
        }
      | None =>
        if authState != LoggingIn {
          // Logged out with no client — definite error
          callDone()
          setState(_ => Error("接続されていません"))
        }
        // LoggingIn: keep the bar up; cleanup will call callDone when auth resolves
      }
    }

    let _ = fetchNote()
    Some(() => callDone())
  })

  {state, mainNoteRef}
}
