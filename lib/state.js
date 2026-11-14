/**
 * Skill Manager —— 持久化状态。
 *
 * 状态分两类，存在同一个 JSON 文件里：
 *
 *   1. **分组（groups）**：全档案共享。一个组就是一批技能名字，可以整体开关。
 *   2. **会话状态（sessions）**：按 SessionId 隔离。这就是「每个会话里的插件都是
 *      单独管理的」那条需求——A 会话关掉的技能，不影响 B 会话。
 *
 * 文件保存在 `$DSH_HOME/skill-manager/state.json`。写入走「临时文件 + rename」，
 * 避免进程被杀时留下半个 JSON。读失败（文件损坏、Schema 变过）时退回默认值，
 * 而不是让插件挂掉——插件坏掉不应该连累 agent 循环。
 *
 * @module skill-manager/lib/state
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 状态文件格式版本。结构不兼容时整份丢弃重来。 */
const STATE_VERSION = 1

/**
 * 一个会话的默认状态：总开关打开、自动选择关闭、没有单独禁用的技能。
 * 这种状态下插件完全让位给 DSH 原生行为（不接管 skill 工具，也不改技能目录）。
 */
export const DEFAULT_SESSION_STATE = Object.freeze({
  master: true,
  auto: false,
  disabled: [],
})

/** 一个会话在磁盘上的形状。 */
const SESSION_KEYS = ['master', 'auto', 'disabled']

/**
 * 解析 DSH_HOME。宿主进程一般已经设好这个变量；没设的时候按 DSH 的约定退回
 * `~/.dsh`，这样在非 profile 启动的场景下插件也能工作。
 * @returns {string} 状态目录的绝对路径。
 */
function dshHome() {
  const fromEnv = process.env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

/** 状态文件路径。 */
export const STATE_PATH = join(dshHome(), 'skill-manager', 'state.json')

/** 全部默认状态。 */
function emptyState() {
  return { version: STATE_VERSION, groups: [], sessions: {} }
}

/**
 * 把一个技能名收进数组并去重。技能名是 kebab-case，这里只做轻微清洗，
 * 真正的合法性由 `ctx.skills` 决定。
 * @param {unknown} value - 任意候选值。
 * @returns {string[]} 干净的技能名数组。
 */
function normalizeNames(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const names = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) continue
    if (seen.has(item)) continue
    seen.add(item)
    names.push(item)
  }
  return names
}

/**
 * 校验并规范化一个分组。
 * @param {unknown} raw - 磁盘上读到的原始值。
 * @param {number} index - 用作兜底 id 的下标。
 * @returns {{ id: string, name: string, skills: string[] } | null} 可用分组，或 null。
 */
function normalizeGroup(raw, index) {
  if (typeof raw !== 'object' || raw === null) return null
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (name.length === 0) return null
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `group-${index + 1}`
  // description 是给悬停说明用的一句话；没有就留空，界面上退回「共 N 个技能」
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  return { id, name, skills: normalizeNames(raw.skills), description }
}

/**
 * 校验并规范化一个会话状态。缺字段按默认值补齐，多字段直接丢掉。
 * @param {unknown} raw - 磁盘上读到的原始值。
 * @returns {{ master: boolean, auto: boolean, disabled: string[] }} 规范化后的状态。
 */
function normalizeSession(raw) {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SESSION_STATE }
  return {
    master: raw.master === undefined ? true : raw.master === true,
    auto: raw.auto === true,
    disabled: normalizeNames(raw.disabled),
  }
}

/**
 * 把任意来源的数据整理成合法状态。任何不认识的形状都退回默认，绝不抛错。
 * @param {unknown} raw - 解析后的 JSON。
 * @returns {{ version: number, groups: Array<{id: string, name: string, skills: string[]}>, sessions: Record<string, {master: boolean, auto: boolean, disabled: string[]}> }} 合法状态。
 */
export function normalizeState(raw) {
  if (typeof raw !== 'object' || raw === null) return emptyState()
  if (raw.version !== STATE_VERSION) return emptyState()
  const groups = []
  if (Array.isArray(raw.groups)) {
    for (let index = 0; index < raw.groups.length; index += 1) {
      const group = normalizeGroup(raw.groups[index], index)
      if (group !== null) groups.push(group)
    }
  }
  const sessions = {}
  if (typeof raw.sessions === 'object' && raw.sessions !== null && !Array.isArray(raw.sessions)) {
    for (const [key, value] of Object.entries(raw.sessions)) {
      if (key.length === 0) continue
      sessions[key] = normalizeSession(value)
    }
  }
  return { version: STATE_VERSION, groups, sessions }
}

