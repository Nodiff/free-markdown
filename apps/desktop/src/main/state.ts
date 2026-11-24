import { app } from 'electron'
import { localeFromSystem, type Locale } from '@freemarkdown/core'

let currentLocale: Locale = 'zh-CN'
const listeners = new Set<(locale: Locale) => void>()

export function initLocale(): void {
  currentLocale = localeFromSystem(app.getLocale())
}

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(next: Locale): void {
  if (next === currentLocale) return
  currentLocale = next
  for (const listener of listeners) {
    listener(next)
  }
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
