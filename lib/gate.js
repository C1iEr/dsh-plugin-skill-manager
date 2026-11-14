/**
 * Skill Manager —— 会话级闸门。
 *
 * ## 为什么用「同名技能遮蔽」而不是接管 `skill` 工具
 *
 * 第一版试过另一种做法：在 agent 作用域注册一份自己的 `skill` 工具，把自带的同名
 * 工具顶掉，再自己生成技能目录。这条路的硬伤是：`@deepseek-ai/dsh-tool-skill` 在
 * 发现「解析到的不是自己的工具」时确实不生成新目录，**但它仍然会跑完替换逻辑**，
 * 把已有目录消息换成本地的空目录——于是我们自己发的目录每次都被它盖成空。
 * 换句话说，这个接缝只够「关掉技能」，不够「接管技能」。
 *
 * 现在走的机制是技能注册表自己的分层规则：
 *
 *   - `ctx.skills.register()` 把条目登记进**调用上下文所在的层**；
 *   - agent 作用域的层比 host / preset 层更靠近观测点，**同名条目直接胜出**；
 *   - `invocation: { modelInvocable: false, userInvocable: false }` 的条目不会进
 *     模型目录、不会被 `skill` 工具加载、也不会被 `/技能名` 手势命中。
 *
 * 于是「关闭某些技能」这件事就退回给 DSH 自己的目录生成逻辑：它照常重算、照常
 * 发替换消息、照常维护指纹，只是算出来的清单里少了被遮蔽的那几个。本插件不需要
 * 复刻任何渲染、摘要或历史逻辑。
 *
 * ## 时序
 *
 * 目录是在 `agent/pre-step` 里现算的，所以遮蔽必须在 pre-step 之前落到注册表上。
 * 钩子选 `agent/inbox/claimed`：用户消息被本轮领取时同步触发，早于 pre-step，
 * 而且事件里直接带着用户文本——自动选技正好需要它。整条路径是同步的：只读写
 * 内存里的目录缓存 + 注册表，不做 I/O。
 *
 * ## 读目录为什么要「先摘掉自己」
 *
 * 遮蔽条目会顶掉同名真实技能，所以带着它读出来的目录是被自己污染过的：被关掉的
 * 技能只剩一条空壳。界面和刷新都需要真实内容，于是 `withCleanRead` 先撤掉全部
 * 遮蔽、读一次、再按缓存恢复。
 *
 * ## 不接管的部分
 *
 * `/技能名` 手势：用户亲手敲的调用由上游处理；被遮蔽的技能在上游那条路径上也拿
 * 不到（`get()` 返回的是遮蔽条目），所以这个边界是自然闭合的。
 *
 * @module skill-manager/lib/gate
 */

import { selectRelevant } from './auto.js'
import { pickGroups } from './group-match.js'

/** 遮蔽条目的描述。会出现在 `list()` 里，所以写清楚是谁干的。 */
const TOMBSTONE_DESCRIPTION = 'Hidden in this session by Skill Manager.'

/**
 * 读一次完整的技能目录（**按 agent 作用域**）。
 *
 * 为什么不用不带 scope 的视图：实测那份视图只看得见 7 个技能——用户装在
 * `$DSH_HOME/skills` 下的那一批属于 preset 层，只有带 scope 的合并才看得见。
 *
 * @param {object} ctx - 插件上下文。
 * @param {object} agent - 目标 agent。
 * @returns {Promise<{ skills: Array<object>, complete: boolean }>} 目录快照。
 */
export async function loadSkillCatalog(ctx, agent) {
  const snapshot = await ctx.skills.snapshot({
    cwd: await ctx.workingDirectory.ensure(agent),
    scope: agent,
  })
  return { skills: snapshot.skills, complete: snapshot.complete !== false }
}

/**
 * 从一条消息里取出可参与自动选技的文本。
 * @param {{ source?: { kind?: string }, content?: Array<{ type: string, text?: string }> }} message - 用户消息。
 * @returns {string} 文本。
 */
