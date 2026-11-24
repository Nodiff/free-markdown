import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  FileDiff,
  HistoryStatus,
  RewindResult,
  Snapshot,
  SnapshotDetail,
  SnapshotFileChange,
  SnapshotSaveResult,
  Vault,
  WorkingChange
} from '@freemarkdown/core'
import { normalizeRelPath, resolveInside } from './paths'
import { getLocale } from '../state'
import { markTrashSuperseded, moveToTrash } from './trash'
import { pauseWatching, resumeWatching } from './watcher'

/**
 * 时间机器（PLAN §5.8）：独立 git 仓库 + 双 ref 链。
 * - 仓库在 userData/history/<vaultId>，库目录不出现 .git
 * - 手动快照 refs/heads/snapshots；自动保护快照 refs/protect（最多 50 条 / 7 天）
 * - 所有 git 命令都隔离全局配置：别人机器上的 autocrlf / hook / 签名不能影响快照内容
 */

const MANUAL_REF = 'refs/heads/snapshots'
const PROTECT_REF = 'refs/protect'
const PROTECT_MAX = 50
const PROTECT_KEEP_MS = 7 * 24 * 60 * 60 * 1000
const MAX_DIFF_BYTES = 2 * 1024 * 1024
const SHA_RE = /^[0-9a-f]{40}$/

interface RepoState {
  vaultId: string
  root: string
  dir: string
  version: string
}

let repo: RepoState | null = null
let initPromise: Promise<HistoryStatus> | null = null
let initVaultId: string | null = null
let status: HistoryStatus = {
  available: false,
  version: null,
  ready: false,
  busy: false,
  reason: 'no-vault'
}
let busy = false
let workingTimer: NodeJS.Timeout | null = null

const listeners = new Set<(reason: string) => void>()

export function onHistoryChanged(listener: (reason: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(reason: string): void {
  for (const listener of listeners) listener(reason)
}

export function getHistoryStatus(): HistoryStatus {
  return { ...status, busy }
}

function setBusy(next: boolean): void {
  busy = next
  status.busy = next
}

/** watcher 报文件变化：变更列表要跟着动，但不要每个事件都刷一次 */
export function noteWorkingTreeChanged(): void {
  if (repo === null || !status.ready) return
  if (workingTimer !== null) clearTimeout(workingTimer)
  workingTimer = setTimeout(() => {
    workingTimer = null
    emit('files')
  }, 500)
}

export function resetHistory(): void {
  if (workingTimer !== null) {
    clearTimeout(workingTimer)
    workingTimer = null
  }
  repo = null
  initPromise = null
  initVaultId = null
  busy = false
  status = { available: false, version: null, ready: false, busy: false, reason: 'no-vault' }
}

/** git 命令隔离环境：不带系统/全局配置，也不走 hook */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    LANG: 'C'
  }
}

interface GitRun {
  code: number
  stdout: string
  stderr: string
}

function run(bin: string, args: string[], cwd?: string, maxBuffer = 64 * 1024 * 1024): Promise<GitRun> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, { cwd, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let overflow = false

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > maxBuffer) {
        overflow = true
        child.kill()
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (overflow) {
        rejectPromise(new Error('git 输出超过大小上限'))
        return
      }
      resolvePromise({ code: code ?? -1, stdout, stderr })
    })
  })
}

async function git(args: string[], maxBuffer?: number): Promise<string> {
  if (repo === null) throw new Error('还没有打开库')
  const full = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.quotepath=false',
    '--git-dir',
    repo.dir,
    '--work-tree',
    repo.root,
    ...args
  ]
  const result = await run('git', full, repo.root, maxBuffer)
  if (result.code !== 0) {
    throw new Error(`git ${args.slice(0, 2).join(' ')} 失败：${result.stderr.trim() || `exit ${result.code}`}`)
  }
  return result.stdout
}

async function gitMaybe(args: string[]): Promise<string | null> {
  if (repo === null) return null
  const full = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.quotepath=false',
    '--git-dir',
    repo.dir,
    '--work-tree',
    repo.root,
    ...args
  ]
  const result = await run('git', full, repo.root)
  return result.code === 0 ? result.stdout : null
}

async function revParse(ref: string): Promise<string | null> {
  const out = await gitMaybe(['rev-parse', '--verify', '--quiet', ref])
  const sha = out?.trim() ?? ''
  return SHA_RE.test(sha) ? sha : null
}

