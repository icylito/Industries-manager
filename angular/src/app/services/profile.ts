import { Service, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { Auth } from './auth';
import { errorText } from './industry-api';
import { AuthUser } from '../models/industry';
import { colorsOf, squarePicture } from './profile-picture';
import { environment } from '../../environments/environment';

// The signed in person's profile: the name they show and their picture, with the picture's two main colours for
// the card behind it. The picture is fetched with the sign in, so the page holds it as a blob address.
@Service()
export class Profile {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private url = `${environment.apiUrl}/me`;

  readonly picture = signal<string | null>(null);
  readonly colors = signal<[string, string] | null>(null);
  readonly busy = signal(false);
  // The picture fetched last, by when it was set, so a change fetches it again and nothing else does
  private loadedFor: string | null = null;

  constructor() {
    effect(() => {
      const at = this.auth.user()?.avatarAt ?? null;
      untracked(() => void this.load(at));
    });
  }

  // Answers the problem in plain words, or null when it was saved
  async saveName(name: string): Promise<string | null> {
    return this.send(this.http.put<AuthUser>(`${this.url}/profile`, { displayName: name.trim() || null }), "Couldn't save the name. Try again in a moment");
  }

  async setPicture(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) return 'Pick a picture: a PNG, JPEG, WebP or GIF image';
    let blob: Blob;
    try {
      blob = await squarePicture(file);
    } catch {
      return "This picture couldn't be read. Try another one";
    }
    return this.send(this.http.put<AuthUser>(`${this.url}/avatar`, blob, { headers: { 'Content-Type': blob.type } }), "Couldn't save the picture. Try again in a moment");
  }

  async removePicture(): Promise<string | null> {
    return this.send(this.http.delete<AuthUser>(`${this.url}/avatar`), "Couldn't remove the picture. Try again in a moment");
  }

  private async send(call: Observable<AuthUser>, fallback: string): Promise<string | null> {
    this.busy.set(true);
    try {
      this.auth.user.set(await firstValueFrom(call));
      return null;
    } catch (err) {
      return errorText(err as HttpErrorResponse, fallback);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(at: string | null): Promise<void> {
    if (at === this.loadedFor) return;
    this.loadedFor = at;
    const old = this.picture();
    if (old) URL.revokeObjectURL(old);
    this.picture.set(null);
    this.colors.set(null);
    if (!at) return;
    try {
      const blob = await firstValueFrom(this.http.get(`${this.url}/avatar`, { responseType: 'blob' }));
      if (this.loadedFor !== at) return;
      this.picture.set(URL.createObjectURL(blob));
      this.colors.set(await colorsOf(blob).catch(() => null));
    } catch {
      // No picture to show: the card keeps the initial
    }
  }
}
