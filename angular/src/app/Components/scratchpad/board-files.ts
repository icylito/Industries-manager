// What may go on the board, checked before anything is sent so a refused file never becomes a card.
// The same lists and the same sentences as api_v2/Endpoints/ScratchFileEndpoints.cs, which checks again.

export const MAX_FILE_MB = 25;
const MAX_BYTES = MAX_FILE_MB * 1024 * 1024;

const OFFICE = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];
const TEXT = ['.txt', '.md'];
const SCRIPT = ['.exe', '.bat', '.cmd', '.ps1', '.js', '.vbs', '.msi', '.dll', '.jar', '.scr'];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

// The line the toast shows, naming the file, or null when it may go on the board
export function refusalFor(file: { name: string; size: number }): string | null {
  const ext = extensionOf(file.name);
  if (OFFICE.includes(ext)) return `Word, PowerPoint and Excel files can't go on the board (${file.name}).`;
  if (TEXT.includes(ext)) return `Text files can't go on the board (${file.name}). Copy the text and paste it instead.`;
  if (SCRIPT.includes(ext)) return `That kind of file can't go on the board (${file.name}).`;
  if (file.size > MAX_BYTES) return `${file.name} is bigger than ${MAX_FILE_MB} MB.`;
  return null;
}

// "PDF", "PNG", or "FILE" when the name has no extension. Shown on a card that has no preview.
export function typeLabel(name: string | undefined): string {
  const ext = extensionOf(name ?? '');
  return ext ? ext.slice(1, 6).toUpperCase() : 'FILE';
}

// 812 KB, 3.4 MB, 18 MB
export function sizeText(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  const mb = bytes / (1024 * 1024);
  return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
}

// A paste or a drop from a screenshot tool often has no real name, so it gets one people can read
export function nameForPasted(file: File, when = new Date()): string {
  if (file.name && file.name !== 'image.png') return file.name;
  const ext = file.type === 'image/jpeg' ? '.jpg' : file.type === 'image/gif' ? '.gif' : file.type === 'image/webp' ? '.webp' : '.png';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Pasted picture ${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}.${pad(when.getMinutes())}${ext}`;
}
