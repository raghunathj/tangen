/** @type {import('next').NextConfig} */
const nextConfig = {
  // A verification build (`NEXT_DIST_DIR=.next-verify next build`) must not
  // write into the directory a running `next dev` is serving from - doing so
  // replaces its chunks underneath it and every page 500s with "Cannot find
  // module './NNN.js'". Default stays .next for the ordinary case.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The live-preview pane frames this site inside the Tangen admin. Next sets no
  // X-Frame-Options by default, so framing works; if you add a CSP elsewhere, allow the
  // admin origin in frame-ancestors.
  // Both are workspace packages that ship TypeScript source (main -> src/),
  // so Next must compile them rather than treat them as prebuilt deps.
  transpilePackages: [
    '@tangen/sdk', '@tangen/studio', '@tangen/studio-react',
    // The delivery client. Framework-neutral and shipped as source, so it
    // needs compiling here like the rest.
    '@tangen/studio-runtime', '@tangen/studio-schema', '@tangen/studio-compiler',
    // The realtime client and its React bindings: the post list subscribes
    // with the site's API key. Source-shipped like the rest, and every
    // `workspace:*` dependency of package.json must appear here (a test
    // holds the two lists together).
    '@tangen/realtime', '@tangen/realtime-react',
  ],
}
export default nextConfig