function textOf(message) {
  if (message === null || typeof message !== 'object') return ''
  if (message.source?.kind !== 'user') return ''
  if (!Array.isArray(message.content)) return ''
  const parts = []
  for (const block of message.content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 给一个 agent 装上会话闸门。
 *
 * @param {object} params - 参数。
 * @param {object} ctx - 插件上下文。
 * @param {object} agent - 目标 agent。
 * @param {() => { master: boolean, auto: boolean, disabled: string[] }} params.sessionState - 读取会话状态。
 * @param {(info: { hidden: string[], autoPicked: string[], total: number }) => void} [params.onApply] - 每次重算后的回调，供界面展示。
 * @param {{ skills: Array<object>, complete: boolean } | undefined} [params.seedCatalog] - 上一次读到的目录，用来让新闸门立刻生效。
 * @returns {{ dispose: () => void, refresh: () => Promise<void>, list: () => Promise<Array<object>>, read: (name: string) => Promise<object | undefined>, catalog: () => { skills: Array<object>, complete: boolean } } | null} 闸门句柄；该 agent 拿不到技能服务时返回 null。
 */
export function createGuard({ ctx, agent, sessionState, groups, onApply, seedCatalog }) {
  const skills = agent.ctx.get('skills')
  if (skills === undefined) return null

  /** 最近一次读到的完整目录。 */
  const catalog = { skills: [], complete: false }
  /** 当前生效的遮蔽条目：技能名 → 注销函数。 */
  const tombstones = new Map()
  /** 最近一条用户消息的文本，自动选技的输入。 */
  let lastText = ''
  /** 是否已注销。注销之后既不再摘遮蔽，也不许把遮蔽装回去。 */
  let disposed = false
  /** 干净读取的嵌套深度：只有最外层恢复一次遮蔽。 */
  let cleanDepth = 0
  /** 干净读取的串行队列：两次「摘遮蔽 → 读 → 装回」不重叠。 */
  let cleanQueue = Promise.resolve()
  /** 上一次读到真实目录的时间，用来给界面读取做短缓存。 */
  let lastCleanAt = 0

  /**
   * 造一条遮蔽条目。`source` 必填（`get()` 会校验），两个 invocation 标记都要
   * 是 false：模型目录看 modelInvocable，`/` 候选列表看 userInvocable。
   * @param {string} name - 技能名。
   * @returns {() => void} 注销函数。
   */
  function tombstoneFor(name) {
    return skills.register({
      name,
      description: TOMBSTONE_DESCRIPTION,
      content: '',
      source: 'runtime',
      provider: 'skill-manager',
      invocation: { modelInvocable: false, userInvocable: false },
    })
  }

  /**
   * 把遮蔽集合调成 `hide`：多退少补。
   * @param {Set<string>} hide - 需要被遮蔽的技能名。
   * @returns {void}
   */
  function applyHide(hide) {
    for (const [name, dispose] of [...tombstones]) {
      if (hide.has(name)) continue
      try {
        dispose()
      } catch {
        // 注销失败说明它已经没了，忽略即可。
      }
      tombstones.delete(name)
    }
    for (const name of hide) {
      if (tombstones.has(name)) continue
      try {
        tombstones.set(name, tombstoneFor(name))
      } catch (error) {
        // 非法名字、或同名已被别人抢先注册：跳过这一条，不影响其余技能。
        console.error('[skill-manager] 遮蔽技能失败：', name, error)
      }
    }
  }

  /**
   * 算出当前应该遮蔽哪些技能。
   * @param {string} text - 自动选技的输入。
   * @returns {{ hide: Set<string>, autoPicked: string[] }} 结果。
   */
  function computeHidden(text) {
    const session = sessionState()
    const all = catalog.skills
    if (session.master === false) {
      return { hide: new Set(all.map((skill) => skill.name)), autoPicked: [] }
    }
    const disabled = new Set(session.disabled)
    /** @type {Set<string>} */
    const hide = new Set()

    // 手动模式：以用户勾的为准。
    if (session.auto !== true) {
      for (const skill of all) if (disabled.has(skill.name)) hide.add(skill.name)
      return { hide, autoPicked: [] }
    }

    // 自动模式：**自动的结果是第一优先级**。
    // 手动的开关、已经启用的编组都不决定"能选什么"——它们只是偏好输入。
    // 否则会出现"因为我开了编程组，所以写文章时也只能拿到编程技能"这种怪事。
    const eligible = all.filter((skill) => skill.invocation !== undefined && skill.invocation.modelInvocable)

    // 已经整组启用的编组：匹配时给一点加权（能打破平局，但压不过明显更贴题的那一组）
    const engaged = new Set(
      groups()
        .filter((group) => group.skills.length > 0 && group.skills.every((name) => !disabled.has(name)))
        .map((group) => group.name),
    )

    const matchedGroups = pickGroups(groups(), all, text, engaged)
    if (matchedGroups.length > 0) {
      // 跨活儿的任务会命中两个组：技能并集，去重后一起给
      const wanted = new Set(matchedGroups.flatMap((group) => group.skills))
      const keep = new Set([...wanted].filter((name) => eligible.some((skill) => skill.name === name)))
      if (keep.size >= 1) {
        for (const skill of eligible) if (!keep.has(skill.name)) hide.add(skill.name)
        return {
          hide,
          autoPicked: [...keep],
          group: matchedGroups.map((group) => group.name).join(' + '),
        }
      }
    }
    const picked = selectRelevant(eligible, text)
    if (picked.fallback) return { hide, autoPicked: [] }
    const keep = new Set(picked.matched)
    for (const skill of eligible) if (!keep.has(skill.name)) hide.add(skill.name)
    return { hide, autoPicked: picked.matched }
  }

  /**
   * 重算并落到注册表上。目录还没读到内容时什么都不做——宁可这一轮多列几个技能，
   * 也不能因为缓存没热就误遮蔽。
   * @returns {void}
   */
  function reconcile() {
    if (catalog.complete !== true) return
    const { hide, autoPicked } = computeHidden(lastText)
    applyHide(hide)
    if (onApply !== undefined) {
      onApply({ hidden: [...tombstones.keys()], autoPicked, total: catalog.skills.length })
    }
  }

  /** 用户消息被本轮领取：记下文本并立刻同步遮蔽，赶在 pre-step 之前。 */
  const claimDisposer = agent.ctx.on('agent/inbox/claimed', ({ message }) => {
    const text = textOf(message)
    if (text.length > 0) lastText = text
    reconcile()
  })

  // 有上一次读到的目录就直接用上：刚建好的闸门不必等一次异步读取就已经能挡住
  // 该挡的技能。插件热重载后第一轮就落在这条路径上。
  if (seedCatalog !== undefined && seedCatalog.complete === true) {
    catalog.skills = seedCatalog.skills
    catalog.complete = true
    reconcile()
  }

  /**
   * 临时摘掉全部遮蔽条目、跑一段读取、再按缓存恢复。
   *
   * 遮蔽条目会顶掉同名真实技能，所以带着它读出来的目录是「被自己污染过的」：
   * 被关掉的技能只剩一条空壳。界面读取需要真实内容，于是在这段窗口里先撤遮蔽。
   *
   * 窗口里有两个必须处理的坑，否则会出现「界面说关了、模型还能用」：
   *   - **不能重叠**：两次读取交错时，后一次会在前一次恢复遮蔽之后才开始读，
   *     于是把刚装回的遮蔽条目当成真技能读进目录。用队列串起来。
   *   - **注销后不许再装**：插件卸载 / 「恢复默认」时闸门已 dispose，此时在途
   *     读取的收尾里若还去 reconcile，会把遮蔽注册回一个没人持有句柄的闸门。
   *
   * `read()` 不走这里——它只摘目标那一项，窗口小得多。
   *
   * @template T
   * @param {() => Promise<T>} fn - 读取动作。
   * @returns {Promise<T>} 读取结果。
   */
  function withCleanRead(fn) {
    const run = async () => {
      if (disposed) return fn()
      cleanDepth += 1
      for (const dispose of [...tombstones.values()]) {
        try {
          dispose()
        } catch {
          // 已被别处注销，忽略。
        }
      }
      tombstones.clear()
      try {
        return await fn()
      } finally {
        cleanDepth -= 1
        if (!disposed && cleanDepth === 0) reconcile()
      }
    }
    const next = cleanQueue.then(run, run)
    cleanQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    /**
     * 重新读一遍技能目录并立刻重算。由界面操作、状态变化、agent 建立时调用。
     * @returns {Promise<void>} 读完后 resolve。
     */
    async refresh() {
      try {
        const next = await withCleanRead(() => loadSkillCatalog(ctx, agent))
        catalog.skills = next.skills
        catalog.complete = next.complete
        lastCleanAt = Date.now()
        reconcile()
      } catch (error) {
        console.error('[skill-manager] 读取技能目录失败：', error)
      }
    },
    /**
     * 界面用的干净目录：真实条目，启用状态由调用方另外按会话状态叠加。
     *
     * 界面每打开一次面板都会问一遍，所以做 5 秒短缓存：目录不会秒变，
     * 而每次干净读取都是 2×N 次注册/注销（N = 关闭的技能数），不值当。
     * @returns {Promise<Array<object>>} `SkillSummary[]`。
     */
    async list() {
      if (catalog.complete === true && Date.now() - lastCleanAt < 5000) return catalog.skills
      const next = await withCleanRead(() => loadSkillCatalog(ctx, agent))
      catalog.skills = next.skills
      catalog.complete = next.complete
      lastCleanAt = Date.now()
      reconcile()
      return catalog.skills
    },
    /**
     * 界面用的干净读取：即使这个技能在本会话被关掉，也要能读到正文。
     *
     * 只摘掉这一项的遮蔽条目，而不是全部：窗口从「所有被关技能」缩到「一个」，
     * 模型那一侧几乎不可能在这一瞬刚好算目录。
     * @param {string} name - 技能名。
     * @returns {Promise<object | undefined>} 技能定义。
     */
    async read(name) {
      const cwd = await ctx.workingDirectory.ensure(agent)
      const tomb = tombstones.get(name)
      if (tomb === undefined) return ctx.skills.get(name, { cwd, scope: agent })
      tombstones.delete(name)
      try {
        tomb()
      } catch {
        // 已被别处注销，忽略。
      }
      try {
        return await ctx.skills.get(name, { cwd, scope: agent })
      } finally {
        if (!disposed && !tombstones.has(name)) tombstones.set(name, tombstoneFor(name))
      }
    },
    /** 状态变化时只需要按现有目录重算遮蔽，不必重读磁盘。 @returns {void} */
    reconcile() {
      reconcile()
    },
    /** @returns {{ skills: Array<object>, complete: boolean }} 当前目录缓存。 */
    catalog() {
      return catalog
    },
    dispose() {
      disposed = true
      try {
        claimDisposer()
      } catch {
        // 摘除失败不影响其它清理。
      }
      for (const [name, dispose] of [...tombstones]) {
        try {
          dispose()
        } catch {
          // 同上。
        }
        tombstones.delete(name)
      }
    },
  }
}