/**
 * 一次会话状态是否等于默认值。等于默认时插件不接管 `skill` 工具，把行为完全交回
 * DSH 原生实现——这是本插件最重要的安全阀。
 * @param {{ master: boolean, auto: boolean, disabled: string[] }} state - 会话状态。
 * @returns {boolean} 是否等同于默认。
 */
export function isDefaultSession(state) {
  return state.master === true && state.auto === false && state.disabled.length === 0
}

/**
 * 只保留 SESSION_KEYS 声明过的字段，便于写盘时保持文件干净。
 * @param {{ master: boolean, auto: boolean, disabled: string[] }} state - 会话状态。
 * @returns {{ master: boolean, auto: boolean, disabled: string[] }} 精简后的状态。
 */
function compactSession(state) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of SESSION_KEYS) out[key] = state[key]
  return /** @type {{ master: boolean, auto: boolean, disabled: string[] }} */ (out)
}

/**
 * 状态仓库：内存里持有一份，写盘串行化，读盘只做一次。
 */
export class SkillManagerState {
  /**
   * @param {string} path - 状态文件路径。
   */
  constructor(path = STATE_PATH) {
    /** 状态文件路径。 */
    this.path = path
    /** 当前内存状态。 */
    this.state = emptyState()
    /** 是否已经从磁盘读过。 */
    this.loaded = false
    /** 串行化写盘的队列。 */
    this.writing = Promise.resolve()
    /** 每次变更递增，客户端用它判断是否需要重新拉取。 */
    this.revision = 0
    /** @type {Set<() => void>} 变更订阅者。 */
    this.listeners = new Set()
  }

  /**
   * 从磁盘载入。文件不存在是正常情况（第一次装插件）。解析失败时保留默认值，
   * 但把原始文件改名备份，免得下次写盘把用户的残骸直接覆盖掉。
   * @returns {Promise<void>} 载入完成。
   */
  async load() {
    if (this.loaded) return
    // 并发调用要拿到同一个 promise。只置标志位的话，第二个调用会立刻返回，
    // 而那时磁盘还没读上来——调用方（HTTP 的 state、状态订阅读取）就会拿着一份
    // 全默认值当成真实状态。
    if (this.loading !== undefined) return this.loading
    this.loading = this.readOnce()
    return this.loading
  }