async function treeOf(commit: string): Promise<string> {
  return (await git(['rev-parse', `${commit}^{tree}`])).trim()
}

async function stageAll(): Promise<void> {
  await git(['add', '-A', '--', '.'])
}

async function writeTree(): Promise<string> {
  return (await git(['write-tree'])).trim()
}

async function commitTree(tree: string, parent: string | null, message: string, dateSec?: number): Promise<string> {
  const args = ['commit-tree', tree]
  if (parent !== null) args.push('-p', parent)
  // 重建历史时保留原始作者/提交时间，避免删除中间快照让时间戳全变
  const env: NodeJS.ProcessEnv = { ...gitEnv() }
  if (dateSec !== undefined) {
    env['GIT_AUTHOR_DATE'] = `${dateSec} +0000`
    env['GIT_COMMITTER_DATE'] = `${dateSec} +0000`
  }
  const child = spawn(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=时间机器',
      '-c',
      'user.email=tm@local',
      '--git-dir',
      repo!.dir,
      '--work-tree',
      repo!.root,
      ...args
    ],
    { cwd: repo!.root, env }
  )
  let error = ''
  const done = new Promise<string>((resolvePromise, rejectPromise) => {
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString('utf8')
    })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code !== 0) rejectPromise(new Error(`git commit-tree 失败：${error.trim() || `exit ${code}`}`))
      else resolvePromise(out.trim())
    })
  })
  child.stdin.end(`${message}\n`)
  return done
}

async function updateRef(ref: string, sha: string): Promise<void> {
  await git(['update-ref', ref, sha])
}

async function deleteRef(ref: string): Promise<void> {
  await gitMaybe(['update-ref', '-d', ref])
}

async function countTree(treeLike: string): Promise<number> {
  const out = await git(['ls-tree', '-r', '--name-only', treeLike])
  return out.split('\n').filter((line) => line !== '').length
}

/** 本次快照真正改了几个文件（自动备注里的 N；和列表行的「N 个文件」保持同一口径） */
async function countChanged(compare: string | null, tree: string): Promise<number> {
  if (compare === null) return countTree(tree)
  const out = await git(['diff', '--name-only', compare, tree])
  return out.split('\n').filter((line) => line !== '').length
}

/** 解析 `git log --format=%H%x1f%at%x1f%s --numstat` */
interface LogEntry {
  sha: string
  message: string
  createdAt: number
  additions: number
  deletions: number
  files: number
}

async function readLog(ref: string): Promise<LogEntry[]> {
  const out = await git(['log', '--root', '--format=%H%x1f%at%x1f%s', '--numstat', ref])
  const entries: LogEntry[] = []
  let current: LogEntry | null = null
  for (const line of out.split('\n')) {
    if (line === '') continue
    const parts = line.split('\x1f')
    if (parts.length === 3 && SHA_RE.test(parts[0])) {
      if (current !== null) entries.push(current)
      current = { sha: parts[0], createdAt: Number(parts[1]) * 1000, message: parts[2], additions: 0, deletions: 0, files: 0 }
      continue
    }
    if (current === null) continue
    const cols = line.split('\t')
    if (cols.length < 3) continue
    current.files += 1
    const add = Number(cols[0])
    const del = Number(cols[1])
    if (Number.isFinite(add)) current.additions += add
    if (Number.isFinite(del)) current.deletions += del
  }
  if (current !== null) entries.push(current)
  return entries
}

function toSnapshot(entry: LogEntry): Snapshot {
  return {
    sha: entry.sha,
    message: entry.message,
    createdAt: entry.createdAt,
    filesChanged: entry.files,
    insertions: entry.additions,
    deletions: entry.deletions
  }
}

async function listCommits(ref: string): Promise<LogEntry[]> {
  if ((await revParse(ref)) === null) return []
  // readLog 是倒序（新在前）；重建链要正序，调用处自己 reverse
  return readLog(ref)
}

/** 用同样的 tree/消息/时间重建一条线性链；返回新的头 */
async function rebuildChain(ref: string, orderedOldestFirst: LogEntry[]): Promise<string | null> {
  let parent: string | null = null
  let head: string | null = null
  for (const entry of orderedOldestFirst) {
    const tree = await treeOf(entry.sha)
    head = await commitTree(tree, parent, entry.message, Math.floor(entry.createdAt / 1000))
    parent = head
  }
  if (head === null) await deleteRef(ref)
  else await updateRef(ref, head)
  return head
}

