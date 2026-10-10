import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { FileItem } from '../../models/board';
import { errorText } from '../../services/industry-api';
import { BoardEngine } from '../../board/board-engine';
import { ScratchApi } from '../../board/scratch-api';
import { KINDS, fileView } from '../../board/item-kinds';
import { refusalFor, sizeText, typeLabel } from './board-files';
import { PageNotice } from './page-notice';

// A file's upload while the page is open. Gone after a reload: a card whose upload never finished says so.
export interface Upload { pct: number; failed: boolean; }

// Everything about the file cards on the open board: each file is checked, goes on the board at once and uploads
// in the background; pictures show a preview and videos play in place, both fetched with the sign in since an
// <img> or <video> can't send it. One per open page, so its memory goes when the page closes.
@Injectable()
export class FileCards {
  private board = inject(BoardEngine);
  private scratch = inject(ScratchApi);
  private notice = inject(PageNotice);

  readonly uploads = signal<Record<string, Upload>>({});
  readonly previews = signal<Record<number, string>>({});
  readonly videos = signal<Record<number, string | 'loading'>>({});
  private pending = new Map<string, File>();
  private previewAsked = new Set<number>();

  constructor() {
    // A picture card shows its preview, fetched once
    effect(() => {
      for (const item of this.board.doc().items) {
        if (item.type === 'file' && item.fileId != null && fileView(item) === 'image') untracked(() => this.askPreview(item.fileId!));
      }
    });
    // A video taken off the board lets go of the memory it was playing from
    effect(() => {
      const onBoard = new Set(this.board.doc().items.flatMap(item => (item.type === 'file' && item.fileId != null ? [item.fileId] : [])));
      const playing = untracked(() => this.videos());
      const gone = Object.keys(playing).map(Number).filter(id => !onBoard.has(id));
      if (gone.length === 0) return;
      for (const id of gone) if (playing[id] !== 'loading') URL.revokeObjectURL(playing[id]);
      untracked(() => this.videos.update(all => { const next = { ...all }; for (const id of gone) delete next[id]; return next; }));
    });
    inject(DestroyRef).onDestroy(() => {
      for (const url of Object.values(this.previews())) URL.revokeObjectURL(url);
      for (const url of Object.values(this.videos())) if (url !== 'loading') URL.revokeObjectURL(url);
    });
  }

  // Uploads still on their way, so closing the tab asks first
  get uploading(): boolean {
    return this.pending.size > 0;
  }

  // Several dropped together land side by side from the drop point, never on top of each other
  add(files: File[], at?: { x: number; y: number }): void {
    if (this.board.status() !== 'ready') return;
    const refused: string[] = [];
    let left: number | null = null;
    for (const file of files) {
      const why = refusalFor(file);
      if (why) { refused.push(why); continue; }
      const contentType = file.type || 'application/octet-stream';
      const width = KINDS.file.size({ contentType }).w;
      if (at && left === null) left = at.x - width / 2;
      const center = at && left !== null ? { x: left + width / 2, y: at.y } : null;
      if (left !== null) left += width + 24;
      const id = this.board.place('file', center ? { center } : 'auto', { name: file.name, contentType, sizeBytes: file.size });
      if (id == null) break;
      this.upload(id, file);
    }
    if (refused.length) this.notice.show(refused);
  }

  retry(itemId: string): void {
    const file = this.pending.get(itemId);
    if (file) this.upload(itemId, file);
  }

  // How a file card reads under its name: uploading, failed, never finished, or its size and type
  meta(item: FileItem, up: Upload | undefined): { text: string; bad: boolean } {
    if (up?.failed) return { text: "Couldn't upload", bad: true };
    if (up) return { text: 'Uploading ' + up.pct + '%', bad: false };
    if (item.fileId == null) return { text: "Couldn't upload. Remove it and add the file again", bad: true };
    return { text: typeLabel(item.name) + ', ' + sizeText(item.sizeBytes), bad: false };
  }

  canRetry(item: FileItem): boolean {
    return !!this.uploads()[item.id]?.failed && this.pending.has(item.id);
  }

  // A video is fetched only when someone presses Play, since it can be big, then plays in place
  play(item: FileItem): void {
    const id = item.fileId;
    if (id == null || this.videos()[id]) return;
    this.videos.update(all => ({ ...all, [id]: 'loading' }));
    this.scratch.fileBlob(id).subscribe({
      next: blob => this.videos.update(all => ({ ...all, [id]: URL.createObjectURL(blob) })),
      error: (err: HttpErrorResponse) => {
        this.videos.update(all => { const next = { ...all }; delete next[id]; return next; });
        this.notice.show([errorText(err, "Couldn't play " + item.name)]);
      },
    });
  }

  // Open a picture or a PDF in a new tab, anything else downloads with its own name
  open(item: FileItem): void {
    if (item.fileId == null) return;
    this.scratch.fileBlob(item.fileId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        if (fileView(item) === 'image' || item.contentType === 'application/pdf') {
          window.open(url, '_blank', 'noopener');
        } else {
          const link = document.createElement('a');
          link.href = url;
          link.download = item.name || 'file';
          link.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: (err: HttpErrorResponse) => this.notice.show([errorText(err, "Couldn't open " + (item.name || 'that file'))]),
    });
  }

  private upload(itemId: string, file: File, boardId = this.board.boardId()): void {
    this.pending.set(itemId, file);
    this.setUpload(itemId, { pct: 0, failed: false });
    this.scratch.uploadFile(file).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.setUpload(itemId, { pct: Math.round((event.loaded / event.total) * 100), failed: false });
        } else if (event.type === HttpEventType.Response && event.body) {
          // The board it was dropped on, even if another is open by now or the page has closed
          this.board.fileStored(itemId, event.body, boardId);
          this.pending.delete(itemId);
          this.setUpload(itemId, null);
        }
      },
      error: (err: HttpErrorResponse) => {
        // A refusal from the API (it checks again) is said in the toast; anything else waits on the card for Try again
        if (err.status === 400 || err.status === 413) this.notice.show([errorText(err, "Couldn't upload " + file.name)]);
        this.setUpload(itemId, { pct: 0, failed: true });
      },
    });
  }

  private setUpload(itemId: string, state: Upload | null): void {
    this.uploads.update(all => {
      const next = { ...all };
      if (state) next[itemId] = state; else delete next[itemId];
      return next;
    });
  }

  private askPreview(fileId: number): void {
    if (this.previewAsked.has(fileId)) return;
    this.previewAsked.add(fileId);
    this.scratch.fileBlob(fileId).subscribe({
      next: blob => this.previews.update(all => ({ ...all, [fileId]: URL.createObjectURL(blob) })),
      // No preview: the card falls back to the plain file look
      error: () => {},
    });
  }
}
