# @tangen/knowledge-pdf

## 0.1.22

### Patch Changes

- d54f1ba: Dependency advisories go from 45 to 1, and the one critical among them was for a
  package that was never installed.
  
  `tar` was reported through `@tangen/knowledge-pdf > unpdf`, but unpdf 0.12
  reached it only through `canvas`, an `optionalDependencies` entry that bun never
  installed: neither `tar` nor `canvas` existed on disk anywhere. `bun audit` reads
  the LOCKFILE rather than `node_modules`, so it rated as critical something never
  loaded. Bumping unpdf to 1.9.1 was still right, because the lockfile is what
  forks to a consumer whose platform CAN build canvas, and 1.9.1 has zero
  dependencies and makes `@napi-rs/canvas` an optional PEER. Twelve advisories
  left at once, and the PDF extractor still pulls real text out of a real PDF.
  
  Two bumps could not have arrived by re-resolving. `nodemailer` goes to `^10.1.7`
  because the advisory range is `>=9.1.0 <10.0.9`, so no 9.x fixes it; usage is
  `createTransport` and `sendMail` only. `elysia` goes `1.4.28` to `1.4.30` for
  GHSA-9643-4qgh-g8mx, which is an exact pin `docs/deployment.md` requires to be
  bumped with the suite and the boot benchmark rerun, and both were.
  
  The rest were already inside the declared ranges and only needed re-resolving:
  sharp, vite, `@vitejs/plugin-react`, `@tailwindcss/postcss`, react-router-dom,
  and a root `overrides` entry for brace-expansion.
  
  One advisory stays, and it is not the Admin's whatever `bun audit` prints. It
  lists `esbuild <=0.24.2` under `@tangen/admin > vite`, but vite 8.3.5 declares
  esbuild as an OPTIONAL PEER and uses rolldown, so it installs none: every copy
  is drizzle-kit's. It is the `esbuild serve` dev-server issue and nothing here
  runs `esbuild serve`, and clearing it means a drizzle-kit major that changes the
  migration generator.
  
  Also removes a second module-scope singleton found on the way. `@tangen/admin`
  declared `react-router: ^8.5.0` beside `react-router-dom: ^7.18.4`, and nothing
  imported `react-router`: 92 import sites, all `react-router-dom`. The 8.x copy
  was dead weight putting two routers in the tree, and `vite.config.ts` already
  carried an alias whose comments say the store may hold multiple react-router
  majors and that React context breaks across copies, so the workaround was
  written before the cause was found. `react-router-dom@7.18.4` pins
  `react-router` at `7.18.4` exactly, which is the Radix mechanism again, so
  `react-router` joins the dedupe gate's singleton scopes.
- @tangen/knowledge@0.1.26

## 0.1.21

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
- Updated dependencies
  - @tangen/knowledge@0.1.24
