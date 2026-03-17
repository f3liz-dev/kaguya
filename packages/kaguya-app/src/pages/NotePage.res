// SPDX-License-Identifier: MPL-2.0

@jsx.component
let make = (~noteId: string, ~host: string) => {
  let {state, mainNoteRef} = NotePageHook.useNoteThread(~noteId, ~host)

  <Layout>
    {switch state {
    | NotePageHook.Loading =>
      <div className="loading-container">
        <p> {Preact.string("読み込み中...")} </p>
      </div>
    | NotePageHook.Error(msg) =>
      <div className="note-page-error">
        <p> {Preact.string("エラー: " ++ msg)} </p>
      </div>
    | NotePageHook.Loaded({note, conversation, replies}) =>
      <div className="note-page-container">
        // Federated note warning — shown when note has a uri (originated on another instance)
        {switch note.uri {
        | Some(uri) =>
          <div className="note-remote-warning" role="status">
            <p>
              {Preact.string("⚠ このノートは連合先から取得されたコピーです。元のノートより情報が不完全な場合があります。")}
            </p>
            <a
              href={uri}
              target="_blank"
              rel="noopener noreferrer"
              className="note-original-link"
            >
              {Preact.string("元のノートを見る →")}
            </a>
          </div>
        | None => Preact.null
        }}

        // Conversation context (parent notes)
        {if Array.length(conversation) > 0 {
          <div className="note-conversation">
            <div className="timeline-notes">
              {conversation
              ->Array.map(n => {
                <Note.NoteView key={n.id} note=n />
              })
              ->Preact.array}
            </div>
            <div className="note-thread-connector" />
          </div>
        } else {
          Preact.null
        }}

        // Main note (highlighted)
        <div className="note-page-main" ref={mainNoteRef->Obj.magic}>
          <Note.NoteView note />
        </div>

        // Reply form
        <PostForm replyTo=note placeholder="返信を書き込む..." />

        // Replies
        {if Array.length(replies) > 0 {
          <div className="note-replies">
            <h3 className="note-replies-title"> {Preact.string("返信")} </h3>
            <div className="timeline-notes">
              {replies
              ->Array.map(n => {
                <Note.NoteView key={n.id} note=n />
              })
              ->Preact.array}
            </div>
          </div>
        } else {
          Preact.null
        }}
      </div>
    }}
  </Layout>
}
