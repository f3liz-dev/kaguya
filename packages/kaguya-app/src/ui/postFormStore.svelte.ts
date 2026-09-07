// SPDX-License-Identifier: MPL-2.0
//
// Svelte 5 counterpart of postFormHook.ts (usePostComposer). Class with
// rune-backed fields so each Component instantiates its own composer
// state — same surface as the Preact hook return, just bound to a class
// instance rather than React-style closures.

import type { NoteView } from '../domain/note/noteView'
import type { Visibility } from '../lib/backend'
import * as Backend from '../lib/backend'
import { client } from '../domain/auth/appState'
import { showError, showSuccess } from './toastState'
import { t } from '../infra/i18n'
import { detectLanguage } from '../infra/langDetect'
import { defaultNoteVisibility } from './preferencesStore'

export type Attachment = {
  file: File
  preview: string
  /** what the picture shows, for people who can't see it. hackers.pub requires it. */
  alt: string
}

const MAX_ATTACHMENTS = 4

export class Composer {
  text = $state('')
  isPosting = $state(false)
  visibility = $state<Visibility>(defaultNoteVisibility.peek())
  /** BCP 47 primary subtag; '' means "guess from the text" (see langDetect). */
  language = $state('')
  cw = $state('')
  showCw = $state(false)
  showVisibilityMenu = $state(false)
  attachedFiles = $state<Attachment[]>([])
  uploadingCount = $state(0)

  inputEl: HTMLTextAreaElement | null = null
  fileInputEl: HTMLInputElement | null = null

  private replyTo?: NoteView
  private onPosted?: () => void

  constructor(opts?: { replyTo?: NoteView; onPosted?: () => void }) {
    this.replyTo = opts?.replyTo
    this.onPosted = opts?.onPosted
  }

  // Mirror of usePostComposer's mount-time cleanup: caller wires this
  // into $effect's return so previews revoke on unmount.
  cleanup = () => {
    this.attachedFiles.forEach((item) => URL.revokeObjectURL(item.preview))
  }

  get canAttachMore(): boolean {
    return this.attachedFiles.length < MAX_ATTACHMENTS
  }

  private addFiles(files: File[]): void {
    if (files.length === 0) return
    const remaining = MAX_ATTACHMENTS - this.attachedFiles.length
    if (remaining <= 0) return
    const accepted = files.slice(0, remaining)
    const newItems = accepted.map((file) => ({ file, preview: URL.createObjectURL(file), alt: '' }))
    this.attachedFiles = [...this.attachedFiles, ...newItems]
  }

  setAlt = (idx: number, alt: string): void => {
    this.attachedFiles = this.attachedFiles.map((item, i) => (i === idx ? { ...item, alt } : item))
  }

  removeAttachment = (idx: number): void => {
    const target = this.attachedFiles[idx]
    if (target) URL.revokeObjectURL(target.preview)
    this.attachedFiles = this.attachedFiles.filter((_, i) => i !== idx)
  }

  handleFileChange = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    this.addFiles(files)
    input.value = ''
  }

  handlePaste = (e: ClipboardEvent): void => {
    const items = Array.from(e.clipboardData?.items ?? [])
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[]
    if (imageFiles.length > 0) {
      e.preventDefault()
      this.addFiles(imageFiles)
    }
  }

  openFilePicker = (): void => {
    this.fileInputEl?.click()
  }

  toggleCw = (): void => {
    this.showCw = !this.showCw
  }

  toggleVisibilityMenu = (): void => {
    this.showVisibilityMenu = !this.showVisibilityMenu
  }

  setVisibilityAndClose = (v: Visibility): void => {
    this.visibility = v
    this.showVisibilityMenu = false
  }

  handleSubmit = (e: Event): void => {
    e.preventDefault()
    if (!this.text && this.attachedFiles.length === 0) return

    void (async () => {
      this.isPosting = true
      const currentClient = client.value
      if (!currentClient) {
        showError(t('error.not_connected'))
        this.isPosting = false
        return
      }

      const cwOpt = this.showCw && this.cw ? this.cw : undefined
      const replyId = this.replyTo?.id

      const language = this.language || detectLanguage(this.text)
      let fileIds: string[] | undefined
      let alts: string[] | undefined
      if (this.attachedFiles.length > 0) {
        this.uploadingCount = this.attachedFiles.length
        const uploadResults = await Promise.all(
          this.attachedFiles.map((item) => Backend.uploadMedia(currentClient, item.file, { alt: item.alt })),
        )
        this.uploadingCount = 0
        // One failed image means the post you wrote is not the post that
        // would go out. Stop here, keep the text and the files, say so.
        const failed = uploadResults.find((r) => !r.ok)
        if (failed && !failed.ok) {
          showError(`${t('note.image_upload_failed')}: ${failed.error}`)
          this.isPosting = false
          return
        }
        fileIds = uploadResults.flatMap((r) => (r.ok ? [r.value] : []))
        alts = this.attachedFiles.map((item) => item.alt)

        // hackers.pub wants every picture described. Where you left it blank,
        // ask the server to write one, with your text as the context.
        if (currentClient.backend === 'hackerspub') {
          const described = await Promise.all(fileIds.map(async (id, i) => {
            if (alts![i].trim()) return alts![i]
            const r = await Backend.describeMedia(currentClient, id, language ?? 'en', this.text || undefined)
            return r.ok ? r.value : ''
          }))
          if (described.some((a) => !a)) {
            showError(t('compose.alt_required'))
            this.isPosting = false
            return
          }
          alts = described
          this.attachedFiles = this.attachedFiles.map((item, i) => ({ ...item, alt: described[i] }))
        }
      }

      const result = await Backend.createNote(currentClient, this.text, {
        visibility: this.visibility,
        cw: cwOpt,
        replyId,
        fileIds,
        alts,
        language,
      })

      if (result.ok) {
        this.text = ''
        this.cw = ''
        this.showCw = false
        this.attachedFiles.forEach((item) => URL.revokeObjectURL(item.preview))
        this.attachedFiles = []
        showSuccess(t('compose.posted'))
        this.onPosted?.()
      } else {
        showError(t('note.post_failed'))
      }

      this.isPosting = false
    })()
  }
}