async function collectGarbage(): Promise<void> {
  await gitMaybe(['reflog', 'expire', '--expire-unreachable=now', '--all'])
  await gitMaybe(['gc', '--prune=now', '--quiet'])
}

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function autoMessage(fileCount: number): string {
  const stamp = formatTimestamp(new Date())
  return getLocale() === 'en' ? `Snapshot · ${stamp} · ${fileCount} files` : `快照 · ${stamp} · ${fileCount} 个文件`
}

function sanitizeRemark(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200)
}

async function detectGit(): Promise<string | null> {
  try {
    const result = await run('git', ['--version'], undefined, 1024 * 1024)
    if (result.code !== 0) return null
    return result.stdout.trim() || 'git'
  } catch {
    return null
  }
}

async function initRepo(vault: Vault, version: string): Promise<void> {
  const dir = repoDirFor(vault.id)
  await mkdir(dir, { recursive: true })
  const envArgs = ['--git-dir', dir, '--work-tree', vault.root]
  const init = await run('git', [...envArgs, 'init', '--quiet'], vault.root)
  if (init.code !== 0) throw new Error(init.stderr.trim() || 'git init 失败')

  const configs: [string, string][] = [
    ['core.bare', 'false'],
    ['core.worktree', vault.root],
    ['core.autocrlf', 'false'],
    ['user.name', '时间机器'],
    ['user.email', 'tm@local']
  ]
  for (const [key, value] of configs) {
    const result = await run('git', [...envArgs, 'config', key, value], vault.root)
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git config ${key} 失败`)
  }

  await mkdir(join(dir, 'info'), { recursive: true })
  await writeFile(
    join(dir, 'info', 'exclude'),
    ['.DS_Store', 'node_modules/', '*.tmp', '.git/', 'Thumbs.db'].join('\n') + '\n',
    'utf8'
  )

  repo = { vaultId: vault.id, root: vault.root, dir, version }

  // 首次打开库：内部保护链打一条「基线」，作为文档变更的对比基准
  if ((await revParse(PROTECT_REF)) === null) {
    await stageAll()
    const tree = await writeTree()
    const baseline = await commitTree(tree, null, getLocale() === 'en' ? 'baseline' : '基线')
    await updateRef(PROTECT_REF, baseline)
  }
}

export function repoDirFor(vaultId: string): string {
  return join(app.getPath('userData'), 'history', vaultId)
}

export async function ensureHistory(vault: Vault | null): Promise<HistoryStatus> {
  if (vault === null) {
    resetHistory()
    return getHistoryStatus()
  }
  if (repo !== null && repo.vaultId === vault.id && status.ready) return getHistoryStatus()
  if (initPromise !== null && initVaultId === vault.id) return initPromise

  initVaultId = vault.id
  status = { available: false, version: null, ready: false, busy: false, reason: null }
  initPromise = (async () => {
    const version = await detectGit()
    if (version === null) {
      status = { available: false, version: null, ready: false, busy: false, reason: 'no-git' }
      initPromise = null
      return getHistoryStatus()
    }
    try {
      await initRepo(vault, version)
      status = { available: true, version, ready: true, busy: false, reason: null }
    } catch (error) {
      console.error('[history] 初始化失败', error)
      status = { available: true, version, ready: false, busy: false, reason: 'init-failed' }
      repo = null
    }
    initPromise = null
    emit('ready')
    return getHistoryStatus()
  })()
  return initPromise
}

function requireReady(): RepoState {
  if (repo === null || !status.ready) throw new Error('时间机器还没有准备好')
  return repo
}

export async function listSnapshots(): Promise<Snapshot[]> {
  if (repo === null || !status.ready) return []
  return listCommits(MANUAL_REF).then((entries) => entries.map(toSnapshot))
}

export async function saveSnapshot(rawRemark: unknown): Promise<SnapshotSaveResult> {
  if (repo === null || !status.ready) return { ok: false, reason: 'unavailable', snapshot: undefined }
  if (busy) return { ok: false, reason: 'busy' }
  requireReady()
  setBusy(true)
  try {
    const manualTip = await revParse(MANUAL_REF)
    const compare = manualTip ?? (await revParse(PROTECT_REF))
    await stageAll()
    const tree = await writeTree()

    if (compare !== null && (await treeOf(compare)) === tree) {
      return { ok: false, reason: 'empty' }
    }

    const remark = sanitizeRemark(rawRemark)
    const count = await countChanged(compare, tree)
    const message = remark === '' ? autoMessage(count) : remark
    const commit = await commitTree(tree, manualTip, message)
    await updateRef(MANUAL_REF, commit)

    const entries = await listCommits(MANUAL_REF)
    const head = entries.find((entry) => entry.sha === commit)
    emit('snapshot')
    return { ok: true, reason: null, snapshot: head !== undefined ? toSnapshot(head) : undefined }
  } finally {
    setBusy(false)
  }
}

async function snapshotDetail(sha: string): Promise<SnapshotDetail> {
  const entries = await listCommits(MANUAL_REF)
  const head = entries.find((entry) => entry.sha === sha)
  if (head === undefined) throw new Error('快照不存在')
  return { snapshot: toSnapshot(head), files: await diffTree(sha, true) }
}

async function diffTree(sha: string, root: boolean): Promise<SnapshotFileChange[]> {
  const args = ['diff-tree', '--no-commit-id', '--name-status', '-r']
  if (root) args.push('--root')
  args.push(sha)
  const statusOut = await git(args)
  const numArgs = ['diff-tree', '--no-commit-id', '--numstat', '-r']
  if (root) numArgs.push('--root')
  numArgs.push(sha)
  const numOut = await git(numArgs)

  const counts = new Map<string, { additions: number; deletions: number }>()
  for (const line of numOut.split('\n')) {
    if (line === '') continue
    const cols = line.split('\t')
    if (cols.length < 3) continue
    const add = Number(cols[0])
    const del = Number(cols[1])
    counts.set(cols[cols.length - 1], {
      additions: Number.isFinite(add) ? add : 0,
      deletions: Number.isFinite(del) ? del : 0
    })
  }

  const files: SnapshotFileChange[] = []
  for (const line of statusOut.split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const rawStatus = line.slice(0, tab)
    const pathPart = line.slice(tab + 1)
    // 重命名写成 `old => new`，列表里只显示新路径
    const relPath = pathPart.includes(' => ') ? pathPart.split(' => ')[1] : pathPart
    const status = rawStatus.startsWith('R') ? 'R' : rawStatus.startsWith('A') ? 'A' : rawStatus.startsWith('D') ? 'D' : 'M'
    const count = counts.get(pathPart) ?? counts.get(relPath) ?? { additions: 0, deletions: 0 }
    files.push({ relPath, status, additions: count.additions, deletions: count.deletions })
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export async function getSnapshotDetail(sha: string): Promise<SnapshotDetail> {
  if (!SHA_RE.test(sha)) throw new Error('快照 id 非法')
  if (repo === null || !status.ready) throw new Error('时间机器还没有准备好')
  return snapshotDetail(sha)
}

function isBinary(text: string): boolean {
  return text.includes('\u0000')
}

async function showAt(rev: string, relPath: string): Promise<{ text: string; truncated: boolean }> {
  const result = await gitMaybe(['show', `${rev}:${relPath}`])
  if (result === null) return { text: '', truncated: false }
  if (result.length > MAX_DIFF_BYTES) {
    return { text: result.slice(0, MAX_DIFF_BYTES), truncated: true }
  }
  return { text: result, truncated: false }
}

async function parentOf(sha: string): Promise<string | null> {
  return revParse(`${sha}^`)
}

export async function getSnapshotFileDiff(sha: string, rawRelPath: unknown): Promise<FileDiff> {
  if (!SHA_RE.test(sha)) throw new Error('快照 id 非法')
  const relPath = normalizeRelPath(rawRelPath)
  if (relPath === '') throw new Error('文档路径非法')
  requireReady()
  const parent = await parentOf(sha)
  const oldSide = parent !== null ? await showAt(parent, relPath) : { text: '', truncated: false }
  const newSide = await showAt(sha, relPath)
  const binary = isBinary(oldSide.text) || isBinary(newSide.text)
  const status: FileDiff['status'] = parent === null ? 'A' : newSide.text === '' ? 'D' : 'M'
  return {
    relPath,
    status,
    oldText: binary ? '' : oldSide.text,
    newText: binary ? '' : newSide.text,
    binary,
    truncated: oldSide.truncated || newSide.truncated
  }
}

async function currentRef(): Promise<string | null> {
  return (await revParse(MANUAL_REF)) ?? (await revParse(PROTECT_REF))
}

export async function listWorkingChanges(): Promise<WorkingChange[]> {
  if (repo === null || !status.ready) return []
  const ref = await currentRef()
  if (ref === null) return []

  const statusOut = await git(['diff', '--name-status', ref])
  const numOut = await git(['diff', '--numstat', ref])
  const counts = new Map<string, { additions: number; deletions: number }>()
  for (const line of numOut.split('\n')) {
    if (line === '') continue
    const cols = line.split('\t')
    if (cols.length < 3) continue
    const add = Number(cols[0])
    const del = Number(cols[1])
    counts.set(cols[cols.length - 1], {
      additions: Number.isFinite(add) ? add : 0,
      deletions: Number.isFinite(del) ? del : 0
    })
  }

  const files: WorkingChange[] = []
  for (const line of statusOut.split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const rawStatus = line.slice(0, tab)
    const pathPart = line.slice(tab + 1)
    const relPath = pathPart.includes(' => ') ? pathPart.split(' => ')[1] : pathPart
    const status = rawStatus.startsWith('R') ? 'R' : rawStatus.startsWith('A') ? 'A' : rawStatus.startsWith('D') ? 'D' : 'M'
    const count = counts.get(pathPart) ?? counts.get(relPath) ?? { additions: 0, deletions: 0 }
    files.push({ relPath, status, additions: count.additions, deletions: count.deletions })
  }

  // 未跟踪文件（git diff 看不到）：按「新增」列出，行数当场数
  const untrackedOut = await git(['ls-files', '--others', '--exclude-standard'])
  for (const relPath of untrackedOut.split('\n')) {
    if (relPath === '') continue
    let additions = 0
    try {
      const info = await readFile(resolveInside(repo.root, relPath), 'utf8')
      additions = info === '' ? 0 : info.split('\n').length
    } catch {
      additions = 0
    }
    files.push({ relPath, status: 'A', additions, deletions: 0 })
  }

  const seen = new Set<string>()
  return files
    .filter((file) => {
      if (seen.has(file.relPath)) return false
      seen.add(file.relPath)
      return true
    })
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

async function readWorkingFile(relPath: string): Promise<{ text: string; truncated: boolean }> {
  try {
    const absolute = resolveInside(repo!.root, relPath)
    const buffer = await readFile(absolute)
    if (buffer.length > MAX_DIFF_BYTES) {
      return { text: buffer.toString('utf8', 0, MAX_DIFF_BYTES), truncated: true }
    }
    return { text: buffer.toString('utf8'), truncated: false }
  } catch {
    return { text: '', truncated: false }
  }
}

export async function getWorkingFileDiff(rawRelPath: unknown): Promise<FileDiff> {
  const relPath = normalizeRelPath(rawRelPath)
  if (relPath === '') throw new Error('文档路径非法')
  requireReady()
  const ref = await currentRef()
  if (ref === null) throw new Error('还没有基线快照')

  const oldSide = await showAt(ref, relPath)
  const newSide = await readWorkingFile(relPath)
  const binary = isBinary(oldSide.text) || isBinary(newSide.text)
  const status: FileDiff['status'] = oldSide.text === '' ? 'A' : newSide.text === '' ? 'D' : 'M'
  return {
    relPath,
    status,
    oldText: binary ? '' : oldSide.text,
    newText: binary ? '' : newSide.text,
    binary,
    truncated: oldSide.truncated || newSide.truncated
  }
}

async function currentFiles(): Promise<string[]> {
  const out = await git(['ls-files', '-co', '--exclude-standard'])
  return out.split('\n').filter((line) => line !== '')
}

async function targetFiles(sha: string): Promise<string[]> {
  const out = await git(['ls-tree', '-r', '--name-only', sha])
  return out.split('\n').filter((line) => line !== '')
}

async function pruneEmptyDirs(startRel: string): Promise<void> {
  if (repo === null) return
  let current = startRel
  while (current !== '') {
    try {
      const entries = await readdir(resolveInside(repo.root, current))
      if (entries.length > 0) return
      await rm(resolveInside(repo.root, current), { recursive: false })
    } catch {
      return
    }
    const slash = current.lastIndexOf('/')
    current = slash === -1 ? '' : current.slice(0, slash)
  }
}

async function hasWorkingChanges(ref: string): Promise<boolean> {
  const diff = await run(
    'git',
    ['--git-dir', repo!.dir, '--work-tree', repo!.root, 'diff', '--quiet', ref],
    repo!.root
  )
  if (diff.code === 1) return true
  if (diff.code !== 0) throw new Error(diff.stderr.trim() || 'git diff 失败')
  const untracked = await git(['ls-files', '--others', '--exclude-standard'])
  return untracked.trim() !== ''
}

export async function rewindToSnapshot(sha: string): Promise<RewindResult> {
  if (!SHA_RE.test(sha)) throw new Error('快照 id 非法')
  const state = requireReady()
  if (busy) throw new Error('时间机器正忙，请稍候')
  setBusy(true)
  let suspended = false
  try {
    const ref = await currentRef()
    if (ref !== null && (await hasWorkingChanges(ref))) {
      // 先自动打一条保护快照：切换后用户想回来，必须有东西可回
      await stageAll()
      const tree = await writeTree()
      const tip = await revParse(PROTECT_REF)
      if (tip === null || (await treeOf(tip)) !== tree) {
        const commit = await commitTree(tree, tip, 'rewind-before')
        await updateRef(PROTECT_REF, commit)
      }
    }

    pauseWatching()
    suspended = true

    const target = new Set(await targetFiles(sha))
    const present = await currentFiles()
    let trashed = 0
    const removedParents: string[] = []
    for (const relPath of present) {
      if (target.has(relPath)) continue
      const normalized = normalizeRelPath(relPath)
      if (normalized === '') continue
      try {
        await moveToTrash({ id: state.vaultId, root: state.root }, normalized)
        trashed += 1
        const slash = normalized.lastIndexOf('/')
        if (slash > 0) removedParents.push(normalized.slice(0, slash))
      } catch (error) {
        console.warn('[history] 移入回收站失败', normalized, error)
      }
    }

    // 恢复目标内容：checkout 只覆盖目标里的路径，随后 read-tree 让 index 与目标一致
    await git(['checkout', sha, '--', '.'])
    await git(['read-tree', sha])

    for (const parent of new Set(removedParents)) await pruneEmptyDirs(parent)

    const superseded = await markTrashSuperseded(state.vaultId, [...target], sha)
    resumeWatching()
    suspended = false
    emit('rewind')
    return { restored: target.size, trashed, superseded }
  } finally {
    if (suspended) resumeWatching()
    setBusy(false)
  }
}

export async function deleteSnapshot(sha: string): Promise<void> {
  if (!SHA_RE.test(sha)) throw new Error('快照 id 非法')
  requireReady()
  if (busy) throw new Error('时间机器正忙，请稍候')
  setBusy(true)
  try {
    const newestFirst = await listCommits(MANUAL_REF)
    const index = newestFirst.findIndex((entry) => entry.sha === sha)
    if (index === -1) throw new Error('快照不存在')
    const keptOldestFirst = newestFirst
      .filter((entry) => entry.sha !== sha)
      .reverse()
    await rebuildChain(MANUAL_REF, keptOldestFirst)
    await collectGarbage()
    emit('delete')
  } finally {
    setBusy(false)
  }
}

/** 保护链：保留最近 50 条且不超过 7 天；超出就按「同 tree / 同消息 / 同时间」重建 */
async function trimProtect(): Promise<void> {
  const newestFirst = await listCommits(PROTECT_REF)
  if (newestFirst.length <= PROTECT_MAX) {
    const cutoff = Date.now() - PROTECT_KEEP_MS
    if (newestFirst.every((entry) => entry.createdAt >= cutoff)) return
  }
  const cutoff = Date.now() - PROTECT_KEEP_MS
  const kept = newestFirst
    .filter((entry, index) => index < PROTECT_MAX && entry.createdAt >= cutoff)
    .reverse()
  if (kept.length === newestFirst.length) return
  await rebuildChain(PROTECT_REF, kept)
}

export async function createProtectSnapshot(message = 'autosave'): Promise<void> {
  if (repo === null || !status.ready) return
  await stageAll()
  const tree = await writeTree()
  const tip = await revParse(PROTECT_REF)
  if (tip !== null && (await treeOf(tip)) === tree) return
  const commit = await commitTree(tree, tip, message)
  await updateRef(PROTECT_REF, commit)
  await trimProtect()
}
