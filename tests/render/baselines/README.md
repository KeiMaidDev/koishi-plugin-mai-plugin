# Render Baselines

Template tests compare exact RGBA pixels and allow at most `0.5%` changed pixels. Tests only read these files; they never update them during a normal run.

Generate a platform baseline explicitly:

```text
npm run generate:render-baselines -- --platform windows
npm run generate:render-baselines -- --platform linux
```

The initial `*.windows.png` files were rendered on Windows with bundled Noto Sans SC fonts and the local Takumi native package. The initial `*.linux.png` files were seeded byte-identically with:

```text
npm run seed:linux-render-baselines
```

That seed command does not execute a Linux renderer and prints that fact. Regenerate `*.linux.png` on Linux before treating them as Linux execution evidence.

`linux.status` is `seeded-from-windows` until the Linux generator completes successfully. Normal Linux baseline tests fail explicitly while that status is unverified; a successful Linux generation changes it to `verified-on-linux`.
