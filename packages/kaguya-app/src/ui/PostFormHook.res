// SPDX-License-Identifier: MPL-2.0

@val external _arrayFrom: {..} => array<{..}> = "Array.from"
@val external _createObjectURL: {..} => string = "URL.createObjectURL"
@val external _revokeObjectURL: string => unit = "URL.revokeObjectURL"
@send external _preventDefault: {..} => unit = "preventDefault"
@send external _click: Dom.element => unit = "click"

type visibility = [#public | #home | #followers | #specified]

type attachment = {
  file: JSON.t,
  preview: string,
}

type composer = {
  text: string,
  isPosting: bool,
  visibility: visibility,
  cw: string,
  showCw: bool,
  showVisibilityMenu: bool,
  attachedFiles: array<attachment>,
  uploadingCount: int,
  inputRef: PreactHooks.ref<Nullable.t<Dom.element>>,
  fileInputRef: PreactHooks.ref<Nullable.t<Dom.element>>,
  setTextValue: string => unit,
  setCwValue: string => unit,
  toggleCw: unit => unit,
  toggleVisibilityMenu: unit => unit,
  setVisibilityAndClose: visibility => unit,
  handleSubmit: JsxEvent.Form.t => unit,
  handleFileChange: JsxEvent.Form.t => unit,
  handlePaste: JsxEvent.Clipboard.t => unit,
  removeAttachment: int => unit,
  openFilePicker: unit => unit,
  canAttachMore: bool,
}

let usePostComposer = (~replyTo: option<NoteView.t>=?, ~onPosted: option<unit => unit>=?): composer => {
  let (text, setText) = PreactHooks.useState(() => "")
  let (_isExpanded, setIsExpanded) = PreactHooks.useState(() => true)
  let (isPosting, setIsPosting) = PreactHooks.useState(() => false)
  let (visibility, setVisibility) = PreactHooks.useState(() => #public)
  let (cw, setCw) = PreactHooks.useState(() => "")
  let (showCw, setShowCw) = PreactHooks.useState(() => false)
  let (showVisibilityMenu, setShowVisibilityMenu) = PreactHooks.useState(() => false)
  let (attachedFiles, setAttachedFiles) = PreactHooks.useState(() => [])
  let (uploadingCount, setUploadingCount) = PreactHooks.useState(() => 0)

  let inputRef: PreactHooks.ref<Nullable.t<Dom.element>> = PreactHooks.useRef(Nullable.null)
  let fileInputRef: PreactHooks.ref<Nullable.t<Dom.element>> = PreactHooks.useRef(Nullable.null)

  let setTextValue = (value: string) => setText(_ => value)
  let setCwValue = (value: string) => setCw(_ => value)
  let toggleCw = () => setShowCw(prev => !prev)
  let toggleVisibilityMenu = () => setShowVisibilityMenu(prev => !prev)
  let setVisibilityAndClose = (nextVisibility: visibility) => {
    setVisibility(_ => nextVisibility)
    setShowVisibilityMenu(_ => false)
  }

  let removeAttachment = (idx: int) => {
    setAttachedFiles(prev => {
      let removed = prev->Array.getUnsafe(idx)
      _revokeObjectURL(removed.preview)
      prev->Array.filterWithIndex((_, i) => i != idx)
    })
  }

  let handleFileChange = (e: JsxEvent.Form.t) => {
    let input = JsxEvent.Form.currentTarget(e)
    let fileList = input["files"]
    let files = _arrayFrom(fileList)
    let newItems = files->Array.map(file => {
      let preview = _createObjectURL(file)
      {file: file->Obj.magic, preview}
    })
    setAttachedFiles(prev => Array.concat(prev, newItems))
    input["value"] = ""
  }

  let handlePaste = (e: JsxEvent.Clipboard.t) => {
    let rawEvent: {..} = e->Obj.magic
    let clipboardData = rawEvent["clipboardData"]
    let items: array<{..}> = _arrayFrom(clipboardData["items"])
    let imageFiles = items->Array.filterMap(item => {
      if item["kind"] == "file" && String.startsWith(item["type"], "image/") {
        item["getAsFile"]()
      } else {
        None
      }
    })
    if Array.length(imageFiles) > 0 {
      _preventDefault(rawEvent)
      let newItems = imageFiles->Array.map(file => {
        let preview = _createObjectURL(file)
        {file: file->Obj.magic, preview}
      })
      setAttachedFiles(prev => Array.concat(prev, newItems))
    }
  }

  let openFilePicker = () => {
    let input = fileInputRef.current
    if !Nullable.isNullable(input) {
      _click(input->Nullable.toOption->Option.getOrThrow)
    }
  }

  let handleSubmit = (e: JsxEvent.Form.t) => {
    e->JsxEvent.Form.preventDefault

    if text == "" && Array.length(attachedFiles) == 0 {
      ()
    } else {
      let _ = (async () => {
        setIsPosting(_ => true)

        let clientOpt = PreactSignals.value(AppState.client)

        switch clientOpt {
        | Some(client) => {
            let cwOpt = if showCw && cw != "" { Some(cw) } else { None }
            let replyId = replyTo->Option.map(note => note.id)

            let fileIds =
              if Array.length(attachedFiles) == 0 {
                None
              } else {
                setUploadingCount(_ => Array.length(attachedFiles))
                let uploadResults = await Promise.all(
                  attachedFiles->Array.map(item => Misskey.Drive.upload(client, ~file=item.file->Obj.magic, ())),
                )
                setUploadingCount(_ => 0)
                let ids = uploadResults->Array.filterMap(r =>
                  switch r {
                  | Ok(id) => Some(id)
                  | Error(msg) =>
                    ToastState.showError("画像アップロード失敗: " ++ msg)
                    None
                  }
                )
                if Array.length(ids) > 0 { Some(ids) } else { None }
              }

            let result = await client->Misskey.Notes.create(
              text,
              ~visibility=visibility,
              ~cw=?cwOpt,
              ~replyId=?replyId,
              ~fileIds=?fileIds,
              (),
            )

            switch result {
            | Ok(_) => {
                setText(_ => "")
                setCw(_ => "")
                setShowCw(_ => false)
                setIsExpanded(_ => false)
                attachedFiles->Array.forEach(item => _revokeObjectURL(item.preview))
                setAttachedFiles(_ => [])
                ToastState.showSuccess("投稿しました")
                onPosted->Option.forEach(cb => cb())
              }
            | Error(msg) => {
                ToastState.showError("投稿に失敗しました: " ++ msg)
              }
            }
          }
        | None => ToastState.showError("接続されていません")
        }

        setIsPosting(_ => false)
      })()
    }
  }

  {
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
    canAttachMore: Array.length(attachedFiles) < 4,
  }
}
