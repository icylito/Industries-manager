# The page

This is the Angular 22 page of Industries Manager, the part everyone sees in the browser. It talks to the API on port 5005, so start that too, or use `start.bat` from the project folder to start both.

## Running it

The first time, and whenever `package.json` changes:

```bat
npm ci
```

Then:

```bat
npx ng serve
```

Open http://localhost:4200. The page reloads by itself whenever you save a file.

If `ng serve` or `ng build` stops on a missing file or font, your `node_modules` is out of date. Run `npm ci` again.

## Commands you'll use

```bat
npx ng build
npx ng test --watch=false
npx ng test --watch=false --include src/app/presentation/components/history/history.spec.ts
npm run lint:layers
npx prettier --write <file>
```

`ng build` puts the finished page in `dist/`. It warns that the first bundle is a little over the 500 kB budget, which is known and safe to ignore for now. The `--include` line runs one test file instead of all of them. Run Prettier on the files you change.

## How it's laid out

The page follows the same four layers as the API, under `src/app/`:

| Folder | What lives there |
|---|---|
| `domain/` | The rules and models, with no Angular in them at all. The name rule and the Scratchpad board engine are here |
| `application/` | The steps of each feature, the route guards, and the ports in `application/ports/` that the rest of the page talks to |
| `infrastructure/` | The HTTP calls and the token storage behind those ports, wired in `providers.ts` |
| `presentation/` | The components, one folder per page |

Components and use cases ask for a port, never for the HTTP class behind it. `npm run lint:layers` fails if an import goes the wrong way, so run it before you push.

The colours and spacing are custom properties at the top of `src/styles.css`. Components use `var(--...)` instead of colours of their own, which is how dark mode and the admin pages get their palettes.
