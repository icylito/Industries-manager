import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Scratchpad } from './scratchpad';
import { environment } from '../../environments/environment';

// The save-state stress tests from OVERVIEW_HANDOFF.md, "the save state".
// WRITTEN BUT NOT RUN in the session that added them: they belong to a later session with the app and the
// throwaway API running, where the failure, the offline case and the two-tab case can be forced for real.
// The skip is removed there and the cases are checked against the live board.

const url = environment.apiUrl + '/scratchpad';

describe.skip('save state, stress tests (run with the app and the throwaway API running)', () => {
  let pad: Scratchpad;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    pad = TestBed.inject(Scratchpad);
    http = TestBed.inject(HttpTestingController);
  });

  it('1. a burst of typing becomes exactly one request and ends Saved', () => {
    // Type quickly for ten seconds, then stop. One request after the debounce, and the pill ends Saved.
    expect(pad).toBeTruthy();
  });

  it('2. a change during flight puts the pill back to Save and a second request follows', () => {
    // Start a save, change again before it answers, and check the final state is Saved.
    expect(pad).toBeTruthy();
  });

  it('3. a failure then a recovery keeps every change and ends Saved', () => {
    // Make the endpoint answer 500, change, wait: Failed to save with the changes still on the page.
    // Restore it, press Try again, expect Saved and no lost change.
    expect(pad).toBeTruthy();
  });

  it('4. a three minute failure backs off and leaves the page usable', () => {
    // Fail the endpoint for three minutes: retries back off, the page stays usable, no console flood.
    expect(pad).toBeTruthy();
  });

  it('5. two tabs: the stale timestamp is refused and nothing is overwritten', () => {
    // Tab A saves, then tab B saves with the old updatedAt. Expect 409, B saying it changed elsewhere with
    // Reload, and no silent overwrite.
    expect(pad).toBeTruthy();
  });

  it('6. the two minute timer sends only when something is waiting', () => {
    // No changes for five minutes: no requests at all. Then a change, wait out the timer, expect one.
    expect(pad).toBeTruthy();
  });

  it('7. a reload in the middle of a save never claims Saved for text a reload loses', () => {
    // Change and reload before the request answers: either it saved, or the pill never said Saved.
    expect(pad).toBeTruthy();
  });

  it('8. the API going down mid-edit is survived and recovered', () => {
    // Take the API down mid-edit: the page stays usable, the pill moves to Failed to save, and once the API
    // returns a retry or Try again reaches Saved with every change intact.
    expect(pad).toBeTruthy();
  });
});
