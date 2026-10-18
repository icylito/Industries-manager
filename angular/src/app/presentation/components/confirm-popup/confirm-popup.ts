import { Component, HostListener, input, output } from '@angular/core';

// The "Are you sure?" pop up every delete button uses. The page decides when it is open and what the question is,
// this only draws it and says Yes or No. Nothing is deleted until the page hears Yes.
@Component({
  selector: 'app-confirm-popup',
  templateUrl: './confirm-popup.html',
  styleUrl: './confirm-popup.css',
})
export class ConfirmPopup {
  // The thing being deleted, shown in bold in the sentence
  name = input('');
  // Rest of the sentence, after the name
  detail = input('will be deleted.');
  busy = input(false);
  yes = output<void>();
  no = output<void>();

  // Escape answers No, but never while the delete is already running
  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.busy()) this.no.emit();
  }
}
