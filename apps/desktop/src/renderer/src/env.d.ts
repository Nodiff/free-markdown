/// <reference types="vite/client" />
import type { FmApi } from '../../shared/ipc'

declare global {
  interface Window {
    fm: FmApi
  }
}

export {}
