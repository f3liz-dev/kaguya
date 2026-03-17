// SPDX-License-Identifier: MPL-2.0

// Use shared types
type reactionAcceptance = SharedTypes.reactionAcceptance

@jsx.component
let make = (
  ~noteId: string,
  ~reactions: Dict.t<int>,
  ~reactionEmojis: Dict.t<string>,
  ~myReaction: option<string>,
  ~reactionAcceptance: option<reactionAcceptance>,
) => {
  let {
    isLoading,
    showEmojiPicker,
    reactionArray,
    optimisticMyReaction,
    isLoggedIn,
    isReadOnly,
    handleReactionClick,
    handleEmojiSelect,
    openEmojiPicker,
    closeEmojiPicker,
  } = ReactionBarHook.useReactionBar(~noteId, ~reactions, ~myReaction)

  // Don't render if no reactions and not logged in
  if reactionArray->Array.length == 0 && !isLoggedIn {
    Preact.null
  } else {
    let containerStyle = Style.make(
      ~display="flex",
      ~flexWrap="wrap",
      ~gap="6px",
      ~alignItems="center",
      ~marginTop="8px",
      (),
    )

    <div style={containerStyle} role="group" ariaLabel="Reactions">
      {reactionArray
      ->Array.map(((reaction, count)) => {
        let isActive = optimisticMyReaction->Option.getOr("") == reaction

        let buttonStyle = Style.make(
          ~display="flex",
          ~alignItems="center",
          ~justifyContent="center",
          ~gap="3px",
          ~border="none",
          ~background=isActive ? "var(--pico-primary-focus)" : "var(--pico-card-border-color)",
          ~color=isActive ? "var(--pico-color)" : "inherit",
          ~padding="4px 8px",
          ~borderRadius="12px",
          ~cursor=isReadOnly ? "not-allowed" : "pointer",
          ~transition="all 0.2s ease",
          ~fontSize="13px",
          ~fontWeight="500",
          ~userSelect="none",
          ~whiteSpace="nowrap",
          ~overflow="hidden",
          ~textOverflow="ellipsis",
          ~maxWidth="150px",
          ~height="28px",
          ~lineHeight="1",
          ~flex="0 0 auto",
          ~opacity=isReadOnly && isActive ? "0.7" : "1",
          (),
        )

        <button
          key={reaction}
          style={buttonStyle}
          onMouseEnter={e => {
            if !isReadOnly {
              let target = JsxEvent.Mouse.currentTarget(e)
              HtmlElement.setBackground(
                target,
                isActive ? "var(--pico-primary-focus)" : "var(--pico-muted-border-color)",
              )
            }
          }}
          onMouseLeave={e => {
            if !isReadOnly {
              let target = JsxEvent.Mouse.currentTarget(e)
              HtmlElement.setBackground(
                target,
                isActive ? "var(--pico-primary-focus)" : "var(--pico-card-border-color)",
              )
            }
          }}
          onClick={_ => {
            if isLoggedIn && !isReadOnly {
              handleReactionClick(reaction)
            }
          }}
          disabled={isLoading || isReadOnly}
          title={if isReadOnly {
            "Read-only mode: Cannot react"
          } else if isActive {
            "Remove your reaction"
          } else {
            "React with " ++ reaction
          }}
          ariaLabel={if isReadOnly {
            "Read-only mode: Cannot react"
          } else if isActive {
            "Remove your " ++ reaction ++ " reaction"
          } else {
            "React with " ++ reaction
          }}
          ariaPressed={isActive ? #"true" : #"false"}
          type_="button"
        >
          <ReactionButton reaction={reaction} count={count} reactionEmojis={reactionEmojis} />
        </button>
      })
      ->Preact.array}

      {if isLoggedIn && !isReadOnly {
        let addButtonStyle = Style.make(
          ~display="flex",
          ~alignItems="center",
          ~justifyContent="center",
          ~width="28px",
          ~height="28px",
          ~border="none",
          ~background="var(--pico-card-border-color)",
          ~borderRadius="12px",
          ~cursor="pointer",
          ~transition="all 0.2s ease",
          ~fontSize="14px",
          ~fontWeight="bold",
          ~userSelect="none",
          ~padding="0",
          ~lineHeight="1",
          (),
        )

        <button
          style={addButtonStyle}
          onMouseEnter={e => {
            let target = JsxEvent.Mouse.currentTarget(e)
            HtmlElement.setBackground(target, "var(--pico-muted-border-color)")
          }}
          onMouseLeave={e => {
            let target = JsxEvent.Mouse.currentTarget(e)
            HtmlElement.setBackground(target, "var(--pico-card-border-color)")
          }}
          onClick={_ => openEmojiPicker()}
          disabled={isLoading}
          title="Add reaction"
          ariaLabel="Add reaction"
          type_="button"
        >
          {Preact.string("+")}
        </button>
      } else {
        Preact.null
      }}

      {if showEmojiPicker {
        switch reactionAcceptance {
        | Some(acceptance) =>
          <EmojiPicker
            onSelect={handleEmojiSelect}
            onClose={closeEmojiPicker}
            reactionAcceptance={acceptance}
          />
        | None =>
          <EmojiPicker
            onSelect={handleEmojiSelect} onClose={closeEmojiPicker}
          />
        }
      } else {
        Preact.null
      }}
    </div>
  }
}
