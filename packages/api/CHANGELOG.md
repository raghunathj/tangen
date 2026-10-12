# @tangen/api

## 0.2.0

### Minor Changes

- The Gateway enforces CORS and rate limits by default, and the media library
  listing has a permission check.
  
  **Minor, not patch, deliberately.** Several of these change what an existing
  deployment's requests do, and on a 0.x line a minor is where that belongs:
  
  - **CORS** decides per workspace instead of answering from a process-wide
    union, so an origin declared by one workspace is no longer valid on
    another's routes. A deployment that relied on the union must declare its
    origins per workspace, or set `TANGEN_CORS_MODE=observe` for a migration
    window.
  - **Rate limits are on.** A request over budget now gets `429` with a
    `Retry-After` instead of passing. The budgets that matter are ones there was
    no equivalent of: `auth` at 20/min by IP, and `forms` at 10/min by IP and
    route. Public asset bytes are unaffected - a policy counting by API key does
    not apply to a browser fetching an image. An operator may run observe mode
    with `gateway.rateLimit.enabled: false`; a tenant cannot.
  - **Realtime ceilings enforce** on the same switch: a connection over the
    per-identity ceiling is refused at ticket redemption rather than opening.
  - **`GET /api/v1/media` requires `media:read`**, and every media read, write
    and localize path now honours `media.allowedFolders`. A key without the
    permission loses a listing it previously got.
  - **A preview token minted before this release is refused**, because a token
    now records whose field access it delegates and an old one records none.
    Reloading the preview mints a new one.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangen/types@0.2.0
  - @tangen/db@0.1.54
  - @tangen/graphql@0.1.25
  - @tangen/knowledge@0.1.24
  - @tangen/logging@0.0.24
  - @tangen/mcp@0.1.24
  - @tangen/porter@0.1.3
  - @tangen/schema@0.1.43
  - @tangen/studio-compiler@0.1.2
  - @tangen/studio-schema@0.1.2
