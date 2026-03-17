// SPDX-License-Identifier: MPL-2.0

@jsx.component
let make = (~placeholder: string="今何してる？", ~replyTo: option<NoteView.t>=?, ~onPosted: option<unit => unit>=?) => {
  let composer = PostFormHook.usePostComposer(~replyTo?, ~onPosted?)
  let {
    text,
    isPosting,
    visibility,
    cw,
    showCw,
    showVisibilityMenu,
    attachedFiles,
    uploadingCount,
    inputRef,
    fileInputRef,
    setTextValue,
    setCwValue,
    toggleCw,
    toggleVisibilityMenu,
    setVisibilityAndClose,
    handleSubmit,
    handleFileChange,
    handlePaste,
    removeAttachment,
    openFilePicker,
    canAttachMore,
  } = composer

  let containerClass = "post-form-container expanded"

  <div className={containerClass}>
    <form onSubmit={handleSubmit}>
      {if showCw {
        <div className="post-form-cw fade-in">
          <input
            type_="text"
            placeholder="閲覧注意（CW）の注釈"
            value={cw}
             onInput={e => {
               let val = JsxEvent.Form.currentTarget(e)["value"]
               setCwValue(val)
             }}
             disabled={isPosting}
             className="cw-input"
          />
        </div>
      } else {
        Preact.null
      }}

      <div className="post-form-main">
        <textarea
          ref={inputRef->Obj.magic}
          className="post-form-textarea"
          placeholder={placeholder}
          value={text}
            onInput={e => {
              let val = JsxEvent.Form.currentTarget(e)["value"]
              setTextValue(val)
              let target = JsxEvent.Form.currentTarget(e)
              target["style"]["height"] = "auto"
              target["style"]["height"] = (Int.toString(target["scrollHeight"]) ++ "px")
          }}
          onPaste={handlePaste}
          disabled={isPosting}
          rows={3}
        />
      </div>

      {if Array.length(attachedFiles) > 0 {
        <div className="post-form-attachments fade-in">
          {attachedFiles
          ->Array.mapWithIndex((item, idx) =>
            <div className={"attachment-preview" ++ (if uploadingCount > 0 { " uploading" } else { "" })} key={Int.toString(idx)}>
              <img src={item.preview} className="attachment-img" alt="添付画像" />
              {if uploadingCount > 0 {
                <div className="attachment-upload-overlay">
                  <iconify-icon icon="tabler:loader-2" className="attachment-upload-spinner" />
                </div>
              } else {
                <button
                  type_="button"
                  className="attachment-remove"
                  onClick={_ => removeAttachment(idx)}
                  ariaLabel="削除"
                  disabled={isPosting}
                >
                  <iconify-icon icon="tabler:x" />
                </button>
              }}
            </div>
          )
          ->Preact.array}
        </div>
      } else {
        Preact.null
      }}

      <input
        ref={fileInputRef->Obj.magic}
        type_="file"
        accept="image/*"
        multiple={true}
        className="post-form-file-input"
        onChange={handleFileChange}
        disabled={isPosting}
      />

      {
        <div className="post-form-footer">
          <div className="post-form-tools">
            <button
              type_="button"
              className={"tool-btn" ++ (if showCw { " active" } else { "" })}
              onClick={_ => toggleCw()}
              title="閲覧注意 (CW)"
            >
              <iconify-icon icon="tabler:eye" />
            </button>

            <button
              type_="button"
              className="tool-btn"
              onClick={_ => openFilePicker()}
              title="画像を添付"
              ariaLabel="画像を添付"
              disabled={isPosting || !canAttachMore}
            >
              <iconify-icon icon="tabler:photo-plus" />
            </button>
            
            <div className="visibility-selector">
              <button
                type_="button"
                className="visibility-trigger tool-btn"
                onClick={_ => toggleVisibilityMenu()}
                disabled={isPosting}
                title="公開範囲"
              >
                <iconify-icon icon={switch visibility {
                  | #public => "tabler:world"
                  | #home => "tabler:home"
                  | #followers => "tabler:lock"
                  | #specified => "tabler:mail"
                }} />
                <iconify-icon icon="tabler:chevron-down" className="vis-chevron" />
              </button>
              {if showVisibilityMenu {
                <ul className="visibility-menu">
                  <li>
                    <button type_="button" className={"visibility-option" ++ (if visibility == #public { " active" } else { "" })}
                      onClick={_ => setVisibilityAndClose(#public)}>
                      <iconify-icon icon="tabler:world" />
                      {Preact.string("パブリック")}
                    </button>
                  </li>
                  <li>
                    <button type_="button" className={"visibility-option" ++ (if visibility == #home { " active" } else { "" })}
                      onClick={_ => setVisibilityAndClose(#home)}>
                      <iconify-icon icon="tabler:home" />
                      {Preact.string("ホームのみ")}
                    </button>
                  </li>
                  <li>
                    <button type_="button" className={"visibility-option" ++ (if visibility == #followers { " active" } else { "" })}
                      onClick={_ => setVisibilityAndClose(#followers)}>
                      <iconify-icon icon="tabler:lock" />
                      {Preact.string("フォロワー限定")}
                    </button>
                  </li>
                </ul>
              } else {
                Preact.null
              }}
            </div>
          </div>
          
          <div className="post-form-actions">
            <button
              type_="submit"
              disabled={isPosting || (text == "" && Array.length(attachedFiles) == 0)}
              className="post-btn"
            >
              {if isPosting {
                <> <iconify-icon icon="tabler:loader-2" className="spin" /> {Preact.string(" 送信中...")} </>
              } else {
                <> <iconify-icon icon="tabler:send" /> {Preact.string(" ノート")} </>
              }}
            </button>
          </div>
        </div>
      }
    </form>
  </div>
}
