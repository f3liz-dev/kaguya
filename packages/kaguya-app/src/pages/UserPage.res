// SPDX-License-Identifier: MPL-2.0

@jsx.component
let make = (~username: string, ~host: option<string>=?) => {
  let {state, setSentinelRef} = UserPageHook.useUserProfileTimeline(~username, ~host?)

  let formatCount = (n: int): string => {
    if n >= 1000000 {
      Float.toFixed(Int.toFloat(n) /. 1000000.0, ~digits=1) ++ "M"
    } else if n >= 1000 {
      Float.toFixed(Int.toFloat(n) /. 1000.0, ~digits=1) ++ "K"
    } else {
      Int.toString(n)
    }
  }

  <Layout>
    {switch state {
    | UserPageHook.Loading =>
      <div className="loading-container">
        <p> {Preact.string("読み込み中...")} </p>
      </div>
    | UserPageHook.Error(msg) =>
      <div className="user-error">
        <p> {Preact.string("エラー: " ++ msg)} </p>
      </div>
    | UserPageHook.Loaded({profile, pinnedNotes, notes, isLoadingMore, hasMore}) =>
      <div className="user-profile-container">
        // Banner
        {switch profile.bannerUrl {
        | Some(url) =>
          <div className="user-banner">
            <img src={url} alt="" className="user-banner-image" loading=#lazy />
          </div>
        | None =>
          <div className="user-banner user-banner-empty" />
        }}

        // Profile header
        <div className="user-profile-header">
          <div className="user-avatar-section">
            {if profile.avatarUrl != "" {
              <img
                className="user-avatar"
                src={profile.avatarUrl}
                alt={profile.username ++ "'s avatar"}
                loading=#lazy
              />
            } else {
              <div className="user-avatar user-avatar-placeholder" />
            }}
          </div>

          <div className="user-info">
            <h1 className="user-display-name">
              <MfmRenderer text={UserProfileView.displayName(profile)} parseSimple=true />
            </h1>
            <span className="user-username">
              {Preact.string(UserProfileView.fullUsername(profile))}
            </span>
            {if profile.isBot {
              <span className="user-bot-badge"> {Preact.string("🤖 Bot")} </span>
            } else {
              Preact.null
            }}
          </div>

          // Stats
          <div className="user-stats">
            <div className="user-stat">
              <span className="user-stat-value">
                {Preact.string(formatCount(profile.notesCount))}
              </span>
              <span className="user-stat-label"> {Preact.string("ノート")} </span>
            </div>
            <div className="user-stat">
              <span className="user-stat-value">
                {Preact.string(formatCount(profile.followingCount))}
              </span>
              <span className="user-stat-label"> {Preact.string("フォロー")} </span>
            </div>
            <div className="user-stat">
              <span className="user-stat-value">
                {Preact.string(formatCount(profile.followersCount))}
              </span>
              <span className="user-stat-label"> {Preact.string("フォロワー")} </span>
            </div>
          </div>
        </div>

        // Bio/Description
        {switch profile.description {
        | Some(desc) if desc != "" =>
          <div className="user-bio">
            <MfmRenderer text={desc} />
          </div>
        | _ => Preact.null
        }}

        // Fields (custom profile metadata)
        {if Array.length(profile.fields) > 0 {
          <div className="user-fields">
            {profile.fields
            ->Array.mapWithIndex((field, idx) => {
              <div key={Int.toString(idx)} className="user-field">
                <span className="user-field-name">
                  <MfmRenderer text={field.fieldName} parseSimple=true />
                </span>
                <span className="user-field-value">
                  <MfmRenderer text={field.fieldValue} />
                </span>
              </div>
            })
            ->Preact.array}
          </div>
        } else {
          Preact.null
        }}

        // Pinned notes
        {if Array.length(pinnedNotes) > 0 {
          <div className="user-pinned-notes">
            <h3 className="user-section-title"> {Preact.string("📌 ピン留め")} </h3>
            <div className="timeline-notes">
              {pinnedNotes
              ->Array.map(note => {
                <Note.NoteView key={note.id} note />
              })
              ->Preact.array}
            </div>
          </div>
        } else {
          Preact.null
        }}

        // User's notes
        <div className="user-notes-section">
          <h3 className="user-section-title"> {Preact.string("ノート")} </h3>
          {if Array.length(notes) == 0 {
            <div className="timeline-empty">
              <p> {Preact.string("ノートはまだありません")} </p>
            </div>
          } else {
            <>
              <div className="timeline-notes">
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
          }}
        </div>
      </div>
    }}
  </Layout>
}
