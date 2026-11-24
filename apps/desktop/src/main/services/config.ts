import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ThemePreference, ViewMode, Vault } from '@freemarkdown/core'

export interface AppConfig {
  version: 1
  currentVaultId: string | null
  vaults: Vault[]
  ui: {
    /** 外观：跟随系统 / 浅色 / 深色（PLAN §5.10 外观） */
    theme: ThemePreference
    /** 每个库各自的展开状态，只存库外的配置里，库目录内零痕迹 */
    expanded: Record<string, string[]>
    viewMode: ViewMode
    /** 侧栏是否展开：折叠后重启仍回到折叠 */
    sidebarOpen: boolean
    sidebarWidth: number
    splitRatio: number
    /** 分类区默认收起（PLAN §5.10） */
    categoryOpen: boolean
    /** 分类区高度占左栏的比例，上限 40% */
    categoryRatio: number
    /** 搜索态结果栏宽度（PLAN §5.3：300–480，双击回 340） */
    searchWidth: number
  }
}

const MAX_RECENT_VAULTS = 12
/** 左栏拖拽的上下限；与渲染层保持一致的数值在这里集中定义 */
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 420
/** 分类区高度比例上下限：最高 40%（PLAN §5.10），再小也别低于 10% 否则看不清 */
export const CATEGORY_MIN = 0.1
export const CATEGORY_MAX = 0.4
/** 搜索结果栏宽度：太窄放不下「行号 + 原文」，太宽会把编辑区压死 */
export const SEARCH_MIN = 300
export const SEARCH_MAX = 480
export const SEARCH_DEFAULT = 340

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function emptyConfig(): AppConfig {
  return {
    version: 1,
    currentVaultId: null,
    vaults: [],
    ui: {
      theme: 'system',
      expanded: {},
      viewMode: 'split',
      sidebarOpen: true,
      sidebarWidth: 252,
      splitRatio: 0.5,
      categoryOpen: false,
      categoryRatio: 0.28,
      searchWidth: SEARCH_DEFAULT
    }
  }
}

let config: AppConfig = emptyConfig()
let saveTimer: NodeJS.Timeout | null = null
let inFlight: Promise<void> | null = null

export function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function maxRecentVaults(): number {
  return MAX_RECENT_VAULTS
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configFile(), 'utf8')
    config = normalize(JSON.parse(raw))
  } catch {
    // 配置缺失或损坏都退回默认值：配置只是体验，不该阻塞启动
    config = emptyConfig()
  }
  return config
}

function normalize(input: unknown): AppConfig {
  const base = emptyConfig()
  if (typeof input !== 'object' || input === null) return base

  const record = input as Record<string, unknown>
  const vaults = Array.isArray(record['vaults'])
    ? (record['vaults'] as unknown[]).filter(isVault)
    : []

  const rawUi = record['ui']
  const ui = typeof rawUi === 'object' && rawUi !== null ? (rawUi as Record<string, unknown>) : {}
  const viewMode = ui['viewMode']
  const expanded = ui['expanded']

  return {
    version: 1,
    currentVaultId: typeof record['currentVaultId'] === 'string' ? record['currentVaultId'] : null,
    vaults,
    ui: {
      theme: ui['theme'] === 'light' || ui['theme'] === 'dark' || ui['theme'] === 'system' ? (ui['theme'] as ThemePreference) : 'system',
      expanded: isStringArrayMap(expanded) ? expanded : {},
      viewMode: viewMode === 'edit' || viewMode === 'read' || viewMode === 'split' ? viewMode : 'split',
      sidebarOpen: ui['sidebarOpen'] !== false,
      sidebarWidth: clampNumber(ui['sidebarWidth'], SIDEBAR_MIN, SIDEBAR_MAX, 252),
      splitRatio: clampNumber(ui['splitRatio'], 0.25, 0.75, 0.5),
      categoryOpen: ui['categoryOpen'] === true,
      categoryRatio: clampNumber(ui['categoryRatio'], CATEGORY_MIN, CATEGORY_MAX, 0.28),
      searchWidth: clampNumber(ui['searchWidth'], SEARCH_MIN, SEARCH_MAX, SEARCH_DEFAULT)
    }
  }
}

function isVault(value: unknown): value is Vault {
  if (typeof value !== 'object' || value === null) return false
  const vault = value as Record<string, unknown>
  return (
    typeof vault['id'] === 'string' &&
    typeof vault['root'] === 'string' &&
    typeof vault['name'] === 'string' &&
    typeof vault['lastOpenedAt'] === 'number'
  )
}

function isStringArrayMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value as Record<string, unknown>).every(
    (item) => Array.isArray(item) && item.every((entry) => typeof entry === 'string')
  )
}

export function getConfig(): AppConfig {
  return config
}

export function updateConfig(mutator: (draft: AppConfig) => void): void {
  mutator(config)
  scheduleSave()
}

export function scheduleSave(delayMs = 400): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveConfig()
  }, delayMs)
}

/** 原子写：临时文件 + rename，避免半截配置把下次启动搞坏 */
export async function saveConfig(): Promise<void> {
  if (inFlight !== null) {
    await inFlight
    return
  }
  inFlight = (async () => {
    const file = configFile()
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await rename(tmp, file)
  })().finally(() => {
    inFlight = null
  })
  await inFlight
}

export async function flushConfig(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveConfig()
}
