/**
 * Skill Manager —— 宿主（Node）半边。
 *
 * 职责按「谁最清楚」划分：
 *
 *   - **宿主**知道技能目录（`ctx.skills`）、知道会话状态（每个 agent 一份闸门）、
 *     并且是唯一能影响模型看到什么的地方。
 *   - **浏览器**负责界面。它不猜状态，全部经由下面那条同源路由读写。
 *
 * 为什么用 `ctx.connection.fetch` 而不是别的通道：
 *
 *   - `ctx.remote.*` 是构建期代码生成出来的命名空间，装上去的插件加不了自己的；
 *   - 动态插件专用的 `host.call` 只属于 `cordis_define` 造出来的包，普通 bundle
 *     拿不到；
 *   - `ctx.webServer.register()` 能用，但它**不做任何信任校验**，等于自己从零写
 *     一遍鉴权；
 *   - `ctx.connection.fetch.register()` 是 Connection 自己的鉴权围栏内部：强制
 *     `/api` 前缀、挡住跨站 `Sec-Fetch-Site`、校验 `Origin`、只答 owner 身份。
 *     这正是本插件要的——界面能读写，其它来源读不到。
 *
 * @module skill-manager
 */

import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

import { SkillManagerState, isDefaultSession } from './state.js'
import { createGuard } from './gate.js'
/** Cordis 插件名。 */
export const name = 'skill-manager'

/** 硬依赖：没有这些能力插件没有意义。 */
export const inject = ['skills', 'tools', 'agents', 'workingDirectory']

/**
 * 插件自己的诊断日志。
 *
 * DSH 桌面版不落文件日志，所以「启动时路由没注册上」这类问题以前只能靠 404 反推。
 * 这里记一行一个事件，出问题直接看 `<DSH_HOME>/skill-manager/plugin.log` 的时间线。
 * 日志本身绝不允许反过来影响功能，所以整段都包在 try 里。
 *
 * @param {string} message - 事件描述。
 * @returns {void}
 */
function logPlugin(message) {
  try {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const file = join(home, 'skill-manager', 'plugin.log')
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // 日志失败就算了，不能连累插件。
  }
}

/** 路由路径。必须在 `/api` 下，这是 Connection 的硬性要求。 */
const API_PATH = '/api/skill-manager'

/**
 * 统一响应形状。浏览器半边只认 `ok`，错误一律当成「这一下没成功」处理，
 * 这样界面不需要区分网络层错误和业务层错误。
 * @param {unknown} body - 任意可 JSON 化的值。
 * @returns {Response} JSON 响应。
 */
function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * 打「官方」标签的技能 —— 只算**深度求索亲自为 DSH 写的**。
 *
 * 不能用 `source` 推断：`source` 只说明「随安装包发布」（bundled）还是「插件运行时
 * 注册」（runtime），不说明作者。随包发布的 office 四件套其实源自 Anthropic，
 * j-space 是第三方框架，drawai 由插件注册——它们都不是深度求索的官方技能。
 */
const DEEPSEEK_OFFICIAL = new Set(['dsh-doc', 'diagnose-windows-sandbox-acl'])

/**
 * 粗估一段文本要占多少 token。
 *
 * 不引 tokenizer：这一步只是给用户一个「该关谁」的量级感，误差三成不影响判断。
 * 口径偏保守——中日韩字符按 1 字 1 token 算，其余按 4 字符 1 token。
 * @param {string} text - 文本。
 * @returns {number} 估算 token 数。
 */
function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  let cjk = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1
    else if (code >= 0xac00 && code <= 0xd7af) cjk += 1
    else if (code >= 0xf900 && code <= 0xfaff) cjk += 1
    else if (code >= 0xff00 && code <= 0xffef) cjk += 1
  }
  const rest = text.length - cjk
  return Math.ceil(cjk + rest / 4)
}

/**
 * 把技能摘要投影成界面要的字段。
 * @param {object} skill - `SkillSummary`。
 * @param {{ disabled: Set<string>, master: boolean }} ctxState - 会话状态。
 * @returns {object} 界面行。
 */
