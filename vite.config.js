import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// One id per build. It is baked into the bundle (__APP_VERSION__) AND emitted as /version.json, so a
// browser tab that is still running an older bundle can notice a newer deploy (NewVersionBanner).
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const versionFile = () => ({
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: BUILD_ID }) })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __APP_VERSION__: JSON.stringify(BUILD_ID) },
})
