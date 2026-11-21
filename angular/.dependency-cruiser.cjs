// The page's layers, checked by `npm run lint:layers`. Dependencies point inward: presentation uses application and
// domain, application uses domain and its own ports, infrastructure implements those ports, and domain uses nothing.
// Tests (*.spec.ts) and the shell at the app root (app.ts, app.config.ts) wire the layers together, so they may
// reach everything.
const app = '^src/app/';
const notTests = '\\.spec\\.ts$';
// The HTTP library as the checker sees it: the file a bare '@angular/common/http' import resolves to
const http = 'node_modules/@angular/common/(types/http|fesm2022/http|http)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'The domain is plain TypeScript: no other layer, no Angular, no HTTP, no environment.',
      severity: 'error',
      from: { path: app + 'domain/', pathNot: notTests },
      to: {
        path: [
          app + '(application|infrastructure|presentation)/',
          '^src/environments/',
          'node_modules/@angular/',
        ],
      },
    },
    {
      name: 'application-knows-no-adapters',
      comment:
        'Use cases ask for ports in application/ports, never for the class that talks HTTP or storage.',
      severity: 'error',
      from: { path: app + 'application/', pathNot: notTests },
      to: { path: [app + '(infrastructure|presentation)/', '^src/environments/', http] },
    },
    {
      name: 'pages-go-through-application',
      comment:
        'Components use the ports and stores in application/, never infrastructure or the HTTP library.',
      severity: 'error',
      from: { path: app + 'presentation/', pathNot: notTests },
      to: { path: [app + 'infrastructure/', '^src/environments/', http] },
    },
    {
      name: 'adapters-never-reach-pages',
      severity: 'error',
      from: { path: app + 'infrastructure/', pathNot: notTests },
      to: { path: app + 'presentation/' },
    },
    {
      name: 'no-cycles',
      comment: 'A cycle between files usually means one of them is in the wrong layer.',
      severity: 'error',
      from: { pathNot: notTests },
      to: { circular: true, viaOnly: { pathNot: notTests } },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