function projectSkill(skill, ctxState) {
  const description = String(skill.description ?? '')
  return {
    name: skill.name,
    description,
    whenToUse: skill.whenToUse ?? null,
    source: skill.source,
    provider: skill.provider,
    path: skill.path ?? null,
    // 模型每轮都会读到「名字 + 描述」，这就是这个技能的固定开销
    tokens: estimateTokens(`${skill.name} ${description}`),
    // 深度求索官方（白名单）／自带（随安装包或插件注册）／自装，界面上分三级显示
    official: DEEPSEEK_OFFICIAL.has(skill.name),
    modelInvocable: skill.invocation.modelInvocable === true,
    userInvocable: skill.invocation.userInvocable === true,
    enabled: ctxState.master && !ctxState.disabled.has(skill.name),
  }
}

/**
 * 插件入口。
 * @param {object} ctx - Cordis 上下文。
 * @returns {void}
 */
export function apply(ctx) {
  const store = new SkillManagerState()

  // ---- 界面通道 ----
  // 这里踩过一个很隐蔽的坑：**应用刚启动时，本插件的 apply() 可能比 connection
  // 服务先跑**。此时 `ctx.get('connection')` 返回 undefined，如果就地放弃注册，
  // 浏览器那一半请求 /api/skill-manager 拿到的是 HTTP 404，面板报「读取失败」，
  // 而插件在 `list_plugins` 里依然是 enabled/active —— 看起来像插件坏了，实际只是
  // 注册时机不对。手动「关掉再打开」能恢复，正是因为那时服务已就绪。
  //
  // 所以：拿到服务前一直重试（短轮询 + 有消息进来时再试一次），而不是一次性放弃。
  let routeDispose = null
  let routeRegistered = false

  /** 处理一次界面请求。 */
  async function handleRequest(request) {
    let body
    if (request.method === 'GET') {
      const url = new URL(request.url, 'http://localhost')
      body = {
        action: url.searchParams.get('action') ?? 'state',
        sessionId: url.searchParams.get('sessionId') ?? undefined,
      }
    } else {
      try {
        body = await request.json()
      } catch (error) {
        return jsonResponse({ ok: false, error: `请求体不是合法 JSON：${String(error?.message ?? error)}` })
      }
      if (typeof body !== 'object' || body === null) {
        return jsonResponse({ ok: false, error: '请求体必须是对象' })
      }
    }
    try {
      return jsonResponse({ ok: true, data: await dispatch(body) })
    } catch (error) {
      logPlugin(`dispatch 失败：${String(error?.stack ?? error)}`)
      return jsonResponse({ ok: false, error: String(error?.message ?? error) })
    }
  }

  /**
   * 尝试注册界面路由。服务没就绪时返回 false，由调用方继续重试。
   * @returns {boolean} 是否已经注册（或此前已注册）。
   */
  function registerRoute() {
    if (routeRegistered) return true
    const connection = ctx.get('connection')
    if (connection === undefined || connection.fetch === undefined) return false
    try {
      const dispose = connection.fetch.register({
        path: API_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: handleRequest,
      })
      routeDispose = typeof dispose === 'function' ? dispose : () => {}
      routeRegistered = true
      logPlugin('界面路由已注册')
      return true
    } catch (error) {
      logPlugin(`注册界面路由失败：${String(error?.stack ?? error)}`)
      return false
    }
  }

  ctx.effect(
    () => () => {
      routeRegistered = false
      try {
        routeDispose?.()
      } catch {
        // 卸载时路由可能已经被销毁，忽略。
      }
    },
    'skill-manager: 界面路由清理',
  )

  if (!registerRoute()) {
    logPlugin('connection 服务尚未就绪，开始等待重试')
    // 退避重试，最长约 10 分钟。用户重启 DSH 后插件先于 connection 服务加载是常态，
    // 没有理由在 60 秒后放弃——放弃的代价就是「必须手动关开一次插件」。
    // 界面那边也有自动重试，两边一起兜，不需要人插手。
    const delays = [200, 300, 500, 800, 1200, 2000, 3000, 5000, 8000, 10000]
    let step = 0
    let waited = 0
    let timer = null
    const schedule = () => {
      if (routeRegistered || waited > 600000) {
        if (!routeRegistered) logPlugin('等待约 10 分钟仍未拿到 connection.fetch，界面暂不可用')
        return
      }
      const delay = delays[Math.min(step, delays.length - 1)]
      step += 1
      waited += delay
      timer = setTimeout(() => {
        if (registerRoute()) return
        schedule()
      }, delay)
    }
    schedule()
    ctx.effect(
      () => () => {
        if (timer !== null) clearTimeout(timer)
      },
      'skill-manager: 界面路由重试',
    )
  }

  /** @type {Map<string, { skills: Array<object>, complete: boolean }>} 每个会话最近一次读到的目录，给新建闸门当种子。 */
  const catalogCache = new Map()

  /** @type {Map<string, { agent: object, dispose: () => void }>} 已经装上闸门的 agent。 */
  const gated = new Map()

  /** @type {Map<string, { autoPicked: string[], entries: string[], at: number }>} 最近一次目录计算的结果，供界面展示。 */
  const lastCatalog = new Map()

  /**
   * 取一个会话的实时状态。用于闸门回调，每次调用都读最新值，
   * 因此界面上改开关后下一轮请求就生效，不需要重启。
   * @param {string} sessionId - 会话 id。
   * @returns {{ master: boolean, auto: boolean, disabled: string[] }} 会话状态。
   */
  const sessionState = (sessionId) => store.session(sessionId)

  /**
   * 放掉一个 agent 的闸门。
   *
   * 必须按 **agent 对象身份** 而不是 sessionId 记账：会话被重开 / 清空 / 压缩时
   * DSH 会销毁旧 agent、用同一个 sessionId 造一个新 agent。只按 id 记的话，新
   * agent 会命中旧条目、被当成「已经接管」而跳过，于是开关照常写盘、模型侧却
   * 再也不被遮蔽，而且旧 guard 上抓着的 skills 服务已经随着旧 agent 作废了。
   *
   * @param {object} agent - 目标 agent。
   * @returns {void}
   */
  function releaseAgent(agent) {
    const entry = gated.get(agent.id)
    if (entry === undefined || entry.agent !== agent) {
      if (entry === undefined) gated.delete(agent.id)
      return
    }
    gated.delete(agent.id)
    lastCatalog.delete(agent.id)
    catalogCache.delete(agent.id)
    try {
      entry.guard.dispose()
    } catch (error) {
      console.error('[skill-manager] 释放闸门失败：', error)
    }
  }

  /**
   * 按当前状态决定这个 agent 该不该被接管。
   * @param {object} agent - DSH Agent。
   * @returns {void}
   */
  function syncGate(agent) {
    if (agent === undefined || typeof agent.id !== 'string') return
    const state = sessionState(agent.id)
    // 新会话的默认值是「全关」：先落盘，落完再建闸门，否则会先按全部启用建一次。
    if (!store.hasSession(agent.id)) {
      void seedDefault(agent.id, agent)
        .then(() => syncGate(agent))
        // 写默认值失败不该变成未处理的 promise 异常，更不该递归重试（会死循环）。
        .catch((error) => {
          console.error('[skill-manager] 写会话默认值失败，本轮先不建闸门：', error)
        })
      return
    }
    const existing = gated.get(agent.id)
    if (existing !== undefined && existing.agent !== agent) releaseAgent(existing.agent)
    if (isDefaultSession(state)) {
      if (gated.has(agent.id)) releaseAgent(agent)
      return
    }
    if (gated.has(agent.id)) {
      // 已经在接管：目录本身没变，只需要按最新状态重算遮蔽。
      // 这里不重读磁盘——状态变化可能来自「改另一个会话的开关」或分组增删，
      // 每次重读都要把 N 个遮蔽条目摘了再装回去，纯属浪费。
      gated.get(agent.id).guard.reconcile()
      return
    }
    try {
      const guard = createGuard({
        ctx,
        agent,
        sessionState: () => sessionState(agent.id),
    // 自动选技要「编组优先」，闸门得能读到当前分组表
    groups: () => store.groups(),
        onApply: (info) => {
          lastCatalog.set(agent.id, { ...info, at: Date.now() })
          // 每轮自动选择的决策都留一条日志。用户最怕的是「面板显示开着、模型却拿不到技能」，
          // 而这件事只有这一行能给出现场证据：命中哪些、少给了哪些。
          const picked = Array.isArray(info.autoPicked) ? info.autoPicked : []
          const total = typeof info.total === 'number' ? info.total : 0
          const hidden = Array.isArray(info.hidden) ? info.hidden.length : 0
          const visible = Math.max(total - hidden, 0)
          const mode = typeof info.mode === 'string' ? info.mode : 'auto'
          const session = String(agent.id).replace(/^session-/, '').slice(0, 8)
          const verdict =
            mode === 'off'
              ? '总开关关闭→全部遮蔽'
              : mode === 'manual'
                ? `手动模式→只给已启用 ${visible} 个`
                : picked.length > 0
                  ? `命中 ${picked.length} 个（${picked.join(',')}）`
                  : mode === 'auto-fallback'
                    ? '未命中→全部可见'
                    : '未命中→全部可见'
          logPlugin(`闸门 ${session} ${verdict}｜模型可见 ${visible}/${total}`)
        },
        seedCatalog: catalogCache.get(agent.id),
      })
      if (guard === null) return
      gated.set(agent.id, { agent, guard })
      const ready = guard.refresh()
      catalogCache.set(agent.id, guard.catalog())
      void ready.then(() => catalogCache.set(agent.id, guard.catalog()))
    } catch (error) {
      console.error('[skill-manager] 接管技能目录失败：', error)
    }
  }

  /** 状态变化后重新校正所有活着的 agent。 */
  function syncAll() {
    for (const agent of ctx.agents.list()) syncGate(agent)
  }

  ctx.effect(() => store.subscribe(syncAll), 'skill-manager: 状态订阅')

  ctx.on('agent/created', ({ agent }) => {
    registerRoute()
    syncGate(agent)
  })

  // 插件热重载后 `agents.list()` 有可能暂时为空，这时靠一次性 syncAll 会漏掉活着的
  // agent。挂一个全局的领取钩子做惰性补挂：真有消息进来时一定能把闸门建起来。
  // 顺带再试一次界面路由：有消息进来意味着应用已经跑起来了，服务肯定在了。
  ctx.on('agent/inbox/claimed', ({ agent }) => {
    registerRoute()
    syncGate(agent)
  })

  ctx.effect(
    () => () => {
      for (const entry of gated.values()) {
        try {
          entry.guard.dispose()
        } catch {
          // 卸载时尽力而为。
        }
      }
      gated.clear()
      lastCatalog.clear()
      catalogCache.clear()
    },
    'skill-manager: 闸门清理',
  )

  // 会话重开 / 清空 / 压缩会销毁 agent，同 id 再造一个新的。不在这里放掉旧闸门，
  // 新 agent 就会被「已经接管」挡在门外，开关静默失效。
  ctx.on('agent/disposed', ({ agent }) => {
    releaseAgent(agent)
  })

  /**
   * 解析请求里的 sessionId 对应的 agent。拿不到 agent 时退回全局视图
   * （设置页没有会话，只需要知道装了哪些技能、有哪些分组）。
   * @param {unknown} sessionId - 请求里的会话 id。
   * @returns {{ agent: object | undefined, sessionId: string | undefined }} 目标。
   */
  function resolveTarget(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return { agent: undefined, sessionId: undefined }
    }
    return { agent: ctx.agents.get(sessionId), sessionId }
  }

  /**
   * 当前视图下的技能摘要。有 agent 用 agent 的作用域，没有就用全局视图 +
   * 默认工作目录（`cwd` 会影响项目级技能的发现）。
   * @param {object | undefined} agent - 目标 agent。
   * @returns {Promise<Array<object>>} `SkillSummary[]`。
   */
  /**
   * 界面用的技能清单。
   *
   * 有闸门时走闸门的「干净读取」：先把遮蔽条目摘掉、读真实目录、再恢复，
   * 这样被关掉的技能在界面里仍然是一条正常条目（带描述、能看正文），而不是
   * 一条空壳。没闸门时（会话处于默认状态、插件不接管）直接按 agent 作用域读。
   *
   * @param {object | undefined} agent - 目标 agent（决定 cwd，影响工程级技能）。
   * @returns {Promise<Array<object>>} `SkillSummary[]`。
   */
  async function listSkills(agent) {
    if (agent !== undefined) {
      const entry = gated.get(agent.id)
      if (entry !== undefined) return entry.guard.list()
    }
    const cwd = agent === undefined
      ? ctx.workingDirectory.defaultDirectory
      : await ctx.workingDirectory.ensure(agent)
    const snapshot = await ctx.skills.snapshot(agent === undefined ? { cwd } : { cwd, scope: agent })
    return snapshot.skills
  }

  /**
   * 读一个技能的正文。
   * @param {object | undefined} agent - 目标 agent。
   * @param {string} name - 技能名。
   * @returns {Promise<object | undefined>} 技能定义。
   */
  async function readSkill(agent, name) {
    if (agent !== undefined) {
      const entry = gated.get(agent.id)
      if (entry !== undefined) return entry.guard.read(name)
    }
    const cwd = agent === undefined
      ? ctx.workingDirectory.defaultDirectory
      : await ctx.workingDirectory.ensure(agent)
    return ctx.skills.get(name, agent === undefined ? { cwd } : { cwd, scope: agent })
  }

  /**
   * 把分组成员同步到会话状态：整体启用或整体禁用。
   * @param {string} sessionId - 会话 id。
   * @param {{ skills: string[] }} group - 分组。
   * @param {boolean} enabled - 目标状态。
   * @returns {Promise<object>} 新会话状态。
   */
  async function applyGroup(sessionId, group, enabled) {
    return store.setSkillsEnabled(sessionId, group.skills, enabled)
  }

  /**
   * 第一次进这个会话时，把默认状态写成「一个都不启用」。
   *
   * 用户明确要求的默认值：0-N —— 技能得自己一个个点开，或者打开「自动选择技能」。
   * 只写一次；之后用户的每次点击都会覆盖它。
   * @param {string | undefined} sessionId - 会话 id。
   * @param {object | undefined} agent - agent 实例。
   * @returns {Promise<void>}
   */
  async function seedDefault(sessionId, agent) {
    if (sessionId === undefined || store.hasSession(sessionId)) return
    // agent 还没就绪时不要写默认值：这时 `listSkills(undefined)` 走的是 cwd
    // 兜底目录（只有 7 个自带技能），写进去的「全关」名单是残缺的。
    // 等 agent/created 或下一次请求再种，那时目录才是完整的。
    if (agent === undefined || typeof agent.id !== 'string') return
    const all = await listSkills(agent)
    // 默认：手动一个都不启用（全部进停用名单），自动选择打开。
    // 自动模式不读 disabled（自动结果优先），所以「全关」不会让自动挑不到东西；
    // 而手动模式下列表会如实显示 0/N，和「默认不选」这个说法一致。
    await store.setSession(sessionId, {
      master: true,
      auto: true,
      disabled: all.map((skill) => skill.name),
    })
  }

  /**
   * 删除一个「自己的」技能：把它的目录整个删掉。
   *
   * 这是不可恢复的破坏性操作，所以每一层都卡死：
   * - 官方/自带技能的路径在 DSH 安装目录或装包里，直接拒绝（删了得重装 DSH）；
   * - 只允许删 `<DSH_HOME>/skills/<名字>` 这一层的目录，别的一律不碰，
   *   避免把工程目录里的技能（那属于你的仓库）误删；
   * - 目录里必须有 SKILL.md，防止 skill.path 指到别的地方时误删。
   *
   * @param {object | undefined} agent - 目标 agent。
   * @param {string} name - 技能名。
   * @returns {Promise<{ name: string, removed: string }>} 被删掉的目录。
   */
  async function deleteSkillDir(agent, name) {
    const skills = await listSkills(agent)
    const skill = skills.find((row) => row.name === name)
    if (skill === undefined) throw new Error(`技能不存在：${name}`)
    if (skill.official === true) throw new Error(`「${name}」是官方自带技能，不能删除`)
    const file = typeof skill.path === 'string' ? skill.path : ''
    if (file.length === 0) throw new Error(`「${name}」没有可删除的本地文件`)
    const dir = dirname(file)
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const root = join(home, 'skills')
    if (dirname(dir) !== root) {
      throw new Error(`「${name}」不在 ${root} 下（来源：${skill.source ?? '未知'}），这里不删`)
    }
    if (!existsSync(join(dir, 'SKILL.md'))) throw new Error(`「${name}」目录里没有 SKILL.md，拒绝删除`)
    rmSync(dir, { recursive: true, force: true })
    logPlugin(`已删除技能目录：${dir}`)
    return { name, removed: dir }
  }

  /**
   * 处理一次 API 调用。
   * @param {{ action?: unknown, sessionId?: unknown }} body - 请求体。
   * @returns {Promise<unknown>} 响应数据。
   */
  async function dispatch(body) {
    const action = typeof body.action === 'string' ? body.action : ''
    // 插件刚启用时状态文件可能还在读。先等它落地再取实时状态——否则界面会拿到
    // 一份「全是默认值」的假状态，紧接着又把这份假状态写回去，把真实配置盖掉。
    // 第一次几百微秒，之后 load() 直接返回。
    await store.load()
    const { agent, sessionId } = resolveTarget(body.sessionId)
    // 新会话先落默认值（全关），否则第一次打开面板会显示成全部启用。
    // 这一步失败绝不能连累读数：面板照常返回，只是这一轮默认值没落地。
    try {
      await seedDefault(sessionId, agent)
    } catch (error) {
      console.error('[skill-manager] 写默认值失败（继续处理请求）：', error)
    }
    const liveState = sessionId === undefined ? { master: true, auto: false, disabled: [] } : store.session(sessionId)

    switch (action) {
      case 'state': {
        const skills = await listSkills(agent)
        const rows = skills.map((skill) =>
          projectSkill(skill, { master: liveState.master, disabled: new Set(liveState.disabled) }),
        )
        // 每轮固定烧在目录上的量：只算模型真能看到的那部分
        const visible = rows.filter((row) => row.enabled && row.modelInvocable)
        return {
          sessionId: sessionId ?? null,
          live: agent !== undefined,
          master: liveState.master,
          auto: liveState.auto,
          disabled: liveState.disabled,
          gated: sessionId !== undefined && gated.has(sessionId),
          revision: store.revision,
          lastCatalog: sessionId === undefined ? null : lastCatalog.get(sessionId) ?? null,
          groups: store.groups(),
          tokens: {
            visible: visible.reduce((sum, row) => sum + row.tokens, 0),
            all: rows.reduce((sum, row) => sum + row.tokens, 0),
            visibleCount: visible.length,
          },
          skills: rows,
        }
      }
      case 'read': {
        const skillName = typeof body.name === 'string' ? body.name : ''
        if (skillName.length === 0) throw new Error('缺少技能名')
        // 走干净读取：被关掉的技能在界面里也要能看正文，
        // 否则「关掉但是想看看它写了什么」这个最常见的用法就断了。
        const skill = await readSkill(agent, skillName)
        if (skill === undefined) throw new Error(`技能不存在或已卸载：${skillName}`)
        return {
          name: skill.name,
          description: skill.description,
          source: skill.source,
          provider: skill.provider,
          path: skill.path ?? null,
          resourceBase: skill.resourceBase ?? null,
          content: skill.content,
        }
      }
      case 'setMaster': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        const next = await store.setSession(sessionId, { master: body.value === true })
        return { session: next }
      }
      case 'setAuto': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        const next = await store.setSession(sessionId, { auto: body.value === true })
        return { session: next }
      }
      case 'setSkills': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        const names = Array.isArray(body.names) ? body.names.filter((item) => typeof item === 'string') : []
        if (names.length === 0) throw new Error('缺少技能名')
        const next = await store.setSkillsEnabled(sessionId, names, body.enabled === true)
        return { session: next }
      }
      case 'deleteSkill': {
        // 不可恢复：删的是磁盘上的技能目录，客户端会二次确认。
        if (agent === undefined) throw new Error('当前会话还没有就绪的 agent，稍后再试')
        if (typeof body.name !== 'string' || body.name.length === 0) throw new Error('缺少技能名')
        const deleted = await deleteSkillDir(agent, body.name)
        const startedAt = Date.now()
        // 顺序很讲究：
        // 1) 先放掉闸门——只是注销已有遮挡条目，很便宜，但能保证紧接着的读盘是新的；
        // 2) 顺手把删完之后的列表直接算给界面，省掉客户端再拉一次全量状态；
        // 3) 重建闸门（重注册遮挡条目）才是贵的，放到响应之后做。
        // 删掉一个技能不会让已有遮挡失效，所以第 3 步晚一点没关系。
        releaseAgent(agent)
        catalogCache.delete(agent.id)
        lastCatalog.delete(agent.id)
        const current = sessionId === undefined
          ? { master: true, auto: false, disabled: [] }
          : store.session(sessionId)
        const rows = (await listSkills(agent)).map((row) =>
          projectSkill(row, { master: current.master, disabled: new Set(current.disabled) }),
        )
        queueMicrotask(() => {
          try {
            const rebuildAt = Date.now()
            syncGate(agent)
            logPlugin(`删除 ${body.name} 后重建闸门用时 ${Date.now() - rebuildAt}ms`)
          } catch (error) {
            logPlugin(`删除后重建闸门失败：${String(error?.message ?? error)}`)
          }
        })
        logPlugin(`删除 ${body.name} 响应内用时 ${Date.now() - startedAt}ms，返回 ${rows.length} 行`)
        return { deleted, skills: rows }
      }
      case 'enableOnly': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        const all = await listSkills(agent)
        const keep = new Set(Array.isArray(body.names) ? body.names : [])
        const disabled = all.map((skill) => skill.name).filter((skillName) => !keep.has(skillName))
        const next = await store.setSession(sessionId, { disabled })
        return { session: next }
      }
      case 'enableAll': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        const next = await store.setSession(sessionId, { master: true, auto: false, disabled: [] })
        // 手动全开时关掉自动：两套机制同时开会互相打架
        return { session: next }
      }
      case 'disableAll': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        const all = await listSkills(agent)
        // 清空就是「真的一个都不要」：连自动选择一起关掉，否则自动仍会挑出技能
        const next = await store.setSession(sessionId, {
          master: true,
          auto: false,
          disabled: all.map((skill) => skill.name),
        })
        return { session: next }
      }
      case 'reset': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        // 恢复默认 = 回到出厂值：手动全关 + 自动选择开着。
        const all = await listSkills(agent)
        const next = await store.setSession(sessionId, {
          master: true,
          auto: true,
          disabled: all.map((skill) => skill.name),
        })
        return { session: next }
      }
      case 'saveGroup': {
        const group = await store.upsertGroup({
          id: typeof body.id === 'string' ? body.id : undefined,
          name: typeof body.name === 'string' ? body.name : '',
          skills: Array.isArray(body.skills) ? body.skills : [],
        })
        return { group, groups: store.groups() }
      }
      case 'deleteGroup': {
        const removed = await store.removeGroup(typeof body.id === 'string' ? body.id : '')
        return { removed, groups: store.groups() }
      }
      case 'groupMember': {
        const group = await store.setGroupMember(
          typeof body.id === 'string' ? body.id : '',
          typeof body.skill === 'string' ? body.skill : '',
          body.member === true,
        )
        return { group, groups: store.groups() }
      }
      case 'applyGroup': {
        if (sessionId === undefined) throw new Error('这个操作需要会话')
        const group = store.groups().find((item) => item.id === body.id)
        if (group === undefined) throw new Error('分组不存在')
        const next = await applyGroup(sessionId, group, body.enabled === true)
        return { session: next, group }
      }
      default:
        throw new Error(`未知操作：${action}`)
    }
  }

  // 插件刚被启用时 agent 注册表可能还没填好，一次 syncAll 会漏掉已经活着的会话。
  // 先立刻试一次，再补一次延迟校正；之后还有 agent/created 与 agent/inbox/claimed
  // 两条惰性兜底，所以这里不需要轮询。
  // 全部错误都兜住：启动同步失败只该让「闸门暂时没接管」，不该让插件整体挂掉。
  void Promise.resolve()
    .then(() => store.load())
    .then(() => {
      syncAll()
      ctx.effect(
        () => {
          const timer = setTimeout(() => {
            try {
              syncAll()
            } catch (error) {
              console.error('[skill-manager] 延迟校正失败：', error)
            }
          }, 1200)
          return () => clearTimeout(timer)
        },
        'skill-manager: 延迟校正',
      )
    })
    .catch((error) => {
      console.error('[skill-manager] 启动同步失败（闸门可能暂时未接管，界面仍可用）：', error)
    })
}
