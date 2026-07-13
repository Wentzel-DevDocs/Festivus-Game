/** @type {import('next').NextConfig} */
const nextConfig = {
  // Browsers need the PUBLIC (pk_) Rivet endpoint baked into the bundle.
  // Accept either name: NEXT_PUBLIC_RIVET_ENDPOINT (Next.js convention) or
  // RIVET_PUBLIC_ENDPOINT (the name the Rivet dashboard hands out). This
  // `env` block inlines the value at BUILD time, so changing it on Vercel
  // still requires a redeploy.
  env: {
    NEXT_PUBLIC_RIVET_ENDPOINT:
      process.env.NEXT_PUBLIC_RIVET_ENDPOINT ?? process.env.RIVET_PUBLIC_ENDPOINT ?? "",
  },
  // Justin's photo can live on any host, so allow remote images everywhere.
  // Tighten this to your own domain if you prefer.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // rivetkit ships native binaries + WASM; it must be required from
  // node_modules at runtime, not bundled (used by /api/rivet, the
  // serverless runner route).
  serverExternalPackages: ["rivetkit"],
  // rivetkit's core runtime is Rust compiled to WASM, loaded with
  // `new URL("rivetkit_wasm_bg.wasm", import.meta.url)` — a dynamic asset
  // reference Vercel's file tracer cannot follow, so without this the
  // .wasm never ships with the function and /api/rivet dies with a 500.
  // Both paths are covered: pnpm's store layout and plain hoisted layout.
  outputFileTracingIncludes: {
    // App Router route keys end in /route; the glob key is a belt-and-
    // suspenders match for any future rivet sub-route.
    "/api/rivet/[[...slug]]/route": [
      "node_modules/.pnpm/@rivetkit+rivetkit-wasm@*/node_modules/@rivetkit/rivetkit-wasm/**",
      "node_modules/@rivetkit/rivetkit-wasm/**",
    ],
    "/api/rivet/**": [
      "node_modules/.pnpm/@rivetkit+rivetkit-wasm@*/node_modules/@rivetkit/rivetkit-wasm/**",
      "node_modules/@rivetkit/rivetkit-wasm/**",
    ],
  },
};

export default nextConfig;
