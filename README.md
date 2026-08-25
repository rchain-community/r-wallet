# R Wallet

## Usage

To run the wallet locally, clone the repo, then run the following commands:

```bash
npm install
npm run start
```

## Deploying

Ensure that the base URL specified in vite.config.ts matches the URL that you are going to deploy to:

```typescript
// vite.config.ts
export default defineConfig({
    base: "https://your.url.here/",
    plugins: [
        reindex_icons(),
        tsconfigPaths(),
        react(),
        svgr(),
        nodePolyfills({
            include: ["stream", "util", "crypto", "vm"],
        })
    ],
});
```

Then, build the project by running:

```bash
npm run build
```

This will create a `dist` folder in the root of the project, containing the built files, ready to be deployed to a server.

## Icons & Assets

Refer to `README.md` in `src/assets`.
