import { Observable } from 'rxjs';
import {
  BoardAnswer,
  BoardDocument,
  BoardSummary,
  BoardView,
  ScratchFileInfo,
  Snapshot,
} from '../../domain/models/board';

// Everything the Scratchpad keeps on the server: the person's boards, their carry tray and their files.
// infrastructure/board/scratch-api.ts calls HTTP for it.
export abstract class ScratchGateway {
  abstract boards(): Observable<BoardSummary[]>;
  abstract board(id: number): Observable<BoardAnswer>;
  abstract createBoard(name: string | null, document?: BoardDocument): Observable<BoardSummary>;
  abstract saveBoard(
    id: number,
    document: BoardDocument,
    updatedAt: string | null,
  ): Observable<{ updatedAt: string }>;
  abstract changeBoard(
    id: number,
    change: { name?: string; pinned?: boolean; view?: BoardView },
  ): Observable<{ id: number; name: string; pinned: boolean }>;
  abstract deleteBoard(id: number): Observable<unknown>;
  abstract tray(): Observable<{ items: Snapshot[] }>;
  abstract carry(snap: Snapshot): Observable<{ items: Snapshot[] }>;
  abstract dropFromTray(snapId: string): Observable<{ items: Snapshot[] }>;
  abstract uploadFile(file: File): Observable<UploadEvent>;
  abstract fileBlob(id: number): Observable<Blob>;
}

// How an upload is going: how much has gone up, then the stored file
export type UploadEvent =
  { kind: 'progress'; loaded: number; total: number } | { kind: 'done'; file: ScratchFileInfo };
