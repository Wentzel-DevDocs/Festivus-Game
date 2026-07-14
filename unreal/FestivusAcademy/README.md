# Festivus Academy — Unreal shell

This project is an asset-free Unreal Engine 5.8 C++ shell for the Developer Academy.

## What already works

- A procedural four-door academy atrium; no `.umap` or marketplace asset is required.
- Camera, lighting, fog, room labels, and a cinematic dark-academy composition.
- An asset-free UMG hub created in C++.
- Embedded access to the original Festivus teaser.
- Embedded access to every web curriculum room.
- Runtime catalog discovery through `GET /api/academy/rooms`.
- An AI-first mission workbench that teaches specify → generate → review → validate.
- Offline fallback: the built-in room buttons still open known routes.

## Run locally

1. From the repository root, run `pnpm dev:all`.
2. Ensure Unreal Engine 5.8 is installed with C++ support.
3. Open `unreal/FestivusAcademy/FestivusAcademy.uproject`.
4. Allow Unreal to compile the `FestivusAcademy` module.
5. Press Play. The academy reads `http://localhost:3000` by default.

To point the shell at production, change `ApiBaseUrl` in `Config/DefaultGame.ini`:

```ini
[Academy]
ApiBaseUrl="https://festivus-game.vercel.app"
```

## Why the UI is code-generated

Binary Unreal assets are fragile in source-only automation and cannot be meaningfully
reviewed in Git. The first vertical slice generates its atrium and UMG shell from C++.
Once the editor build is green, artists can replace procedural geometry with Nanite
environments and Blueprint subclasses without changing the API or curriculum model.

## Validation

`pnpm unreal:validate` checks project/module/plugin/config wiring without an engine.
A real Unreal compile is still required before calling the native client shippable.