  /**
   * 真正读一次磁盘。只由 `load()` 调用。
   * @returns {Promise<void>} 读完成。
   */
  async readOnce() {
    let text
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return
    }
    try {
      this.state = normalizeState(JSON.parse(text))
    } catch {
      this.state = emptyState()
      const backup = `${this.path}.corrupt-${Date.now()}`
      try {
        await rename(this.path, backup)
      } catch {
        // 备份失败不影响功能：内存里已经是默认状态了。
      }
    }
    this.loaded = true
  }

  /**
   * 订阅变更。用于让 UI 在别的调用方改了状态后刷新。
   * @param {() => void} listener - 变更回调。
   * @returns {() => void} 取消订阅。
   */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 通知所有订阅者。 */
  emit() {
    this.revision += 1
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 订阅者自己的错误不该影响状态写入。
      }
    }
  }

  /**
   * 把当前状态写盘。多次调用会串行排队，后写覆盖前写。
   * @returns {Promise<void>} 写盘完成。
   */
  async save() {
    const payload = JSON.stringify(
      {
        version: this.state.version,
        groups: this.state.groups,
        sessions: Object.fromEntries(
          Object.entries(this.state.sessions).map(([key, value]) => [key, compactSession(value)]),
        ),
      },
      null,
      2,
    )
    const target = this.path
    const run = async () => {
      await mkdir(join(target, '..'), { recursive: true })
      const temp = `${target}.${process.pid}.tmp`
      await writeFile(temp, payload, 'utf8')
      await rename(temp, target)
    }
    const next = this.writing.then(run, run)
    this.writing = next.catch(() => {})
    await next
  }

  /**
   * 读一个会话的状态。没有记录时返回默认值（不写盘）。
   * @param {string} sessionId - 会话 id。
   * @returns {{ master: boolean, auto: boolean, disabled: string[] }} 会话状态。
   */
  session(sessionId) {
    const stored = this.state.sessions[sessionId]
    return stored === undefined ? { ...DEFAULT_SESSION_STATE } : normalizeSession(stored)
  }

  /**
   * 整体替换一个会话的状态。等于默认值时把记录删掉，保持文件干净。
   * @param {string} sessionId - 会话 id。
   * @param {{ master?: boolean, auto?: boolean, disabled?: unknown }} patch - 要覆盖的字段。
   * @returns {Promise<{ master: boolean, auto: boolean, disabled: string[] }>} 写入后的状态。
   */
  async setSession(sessionId, patch) {
    const current = this.session(sessionId)
    const next = normalizeSession({ ...current, ...patch })
    if (isDefaultSession(next)) delete this.state.sessions[sessionId]
    else this.state.sessions[sessionId] = next
    await this.save()
    this.emit()
    return next
  }

  /**
   * 这个会话有没有被显式写过状态。用来区分「用户配置过」和「第一次进来」。
   * @param {string} sessionId - 会话 id。
   * @returns {boolean} 是否存在记录。
   */
  hasSession(sessionId) {
    return this.state.sessions[sessionId] !== undefined
  }

  /**
   * 切换单个技能在本会话里的启用状态。
   * @param {string} sessionId - 会话 id。
   * @param {string[]} names - 要改的技能名。
   * @param {boolean} enabled - true = 启用，false = 禁用。
   * @returns {Promise<{ master: boolean, auto: boolean, disabled: string[] }>} 写入后的状态。
   */
  async setSkillsEnabled(sessionId, names, enabled) {
    const current = this.session(sessionId)
    const set = new Set(current.disabled)
    for (const name of names) {
      if (enabled) set.delete(name)
      else set.add(name)
    }
    return this.setSession(sessionId, { disabled: [...set] })
  }

  /**
   * 列出全部分组。
   * @returns {Array<{id: string, name: string, skills: string[]}>} 分组副本。
   */
  groups() {
    return this.state.groups.map((group) => ({ ...group, skills: [...group.skills] }))
  }

  /**
   * 新建或更新一个分组。同名分组会被合并（名字是用户的唯一标识）。
   * @param {{ id?: string, name: string, skills?: string[] }} input - 分组定义。
   * @returns {Promise<{ id: string, name: string, skills: string[] }>} 写入后的分组。
   */
  async upsertGroup(input) {
    const name = String(input.name ?? '').trim()
    if (name.length === 0) throw new Error('分组名不能为空')
    const skills = normalizeNames(input.skills ?? [])
    const existing = this.state.groups.find(
      (group) => (input.id !== undefined && input.id.length > 0 && group.id === input.id) || group.name === name,
    )
    if (existing !== undefined) {
      existing.name = name
      existing.skills = skills
      await this.save()
      this.emit()
      return { ...existing, skills: [...existing.skills] }
    }
    const group = { id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, skills }
    this.state.groups.push(group)
    await this.save()
    this.emit()
    return { ...group, skills: [...group.skills] }
  }

  /**
   * 删除一个分组。只删分组本身，不动会话状态。
   * @param {string} id - 分组 id。
   * @returns {Promise<boolean>} 是否真的删掉了。
   */
  async removeGroup(id) {
    const before = this.state.groups.length
    this.state.groups = this.state.groups.filter((group) => group.id !== id)
    if (this.state.groups.length === before) return false
    await this.save()
    this.emit()
    return true
  }

  /**
   * 把一个技能加入或移出一个分组。
   * @param {string} id - 分组 id。
   * @param {string} skill - 技能名。
   * @param {boolean} member - true = 加入，false = 移出。
   * @returns {Promise<{ id: string, name: string, skills: string[] } | null>} 更新后的分组。
   */
  async setGroupMember(id, skill, member) {
    const group = this.state.groups.find((item) => item.id === id)
    if (group === undefined) return null
    const set = new Set(group.skills)
    if (member) set.add(skill)
    else set.delete(skill)
    group.skills = [...set]
    await this.save()
    this.emit()
    return { ...group, skills: [...group.skills] }
  }
}
