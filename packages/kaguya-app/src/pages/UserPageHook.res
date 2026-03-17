// SPDX-License-Identifier: MPL-2.0

type state =
  | Loading
  | Loaded({
      profile: UserProfileView.t,
      pinnedNotes: array<NoteView.t>,
      notes: array<NoteView.t>,
      lastNoteId: option<string>,
      hasMore: bool,
      isLoadingMore: bool,
    })
  | Error(string)

type hookResult = {
  state: state,
  setSentinelRef: Nullable.t<Dom.element> => unit,
}

let getLastNoteId = (notes: array<NoteView.t>): option<string> => {
  notes->Array.at(-1)->Option.map(n => n.id)
}

let useUserProfileTimeline = (~username: string, ~host: option<string>=?): hookResult => {
  let (state, setState) = PreactHooks.useState(() => Loading)

  let sentinelRef = PreactHooks.useRef(Nullable.null)
  let setSentinelRef = (element: Nullable.t<Dom.element>): unit => {
    sentinelRef.current = element
  }

  PreactHooks.useEffect2(() => {
    setState(_ => Loading)

    let fetchProfile = async () => {
      switch PreactSignals.value(AppState.client) {
      | Some(client) => {
          let profileResult = await client->Misskey.Users.show(
            ~username,
            ~host?,
            (),
          )

          switch profileResult {
          | Ok(profileJson) =>
            switch UserProfileView.decode(profileJson) {
            | Some(profile) => {
                let pinnedPromises =
                  profile.pinnedNoteIds->Array.map(async noteId => {
                    let r = await client->Misskey.Notes.show(noteId)
                    switch r {
                    | Ok(json) => NoteDecoder.decode(json)
                    | Error(_) => None
                    }
                  })

                let (notesResult, pinnedResults) = await Promise.all2((
                  client->Misskey.Users.notes(profile.id, ()),
                  Promise.all(pinnedPromises),
                ))

                let pinnedNotes = pinnedResults->Array.filterMap(x => x)

                switch notesResult {
                | Ok(notesJson) => {
                    let notes = NoteDecoder.decodeManyFromJson(notesJson)
                    setState(_ => Loaded({
                      profile,
                      pinnedNotes,
                      notes,
                      lastNoteId: getLastNoteId(notes),
                      hasMore: Array.length(notes) >= 20,
                      isLoadingMore: false,
                    }))
                  }
                | Error(msg) =>
                  setState(_ => Loaded({
                    profile,
                    pinnedNotes,
                    notes: [],
                    lastNoteId: None,
                    hasMore: false,
                    isLoadingMore: false,
                  }))
                  Console.error2("Failed to fetch user notes:", msg)
                }
              }
            | None => setState(_ => Error("ユーザー情報の解析に失敗しました"))
            }
          | Error(msg) => setState(_ => Error(msg))
          }
        }
      | None => setState(_ => Error("接続されていません"))
      }
    }

    let _ = fetchProfile()
    None
  }, (username, host))

  let loadMore = async () => {
    switch state {
    | Loaded({profile, notes, lastNoteId: Some(lastId), hasMore: true, isLoadingMore: false} as data) => {
        setState(_ => Loaded({...data, isLoadingMore: true}))

        switch PreactSignals.value(AppState.client) {
        | Some(client) => {
            let result = await client->Misskey.Users.notes(
              profile.id,
              ~untilId=lastId,
              (),
            )

            switch result {
            | Ok(newJson) => {
                let newNotes = NoteDecoder.decodeManyFromJson(newJson)
                let allNotes = Array.concat(notes, newNotes)
                setState(_ => Loaded({
                  ...data,
                  notes: allNotes,
                  lastNoteId: getLastNoteId(newNotes),
                  hasMore: Array.length(newNotes) >= 20,
                  isLoadingMore: false,
                }))
              }
            | Error(_) =>
              setState(_ => Loaded({...data, isLoadingMore: false}))
            }
          }
        | None =>
          setState(_ => Loaded({...data, isLoadingMore: false}))
        }
      }
    | _ => ()
    }
  }
  let _ = loadMore

  PreactHooks.useEffect1(() => {
    let sentinel = sentinelRef.current
    if !Nullable.isNullable(sentinel) {
      let element = sentinel->Nullable.toOption->Option.getOrThrow
      let (_observer, cleanup) = IntersectionObserver.makeObserver(
        element,
        () => {
          let _ = loadMore()
        },
        ~threshold=0.1,
        (),
      )
      Some(cleanup)
    } else {
      None
    }
  }, [state])

  {state, setSentinelRef}
}
