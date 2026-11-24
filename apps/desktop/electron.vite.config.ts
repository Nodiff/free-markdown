import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// workspace 包直接指向源码，由 Vite 编译，不经过 node_modules 解析，
// 也就不会被 electron-builder 当成运行时依赖塞进安装包。
const alias = {
  '@freemarkdown/core': resolve(__dirname, '../../packages/core/src/index.ts'),
  '@freemarkdown/plugin-api': resolve(__dirname, '../../packages/plugin-api/src/index.ts')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias },
    server: {
      // 开发时渲染层要读取 workspace 里的源码，放开仓库根目录
      fs: {
        allow: [resolve(__dirname, '../..'), resolve(__dirname, 'src')]
      }
    }
  }
})
