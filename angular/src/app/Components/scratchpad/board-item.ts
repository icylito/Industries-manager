import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { BoardItem, FileItem } from '../../models/board';
import { KINDS, fileView } from '../../board/item-kinds';
import { NoteEditor } from './note-editor';
import { FileCards } from './file-cards';
import { typeLabel } from './board-files';
import { snapCircle, snapShade, snapWhen } from '../carry-tray/snapshot-look';

// A drawn stroke is an <svg> of its own on the board, everything else is one of these
export type CardItem = Exclude<BoardItem, { type: 'stroke' }>;

// One thing on the board, drawn its own way for its kind. Redrawn only when the thing itself, its picked state
// or its own file changes, so panning a board of 500 things moves one layer and redraws none of them.
// The host is the card: the pointer finds it by data-item, and the page's CSS sizes and colours it.
@Component({
  selector: 'app-board-item',
  imports: [NoteEditor],
  templateUrl: './board-item.html',
  styleUrl: './board-item.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'item',
    '[attr.data-item]': 'item().id',
    '[attr.data-kind]': 'item().type',
    '[class.selected]': 'picked()',
    '[class.link-from]': 'linkFrom()',
    '[class.amber]': "tone() === 'amber'",
    '[class.gray]': "tone() === 'gray'",
    '[class.ink]': "tone() === 'ink'",
    '[class.picture]': "look() === 'image'",
    '[class.video]': "look() === 'video'",
    '[class.failed]': '!!meta()?.bad',
    '[style.left.px]': 'item().x',
    '[style.top.px]': 'item().y',
    '[style.width.px]': 'item().w',
    '[style.min-height.px]': "item().type === 'rect' ? null : item().h",
    '[style.height.px]': "item().type === 'rect' ? item().h : null",
    '[style.transform]': 'tilt()',
  },
})
export class BoardItemView {
  item = input.required<CardItem>();
  picked = input(false);
  linkFrom = input(false);
  // The resize grip shows on the one thing picked, when its kind can be resized
  alone = input(false);

  protected files = inject(FileCards);
  protected readonly typeLabel = typeLabel;
  protected readonly snapWhen = snapWhen;
  protected readonly snapShade = snapShade;
  protected readonly snapCircle = snapCircle;

  protected tone = computed(() => {
    const item = this.item();
    return 'tone' in item ? item.tone : null;
  });
  protected tilt = computed(() => {
    const item = this.item();
    return (item.type === 'note' || item.type === 'text') && item.tilt ? 'rotate(' + item.tilt + 'deg)' : null;
  });
  protected file = computed(() => {
    const item = this.item();
    return item.type === 'file' ? item : null;
  });
  protected look = computed(() => {
    const file = this.file();
    return file ? fileView(file) : null;
  });
  protected meta = computed(() => {
    const file = this.file();
    return file ? this.files.meta(file, this.files.uploads()[file.id]) : null;
  });
  protected grip = computed(() => this.alone() && this.picked() && !!KINDS[this.item().type].minSize);

  protected priceLabel(price: number | null): string {
    return price === null || price === undefined ? 'No price' : '$' + price.toFixed(3);
  }

  protected play(file: FileItem): void {
    this.files.play(file);
  }
}
