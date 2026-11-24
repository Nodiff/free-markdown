import { create } from 'zustand'
import type { ThemePreference } from '@freemarkdown/core'

export type ResolvedTheme = 'light' | 'dark'

const media = window.matchMedia('(prefers-color-scheme: dark)')

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return media.matches ? 'dark' : 'light'
}

interface ThemeState {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => Promise<void>
  setResolved: (resolved: ResolvedTheme) => void
}

function applyDocument(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  resolved: resolve('system'),

  setResolved: (resolved) => {
    if (get().resolved === resolved) return
    applyDocument(resolved)
    set({ resolved })
  },

  setPreference: async (preference) => {
    const resolved = resolve(preference)
    applyDocument(resolved)
    set({ preference, resolved })
    try {
      await window.fm.theme.set(preference)
    } catch (error) {
      console.error('[theme] 保存失败', error)
      const current = await window.fm.theme.get()
      const fallback = resolve(current)
      applyDocument(fallback)
      set({ preference: current, resolved: fallback })
      throw error
    }
  }
}))

let initialized = false

/** 只初始化一次：读取持久化偏好，并让「跟随系统」实时响应 OS 深浅变化 */
export async function initThemeStore(): Promise<void> {
  if (initialized) return
  initialized = true

  applyDocument(useThemeStore.getState().resolved)

  media.addEventListener('change', () => {
    const state = useThemeStore.getState()
    if (state.preference !== 'system') return
    state.setResolved(media.matches ? 'dark' : 'light')
  })

  try {
    const preference = await window.fm.theme.get()
    const resolved = resolve(preference)
    applyDocument(resolved)
    useThemeStore.setState({ preference, resolved })
  } catch (error) {
    console.warn('[theme] 读取偏好失败，继续跟随系统', error)
  }
}

/** 供测试/调试读取当前 CSS 实际解析结果 */
export function currentResolvedTheme(): ResolvedTheme {
  return useThemeStore.getState().resolved
}
