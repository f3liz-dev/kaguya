// SPDX-License-Identifier: MPL-2.0

type reactionAcceptance = SharedTypes.reactionAcceptance

type hookResult = {
  isLoading: bool,
  showEmojiPicker: bool,
  reactionArray: array<(string, int)>,
  optimisticMyReaction: option<string>,
  isLoggedIn: bool,
  isReadOnly: bool,
  handleReactionClick: string => unit,
  handleEmojiSelect: string => unit,
  openEmojiPicker: unit => unit,
  closeEmojiPicker: unit => unit,
}

let useReactionBar = (
  ~noteId: string,
  ~reactions: Dict.t<int>,
  ~myReaction: option<string>,
): hookResult => {
  let (isLoading, setIsLoading) = PreactHooks.useState(() => false)
  let (showEmojiPicker, setShowEmojiPicker) = PreactHooks.useState(() => false)
  let (optimisticReactions, setOptimisticReactions) = PreactHooks.useState(() => reactions)
  let (optimisticMyReaction, setOptimisticMyReaction) = PreactHooks.useState(() => myReaction)

  PreactHooks.useEffect2(() => {
    setOptimisticReactions(_ => reactions)
    None
  }, (reactions, noteId))

  PreactHooks.useEffect2(() => {
    setOptimisticMyReaction(_ => myReaction)
    None
  }, (myReaction, noteId))

  let handleReactionClick = (reaction: string) => {
    let _ = (async () => {
      let client = PreactSignals.value(AppState.client)
      let isLoggedIn = PreactSignals.value(AppState.isLoggedIn)
      let isReadOnly = AppState.isReadOnlyMode()

      if isReadOnly {
        ToastState.showError("Cannot react: You're in read-only mode")
        ()
      } else if isLoading || !isLoggedIn {
        ()
      } else {
        switch client {
        | None => ()
        | Some(c) => {
            setIsLoading(_ => true)
            let shouldRemove = optimisticMyReaction->Option.getOr("") == reaction

            if shouldRemove {
              setOptimisticMyReaction(_ => None)
              setOptimisticReactions(prev => {
                let newDict = Dict.make()
                prev
                ->Dict.toArray
                ->Array.forEach(((r, count)) => {
                  if r == reaction {
                    let newCount = count - 1
                    if newCount > 0 {
                      newDict->Dict.set(r, newCount)
                    }
                  } else {
                    newDict->Dict.set(r, count)
                  }
                })
                newDict
              })

              let result = await c->Misskey.Notes.unreact(noteId)
              switch result {
              | Ok(_) => setIsLoading(_ => false)
              | Error(msg) => {
                  ToastState.showError("Failed to remove reaction: " ++ msg)
                  setOptimisticMyReaction(_ => myReaction)
                  setOptimisticReactions(_ => reactions)
                  setIsLoading(_ => false)
                }
              }
            } else {
              let oldReaction = optimisticMyReaction
              setOptimisticMyReaction(_ => Some(reaction))
              setOptimisticReactions(prev => {
                let newDict = Dict.make()
                prev
                ->Dict.toArray
                ->Array.forEach(((r, count)) => {
                  if r == reaction {
                    newDict->Dict.set(r, count + 1)
                  } else if Some(r) == oldReaction {
                    let newCount = count - 1
                    if newCount > 0 {
                      newDict->Dict.set(r, newCount)
                    }
                  } else {
                    newDict->Dict.set(r, count)
                  }
                })
                if prev->Dict.get(reaction)->Option.isNone {
                  newDict->Dict.set(reaction, 1)
                }
                newDict
              })

              let result = await c->Misskey.Notes.react(noteId, reaction)
              switch result {
              | Ok(_) => setIsLoading(_ => false)
              | Error(msg) => {
                  ToastState.showError("Failed to add reaction: " ++ msg)
                  setOptimisticMyReaction(_ => myReaction)
                  setOptimisticReactions(_ => reactions)
                  setIsLoading(_ => false)
                }
              }
            }
          }
        }
      }
    })()
  }

  let handleEmojiSelect = (emoji: string) => handleReactionClick(emoji)
  let openEmojiPicker = () => setShowEmojiPicker(_ => true)
  let closeEmojiPicker = () => setShowEmojiPicker(_ => false)

  let reactionArray =
    optimisticReactions
    ->Dict.toArray
    ->Array.toSorted(((_, countA), (_, countB)) => Float.fromInt(countB) -. Float.fromInt(countA))

  {
    isLoading,
    showEmojiPicker,
    reactionArray,
    optimisticMyReaction,
    isLoggedIn: PreactSignals.value(AppState.isLoggedIn),
    isReadOnly: AppState.isReadOnlyMode(),
    handleReactionClick,
    handleEmojiSelect,
    openEmojiPicker,
    closeEmojiPicker,
  }
}
