// SPDX-License-Identifier: MPL-2.0

type timelineState =
  | Loading
  | Loaded({
      notes: array<NoteView.t>,
      lastPostId: option<string>,
      hasMore: bool,
      isLoadingMore: bool,
      isStreaming: bool,
    })
  | Error(string)

let getExnMessage = (exn: exn): string => {
  switch exn->JsExn.fromException {
  | Some(jsExn) => JsExn.message(jsExn)->Option.getOr("Unknown error")
  | None => "Unknown error"
  }
}

let getLastNoteId = (notes: array<NoteView.t>): option<string> => {
  notes->Array.at(-1)->Option.map(note => note.id)
}

let noteExists = (notes: array<NoteView.t>, noteId: string): bool => {
  notes->Array.some(note => note.id == noteId)
}

@jsx.component
let make = (~timelineType: Misskey.Stream.timelineType, ~name: string="") => {
  // Track render performance
  let _ = PerfMonitor.useRenderMetrics(~component="Timeline")

  let (state, setState) = PreactHooks.useState(() => Loading)

  // Keep a stable ref to the latest state so the visibilitychange handler
  // (mounted once in useEffect0) always sees up-to-date values.
  let stateRef = PreactHooks.useRef(state)
  stateRef.current = state
  let timelineTypeRef = PreactHooks.useRef(timelineType)
  timelineTypeRef.current = timelineType

  // Ref to store the streaming subscription
  let subscriptionRef = PreactHooks.useRef(None)

  // Helper: create a stream note callback (reused on initial load and visibility reconnect)
  let makeStreamCallback = () => {
    newNote => {
      let decodedNote = NoteDecoder.decode(newNote)
      let _ = (
        async () => {
          // Prefetch images and wait until cached before rendering
          switch decodedNote {
          | Some(noteData) => await NoteOps.prefetchImagesAsync(noteData)
          | None => ()
          }
          setState(prev => {
            switch (prev, decodedNote) {
            | (Loaded(data), Some(noteData)) => {
                let shouldAdd = !noteExists(data.notes, noteData.id)
                if shouldAdd {
                  Loaded({...data, notes: [noteData]->Array.concat(data.notes)})
                } else {
                  prev
                }
              }
            | _ => prev
            }
          })
        }
      )()
    }
  }

  // We need to watch both the client signal and the timelineType prop
  PreactHooks.useEffect2(() => {
    // Read the current client value from the signal
    let clientOpt = PreactSignals.value(AppState.client)

    // Cancellation token: set to true when this effect is cleaned up.
    // Prevents a stale async fetch from overwriting state after tab switch.
    let cancelled = ref(false)

    setState(_ => Loading)

    let fetchTimeline = async () => {
      switch clientOpt {
      | Some(client) => {
          let cachedTimelineOpt = switch timelineType {
          | #home => PreactSignals.value(TimelineStore.homeTimelineInitial)
          | _ => None
          }

          switch cachedTimelineOpt {
          | Some(rawJson) =>
            if cancelled.contents {
              ()
            } else {
              // Use cached data and setup stream subscription
              let notes = NoteDecoder.decodeManyFromJson(rawJson)
              let lastPostId = getLastNoteId(notes)

              // Prefetch image domains from cached notes
              NetworkOptimizer.extractImageDomainsFromNotes([rawJson])

              setState(_ => Loaded({
                notes,
                lastPostId,
                hasMore: Array.length(notes) >= 20,
                isLoadingMore: false,
                isStreaming: false,
              }))

              // Start streaming subscription after loading cached data
              let subscription = client->Misskey.Stream.timeline(timelineType, makeStreamCallback())
              subscriptionRef.current = Some(subscription)
              setState(prev => {
                switch prev {
                | Loaded(data) => Loaded({...data, isStreaming: true})
                | _ => prev
                }
              })
            }
          | None => {
              // No cache, fetch from API and setup stream in parallel
              let notesPromise = client->Misskey.Notes.fetch(timelineType, ~limit=20, ())

              if !cancelled.contents {
                // Start stream subscription immediately (doesn't await the fetch)
                let subscription =
                  client->Misskey.Stream.timeline(timelineType, makeStreamCallback())
                subscriptionRef.current = Some(subscription)

                // Now await the notes fetch
                let result = await notesPromise

                if !cancelled.contents {
                  switch result {
                  | Ok(rawJson) => {
                      let notes = NoteDecoder.decodeManyFromJson(rawJson)
                      let lastPostId = getLastNoteId(notes)

                      // Prefetch image domains from initial notes
                      NetworkOptimizer.extractImageDomainsFromNotes([rawJson])

                      setState(_ => Loaded({
                        notes,
                        lastPostId,
                        hasMore: Array.length(notes) >= 20,
                        isLoadingMore: false,
                        isStreaming: true, // Already subscribed
                      }))
                    }
                  | Error(msg) => {
                      // If fetch failed, clean up the subscription
                      subscriptionRef.current->Option.forEach(sub => sub.dispose())
                      subscriptionRef.current = None
                      setState(_ => Error(msg))
                    }
                  }
                }
              }
            }
          }
        }
      | None => {
          let authState = PreactSignals.value(AppState.authState)
          if authState != LoggingIn {
            setState(_ => Error("接続されていません"))
          }
        }
      }
    }

    let _ = fetchTimeline()

    // Cleanup: cancel pending fetch, dispose subscription when timeline changes or unmounts
    Some(
      () => {
        cancelled := true
        subscriptionRef.current->Option.forEach(sub => {
          sub.dispose()
        })
        subscriptionRef.current = None
      },
    )
  }, (PreactSignals.value(AppState.client), timelineType))

  // Catch up on missed notes and re-establish stream when the page becomes visible again
  PreactHooks.useEffect0(() => {
    let _handleVisibility = (_: Dom.event) => {
      let isVisible = Document.visibilityState === "visible"
      if isVisible {
        switch (PreactSignals.value(AppState.client), stateRef.current) {
        | (Some(client), Loaded(data)) => {
            let newestId = data.notes->Array.at(0)->Option.map(n => n.id)
            let tt = timelineTypeRef.current

            // Re-establish streaming subscription (WebSocket may have dropped)
            subscriptionRef.current->Option.forEach(sub => sub.dispose())
            let subscription = client->Misskey.Stream.timeline(tt, makeStreamCallback())
            subscriptionRef.current = Some(subscription)
            setState(prev =>
              switch prev {
              | Loaded(d) => Loaded({...d, isStreaming: true})
              | _ => prev
              }
            )

            // Fetch any notes missed while in the background
            let _ = (
              async () => {
                let result = await client->Misskey.Notes.fetch(
                  tt,
                  ~limit=20,
                  ~sinceId=?newestId,
                  (),
                )
                switch result {
                | Ok(rawJson) => {
                    let newNotes = NoteDecoder.decodeManyFromJson(rawJson)
                    if Array.length(newNotes) > 0 {
                      setState(prev =>
                        switch prev {
                        | Loaded(d) =>
                          let merged = Array.concat(newNotes, d.notes)
                          Loaded({...d, notes: merged})
                        | _ => prev
                        }
                      )
                    }
                  }
                | Error(_) => () // silently ignore catch-up failures
                }
              }
            )()
          }
        | _ => ()
        }
      }
    }
    Document.addEventListener("visibilitychange", _handleVisibility)
    Some(
      () => {
        Document.removeEventListener("visibilitychange", _handleVisibility)
      },
    )
  })

  let handleRefresh = async () => {
    // Preserve streaming state during refresh
    let wasStreaming = subscriptionRef.current->Option.isSome
    setState(_ => Loading)

    switch PreactSignals.value(AppState.client) {
    | Some(client) => {
        let result = await client->Misskey.Notes.fetch(timelineType, ~limit=20, ())

        switch result {
        | Ok(rawJson) => {
            let notes = NoteDecoder.decodeManyFromJson(rawJson)
            let lastPostId = getLastNoteId(notes)
            setState(_ => Loaded({
              notes,
              lastPostId,
              hasMore: Array.length(notes) >= 20,
              isLoadingMore: false,
              isStreaming: wasStreaming,
            }))
          }
        | Error(msg) => setState(_ => Error(msg))
        }
      }
    | None => setState(_ => Error("接続されていません"))
    }
  }

  let onRefreshClick = (_: JsxEvent.Mouse.t) => {
    let _ = handleRefresh()
  }

  let loadMore = async () => {
    switch state {
    | Loaded({
        notes,
        lastPostId: Some(lastId),
        hasMore: true,
        isLoadingMore: false,
        isStreaming,
      }) => {
        setState(prev => {
          switch prev {
          | Loaded(data) => Loaded({...data, isLoadingMore: true})
          | _ => prev
          }
        })

        switch PreactSignals.value(AppState.client) {
        | Some(client) => {
            let result = await client->Misskey.Notes.fetch(
              timelineType,
              ~limit=20,
              ~untilId=lastId,
              (),
            )

            switch result {
            | Ok(newRawJson) => {
                let newNotes = NoteDecoder.decodeManyFromJson(newRawJson)

                // Prefetch image domains from new notes
                NetworkOptimizer.extractImageDomainsFromNotes([newRawJson])

                let allNotes = Array.concat(notes, newNotes)
                let newLastPostId = getLastNoteId(newNotes)
                setState(_ => Loaded({
                  notes: allNotes,
                  lastPostId: newLastPostId,
                  hasMore: Array.length(newNotes) >= 20,
                  isLoadingMore: false,
                  isStreaming,
                }))
              }
            | Error(_) =>
              // Reset loading state on error
              setState(prev => {
                switch prev {
                | Loaded(data) => Loaded({...data, isLoadingMore: false})
                | _ => prev
                }
              })
            }
          }
        | None =>
          // Reset loading state if no client
          setState(prev => {
            switch prev {
            | Loaded(data) => Loaded({...data, isLoadingMore: false})
            | _ => prev
            }
          })
        }
      }
    | _ => () // Do nothing if not in the right state
    }
  }
  let _ = loadMore // Suppress unused warning - used in raw JS below

  // Ref for the sentinel element at the bottom of the timeline
  let sentinelRef = PreactHooks.useRef(Nullable.null)

  // Callback ref function to set the sentinel element
  let setSentinelRef = (element: Nullable.t<Dom.element>): unit => {
    sentinelRef.current = element
  }

  // Setup IntersectionObserver for infinite scroll
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

  <div className="timeline">
    <div className="timeline-header">
      <div className="timeline-header-left">
        <h2>
          {Preact.string(
            if name != "" {
              name
            } else {
              switch timelineType {
              | #home => "ホーム"
              | #local => "ローカル"
              | #global => "グローバル"
              | #hybrid => "ソーシャル"
              | #antenna(_) => "アンテナ"
              | #list(_) => "リスト"
              | #channel(_) => "チャンネル"
              }
            },
          )}
        </h2>
        {switch state {
        | Loading =>
          <span
            className="timeline-loading-indicator"
            style={Style.make(
              ~display="inline-flex",
              ~alignItems="center",
              ~gap="0.3rem",
              ~fontSize="0.85rem",
              ~color="var(--text-muted)",
              ~fontWeight="500",
              (),
            )}
          >
            <iconify-icon
              icon="tabler:loader-2" style={Style.make(~animation="spin 1s linear infinite", ())}
            />
            {Preact.string("読み込み中...")}
          </span>
        | Loaded({isStreaming: true}) =>
          <span
            className="streaming-indicator"
            title="配信中"
            style={Style.make(
              ~display="inline-flex",
              ~alignItems="center",
              ~gap="0.3rem",
              ~fontSize="0.85rem",
              ~color="#10b981",
              ~fontWeight="600",
              (),
            )}
          >
            <span
              style={Style.make(
                ~width="8px",
                ~height="8px",
                ~borderRadius="50%",
                ~backgroundColor="#10b981",
                ~animation="pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                (),
              )}
            />
            {Preact.string("配信中")}
          </span>
        | _ => Preact.null
        }}
      </div>
      <button className="secondary outline" onClick={onRefreshClick}>
        {Preact.string("更新")}
      </button>
    </div>
    {switch state {
    | Loading => Preact.null
    | Error(msg) =>
      <div className="timeline-error">
        <p> {Preact.string("エラー: " ++ msg)} </p>
        <button onClick={onRefreshClick}> {Preact.string("再試行")} </button>
      </div>
    | Loaded({notes, isLoadingMore, hasMore, isStreaming: _}) =>
      if Array.length(notes) == 0 {
        <div className="timeline-empty">
          <p> {Preact.string("ノートはまだありません")} </p>
        </div>
      } else {
        <>
          <div className="timeline-notes" style={{maxWidth: "800px"}}>
            {notes
            ->Array.map(note => {
              <Note.NoteView key={note.id} note />
            })
            ->Preact.array}
          </div>
          {if hasMore {
            <>
              <div ref={setSentinelRef->Obj.magic} className="timeline-sentinel" />
              {if isLoadingMore {
                <div className="timeline-loading-more">
                  <p> {Preact.string("読み込み中...")} </p>
                </div>
              } else {
                Preact.null
              }}
            </>
          } else {
            <div className="timeline-end">
              <p> {Preact.string("これ以上ありません")} </p>
            </div>
          }}
        </>
      }
    }}
  </div>
}
