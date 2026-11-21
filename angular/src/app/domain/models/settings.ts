export type ThemeChoice = 'light' | 'dark' | null;
export type MouseMod = 'Shift' | 'Ctrl' | 'Alt';

// What a person chose for themselves: their changed shortcut keys, the held keys of the Scratchpad's mouse rows,
// and light or dark. Saved per person on the server (GET and PUT /me/settings) so they follow the person to any
// browser, and kept in this browser too, so the page starts with them before the server has answered and works
// signed out. The first time someone signs in with nothing saved on the server, what this browser had is
// carried up once. After that the server wins.
export interface MySettings {
  shortcuts: Record<string, string[]>;
  mouse: Record<string, MouseMod>;
  theme: ThemeChoice;
}
