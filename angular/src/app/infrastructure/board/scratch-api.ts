import { Service, inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { Observable, filter, map } from 'rxjs';
import {
  BoardAnswer,
  BoardDocument,
  BoardSummary,
  BoardView,
  ScratchFileInfo,
  Snapshot,
} from '../../domain/models/board';
import { ScratchGateway, UploadEvent } from '../../application/ports/scratch-gateway';
import { retryTransient } from '../industry-api';
import { environment } from '../../../environments/environment';

// Everything the Scratchpad keeps on the server: the person's boards, their carry tray and their files.
// See backend/Presentation/Endpoints/ScratchpadEndpoints.cs. Only GETs retry on their own.
@Service()
export class ScratchApi implements ScratchGateway {
  private http = inject(HttpClient);
  private base = environment.apiUrl + '/scratchpad';

  boards(): Observable<BoardSummary[]> {
    return this.http.get<BoardSummary[]>(this.base + '/boards').pipe(retryTransient());
  }

  board(id: number): Observable<BoardAnswer> {
    return this.http.get<BoardAnswer>(`${this.base}/boards/${id}`).pipe(retryTransient());
  }

  // A new board, empty or as a copy of the document given
  createBoard(name: string | null, document?: BoardDocument): Observable<BoardSummary> {
    return this.http.post<BoardSummary>(this.base + '/boards', {
      name,
      document: document ?? null,
    });
  }

  saveBoard(
    id: number,
    document: BoardDocument,
    updatedAt: string | null,
  ): Observable<{ updatedAt: string }> {
    return this.http.put<{ updatedAt: string }>(`${this.base}/boards/${id}`, {
      document,
      updatedAt,
    });
  }

  // Rename, pin and where the person left it. None of them changes the board, so none can refuse a save.
  changeBoard(
    id: number,
    change: { name?: string; pinned?: boolean; view?: BoardView },
  ): Observable<{ id: number; name: string; pinned: boolean }> {
    return this.http.patch<{ id: number; name: string; pinned: boolean }>(
      `${this.base}/boards/${id}`,
      change,
    );
  }

  deleteBoard(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/boards/${id}`);
  }

  tray(): Observable<{ items: Snapshot[] }> {
    return this.http.get<{ items: Snapshot[] }>(this.base + '/tray').pipe(retryTransient());
  }

  carry(snap: Snapshot): Observable<{ items: Snapshot[] }> {
    return this.http.post<{ items: Snapshot[] }>(this.base + '/tray', snap);
  }

  dropFromTray(snapId: string): Observable<{ items: Snapshot[] }> {
    return this.http.delete<{ items: Snapshot[] }>(
      `${this.base}/tray/${encodeURIComponent(snapId)}`,
    );
  }

  // A file, sent as a form so the API names it in any refusal. The events carry the progress, then the stored file.
  uploadFile(file: File): Observable<UploadEvent> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http
      .post<ScratchFileInfo>(this.base + '/files', form, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        map((event): UploadEvent | null => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            return { kind: 'progress', loaded: event.loaded, total: event.total };
          }
          if (event.type === HttpEventType.Response && event.body)
            return { kind: 'done', file: event.body };
          return null;
        }),
        filter((event): event is UploadEvent => event !== null),
      );
  }

  // The bytes of a stored file, fetched with the sign in so a picture or a video can show and Open can work
  fileBlob(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/files/${id}`, { responseType: 'blob' });
  }
}
