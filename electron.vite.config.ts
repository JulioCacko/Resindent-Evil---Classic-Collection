import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const repoRoot = __dirname

/**
 * Lets the vendored Figma export (`src/renderer/design-export/*.tsx`) be imported
 * verbatim: its `figma:asset/<hash>.png` specifiers are rewritten to the copied
 * design assets, so no JSX string ever has to be edited for the build to work.
 */
function figmaAssetPlugin(): Plugin {
  const designDir = resolve(repoRoot, 'src/renderer/src/assets/design')
  return {
    name: 're-figma-asset',
    enforce: 'pre',
    resolveId(source) {
      if (!source.startsWith('figma:asset/')) return null
      const file = source.slice('figma:asset/'.length)
      const asPng = resolve(designDir, file)
      if (existsSync(asPng)) return asPng
      const asWebp = resolve(designDir, file.replace(/\.png$/i, '.webp'))
      if (existsSync(asWebp)) return asWebp
      return null
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(repoRoot, 'src/main/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(repoRoot, 'src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(repoRoot, 'src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(repoRoot, 'src/shared') }
    }
  },
  renderer: {
    root: resolve(repoRoot, 'src/renderer'),
    plugins: [figmaAssetPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': resolve(repoRoot, 'src/renderer/src'),
        '@shared': resolve(repoRoot, 'src/shared')
      }
    },
    build: {
      outDir: resolve(repoRoot, 'out/renderer'),
      emptyOutDir: true,
      assetsInlineLimit: 4096,
      rollupOptions: {
        input: { index: resolve(repoRoot, 'src/renderer/index.html') },
        output: {
          // Keep the design assets as real files with stable, readable names so the
          // packaged app can be inspected and the fidelity tooling can address them.
          assetFileNames: (info) => {
            const name = info.names?.[0] ?? info.originalFileNames?.[0] ?? 'asset'
            if (/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) return 'art/[name]-[hash][extname]'
            if (/\.(mp4|webm)$/i.test(name)) return 'video/[name]-[hash][extname]'
            if (/\.(woff2?|ttf|otf)$/i.test(name)) return 'font/[name]-[hash][extname]'
            if (/\.wav$/i.test(name)) return 'audio/[name]-[hash][extname]'
            return 'assets/[name]-[hash][extname]'
          }
        }
      }
    }
  }
})
