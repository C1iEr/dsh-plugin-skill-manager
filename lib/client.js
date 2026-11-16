/**
 * Skill Manager —— 浏览器半边。
 *
 * 三个界面，共用一份宿主状态：
 *
 *   1. **输入框工具条上的小胶囊**（`conversation.input.left`，紧挨「完全权限」）：
 *      点开/收起管理面板。位置与 DSH 自己的工具条控件齐平，不占聊天区。
 *   2. **输入框上方的管理面板**（`conversation.input.dock`）：展开时才有内容，
 *      收起时整块不渲染，所以平时不占高度。
 *   3. **模型菜单里的两行开关**（`conversation.input.model.options`）：
 *      和自带的「启用智能体团队协作」同一位置、同一行样式、同一套开关尺寸。
 *
 * 所有状态都从宿主 `/api/skill-manager` 读写。浏览器不自己判断「模型看得到什么」——
 * 那个答案只有一个权威来源，在宿主那一侧。
 *
 * 依赖：只用 `require('react')`。不 require 任何 `@deepseek-ai/dsh-client-*`
 * 包（构建产物，换版本就可能变形状）。开关的标记与尺寸照抄自带 Switch 组件
 * （36×20 轨道、2px 内边距、16px 滑块、transform 位移、120ms ease），类名换成本插件的
 * `dsm-` 前缀；颜色、圆角、字号一律用主题 token，深浅色切换自动跟随。
 */

window.__ModuleLoader__.load({
  id: '@local/skill-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 宿主路由。浏览器侧必须用相对地址，否则会和在挂载前缀下打架。 */
    const API = 'api/skill-manager'

    /* ------------------------------------------------------------------ *
     * 文案
     * ------------------------------------------------------------------ */

    /** 当前界面语言是不是中文。 */
    function isChinese() {
      const lang = `${document.documentElement.lang || ''}${navigator.language || ''}`
      return /^zh/i.test(lang)
    }

    /** 中英两套文案。 */
    const TEXT = {
      zh: {
        name: 'Skill Manager',
        menuMaster: '启用技能目录',
        menuMasterAbout: '关闭后本会话不再向模型提供任何技能',
        menuAuto: '自动选择技能',
        menuAutoAbout: '每轮按你的输入挑选相关技能',
        open: '打开技能管理',
        close: '收起',
        master: '启用技能目录',
        masterHint: '关闭后本会话的模型看不到也读不到任何技能',
        auto: '自动选择技能',
        autoHint: '按每轮输入挑选相关技能；没有命中时退回全部',
        autoPicked: '本轮命中',
        pickedNow: '本轮选中',
        notPicked: '未选中',
        autoListHint: '自动模式下由系统按需挑选；要逐个控制请先关掉「自动选择技能」',
        autoFallback: '本轮没有命中，已退回全部技能',
        autoSwitchLocked: '自动模式中，手动开关暂不可用',
        groups: '快捷分组',
        groupsEmpty: '把常一起用的技能收进一个组，点一下整组开关。',
        newGroup: '新建分组',
        search: '搜索技能名或描述',
        groupMode: '编组',
        groupModeDone: '完成',
        selected: (n) => `已选 ${n} 项`,
        addToGroup: '加入分组',
        create: '建组',
        cancel: '取消',
        reset: '恢复默认',
        empty: '没有匹配的技能',
        noSkills: '没有已安装的技能',
        back: '返回列表',
        source: '来源',
        path: '路径',
        loading: '读取中…',
        failed: '操作失败：',
        readFailed: '读取失败：',
        retry: '重试',
        autoRetrying: '插件可能还在启动，正在自动重试…（成功后会自动恢复，不用手动点）',
        tokensLabel: '目录占用',
        tok: 'tok',
        official: '官方',
        clearAll: '清空',
        enableAll: '全部启用',
        clearHint: '把当前启用的技能全部停用（不删除文件）',
        enableAllHint: '启用全部技能',
        autoOn: '自动',
        thisRound: '本轮',
        needSelect: '先选中技能，或者输入一个分组名',
        groupNamePlaceholder: '分组名，例如「编程」',
        deleteGroup: '删除分组',
        confirmDelete: '确认删除?',
        confirmDeleteHint: '再点一次确认删除；3 秒后自动取消',
        missingMembers: (n) => `${n} 个成员已不在目录中`,
        toggleAll: '启用整组',
        toggleNone: '关闭整组',
        on: '启用',
        off: '关闭',
        allOff: '已全部关闭',
        count: (on, total) => `${on}/${total}`,
      },
      en: {
        name: 'Skill Manager',
        menuMaster: 'Enable skill catalog',
        menuMasterAbout: 'When off, this session sees no skills at all',
        menuAuto: 'Auto-select skills',
        menuAutoAbout: 'Shortlist skills from each message you send',
        open: 'Open skill manager',
        close: 'Collapse',
        master: 'Enable skill catalog',
        masterHint: 'When off, the model in this session cannot see or load any skill',
        auto: 'Auto-select skills',
        autoHint: 'Shortlist skills that match each message; fall back to all when nothing matches',
        autoPicked: 'Matched',
        pickedNow: 'picked',
        notPicked: 'not picked',
        autoListHint: 'In auto mode the system picks each round; turn "Auto-select skills" off to control rows one by one',
        autoFallback: 'Nothing matched this round — showing every skill',
        autoSwitchLocked: 'Auto mode is on; this switch is unavailable',
        groups: 'Groups',
        groupsEmpty: 'Put skills you use together into a group and toggle them all at once.',
        newGroup: 'New group',
        search: 'Search skill name or description',
        groupMode: 'Group',
        groupModeDone: 'Done',
        selected: (n) => `${n} selected`,
        addToGroup: 'Add to group',
        create: 'Create',
        cancel: 'Cancel',
        reset: 'Reset to default',
        empty: 'No matching skills',
        noSkills: 'No installed skills',
        back: 'Back to list',
        source: 'Source',
        path: 'Path',
        loading: 'Loading…',
        failed: 'Failed: ',
        readFailed: 'Failed to load: ',
        retry: 'Retry',
        autoRetrying: 'The plugin may still be starting; retrying automatically - no action needed.',
        tokensLabel: 'Catalog size',
        tok: 'tok',
        official: 'official',
        clearAll: 'Clear',
        enableAll: 'Enable all',
        clearHint: 'Disable every enabled skill (files are not deleted)',
        enableAllHint: 'Enable every skill',
        needSelect: 'Select skills or type a group name first',
        groupNamePlaceholder: 'Group name, e.g. "coding"',
        deleteGroup: 'Delete group',
        confirmDelete: 'Confirm delete?',
        confirmDeleteHint: 'Click again to delete; cancelled after 3 seconds',
        missingMembers: (n) => `${n} member${n === 1 ? '' : 's'} no longer in the catalog`,
        toggleAll: 'Enable whole group',
        toggleNone: 'Disable whole group',
        on: 'on',
        off: 'off',
        allOff: 'All off',
        count: (on, total) => `${on}/${total}`,
      },
    }

    /** 取当前语言的文案表。 */
    function t() {
      return isChinese() ? TEXT.zh : TEXT.en
    }

    /* ------------------------------------------------------------------ *
     * 与宿主通信
     * ------------------------------------------------------------------ */

    /**
     * 调一次宿主。GET 用于读，POST 用于写。任何失败都收敛成 `{ ok: false, error }`。
     * @param {string} action - 操作名。
     * @param {object} [payload] - 附带参数。
     * @param {string} [sessionId] - 会话 id。
     * @returns {Promise<{ ok: boolean, data?: any, error?: string }>} 结果。
     */
    async function callHost(action, payload, sessionId) {
      try {
        const body = { action, ...(payload || {}) }
        if (typeof sessionId === 'string' && sessionId.length > 0) body.sessionId = sessionId
        const response =
          payload === undefined
            ? await fetch(`${API}?action=${encodeURIComponent(action)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}`)
            : await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              })
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
        const parsed = await response.json()
        if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'bad response' }
        return parsed.ok === true ? { ok: true, data: parsed.data } : { ok: false, error: String(parsed.error ?? 'unknown') }
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) }
      }
    }

    /* ------------------------------------------------------------------ *
     * 共享状态
     * ------------------------------------------------------------------ */

    /** sessionId → 最近一次拉到的状态。 */
    const cache = new Map()
    /** 订阅者（状态与展开状态共用一条通知通道）。 */
    const subscribers = new Set()
    /** sessionId → 正在进行的请求，避免重复拉。 */
    const inflight = new Map()
    /** sessionId → 已成功写入的序号。用来丢掉「写之前发出、写之后才回来」的过期读。 */
    const versions = new Map()
    /** sessionId → 自动重试已尝试的次数。 */
    const retries = new Map()
    /** sessionId → 已排队的自动重试计时器（同会话只留一个）。 */
    const retryTimers = new Map()
    /** 哪些会话的面板是展开的。刷新页面就回到收起，不属于持久数据。 */
    const openSessions = new Set()

    /**
     * 自动重试的退避节奏（毫秒）。
     *
     * 这是「每次重开 DSH 都要手动拉起一次」的客户端半边解法：应用刚启动时宿主的
     * 界面路由可能还没挂上（宿主那边也在等服务就绪），此刻失败一次就永久报错会让人
     * 以为插件坏了。这里自己退避重试，路由一出现就自动恢复，用户什么都不用做。
     */
    const RETRY_DELAYS = [700, 1200, 2000, 3000, 5000, 8000, 12000, 20000, 30000, 30000, 30000, 30000, 30000, 30000]

    /**
     * 取消一个会话的待重试。
     * @param {string} sessionId - 会话 id。
     * @returns {void}
     */
    function clearRetry(sessionId) {
      retries.delete(sessionId)
      const timer = retryTimers.get(sessionId)
      if (timer !== undefined) {
        clearTimeout(timer)
        retryTimers.delete(sessionId)
      }
    }

    /**
     * 排一次自动重试（同会话不叠加）。
     * @param {string} sessionId - 会话 id。
     * @returns {void}
     */
    function scheduleRetry(sessionId) {
      if (retryTimers.has(sessionId)) return
      const attempt = retries.get(sessionId) || 0
      if (attempt >= RETRY_DELAYS.length) return
      const delay = RETRY_DELAYS[attempt]
      const timer = setTimeout(() => {
        retryTimers.delete(sessionId)
        retries.set(sessionId, attempt + 1)
        void load(sessionId, true)
      }, delay)
      retryTimers.set(sessionId, timer)
    }

    /** 通知所有订阅者重绘。 */
    function notify() {
      for (const listener of [...subscribers]) {
        try {
          listener()
        } catch (error) {
          console.error('[skill-manager] 订阅者报错', error)
        }
      }
    }

    /**
     * 拉一次状态。
     *
     * 并发调用复用同一个请求，但**写之后必须强制重拉**：一次开关的 POST 之后紧跟
     * 一个在这个 POST 之前就发出的 GET，那个 GET 看到的是旧状态，回来晚了就会把
     * 新状态盖掉，开关表现为回弹。用版本号把过期读直接丢弃。
     *
     * @param {string} sessionId - 会话 id。
     * @param {boolean} [force] - 是否忽略在途请求、另起一次。
     * @returns {Promise<any | null>} 状态，或 null。
     */
    function load(sessionId, force = false) {
      const running = inflight.get(sessionId)
      if (force !== true && running !== undefined) return running
      const version = versions.get(sessionId) || 0
      const task = callHost('state', undefined, sessionId).then((result) => {
        if (inflight.get(sessionId) === task) inflight.delete(sessionId)
        // 期间发生过一次成功写入：这次读的结果已经过期，丢掉。
        if ((versions.get(sessionId) || 0) !== version) return null
        const previous = cache.get(sessionId)
        const base = previous !== null && typeof previous === 'object' ? previous : {}
        if (result.ok === true) {
          clearRetry(sessionId)
          cache.set(sessionId, result.data)
        } else {
          cache.set(sessionId, { ...base, error: result.error })
          // 失败不放弃：宿主可能只是还没把路由挂上（应用刚启动），自己退避重试。
          scheduleRetry(sessionId)
        }
        notify()
        return result.ok === true ? result.data : null
      })
      inflight.set(sessionId, task)
      return task
    }

    /**
     * 写一次，然后强制重拉状态。写失败时把错误挂到缓存上让界面显示。
     * @param {string} sessionId - 会话 id。
     * @param {string} action - 操作名。
     * @param {object} payload - 参数。
     * @returns {Promise<string | null>} 成功返回 null，失败返回错误串。
     */
    async function mutate(sessionId, action, payload) {
      const result = await callHost(action, payload, sessionId)
      if (result.ok === false) {
        const current = cache.get(sessionId)
        const base = current !== null && typeof current === 'object' ? current : {}
        cache.set(sessionId, { ...base, error: result.error })
        notify()
        return result.error
      }
      versions.set(sessionId, (versions.get(sessionId) || 0) + 1)
      await load(sessionId, true)
      return null
    }

    /** 订阅共享状态。 */
    function subscribeToStore(listener) {
      subscribers.add(listener)
      return () => {
        subscribers.delete(listener)
      }
    }

    /**
     * 面板开合。
     * @param {string} sessionId - 会话 id。
     * @param {boolean} open - 目标状态。
     * @returns {void}
     */
    function setOpen(sessionId, open) {
      if (open) openSessions.add(sessionId)
      else openSessions.delete(sessionId)
      notify()
    }

    /**
     * 组件用的状态钩子：挂载时拉一次，之后跟着缓存走。
     *
     * 缓存里要么是一份状态，要么是一条错误（拉取失败时写进去的），两种都算「有值」，
     * 但只有前者能拿去渲染。分开返回，免得界面在请求失败时一直停在「读取中」。
     *
     * @param {string} sessionId - 会话 id。
     * @returns {{ data: any, error: string | null }} 状态与错误。
     */
    function useSessionState(sessionId) {
      const snapshot = React.useSyncExternalStore(
        subscribeToStore,
        () => cache.get(sessionId),
        () => cache.get(sessionId),
      )
      React.useEffect(() => {
        if (sessionId) void load(sessionId)
      }, [sessionId])
      if (snapshot === undefined || snapshot === null) return { data: null, error: null, retrying: false }
      if (typeof snapshot.error === 'string') {
        return {
          data: null,
          error: snapshot.error,
          retrying: retryTimers.has(sessionId) || (retries.get(sessionId) || 0) > 0,
        }
      }
      return { data: snapshot, error: null, retrying: false }
    }

    /**
     * 订阅面板开合状态。
     * @param {string} sessionId - 会话 id。
     * @returns {boolean} 是否展开。
     */
    function useOpenState(sessionId) {
      return React.useSyncExternalStore(
        subscribeToStore,
        () => openSessions.has(sessionId),
        () => openSessions.has(sessionId),
      )
    }

    /* ------------------------------------------------------------------ *
     * 基础控件
     * ------------------------------------------------------------------ */

    /**
     * 滑动开关。尺寸与动效对齐 DSH 自带 Switch，所以手感和原生一致。
     * @param {{ checked: boolean, disabled?: boolean, ghost?: boolean, label: string, onToggle: (next: boolean) => void }} props - 属性。
     *   `ghost` 表示「只占位、不表达状态」：自动模式下这一列的开关不再代表本轮结果，
     *   所以压暗到几乎看不见，但位置和尺寸照旧，避免行高跳动。
     * @returns {any} React 元素。
     */
    function Switch(props) {
      const { checked, disabled, ghost, label, onToggle } = props
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked === true,
          'aria-label': label,
          title: label,
          disabled: disabled === true,
          className: ghost === true ? 'dsm-switch dsm-switch-ghost' : 'dsm-switch',
          onClick: (event) => {
            event.stopPropagation()
            if (disabled !== true) onToggle(checked !== true)
          },
        },
        h('span', { className: 'dsm-thumb' }),
      )
    }

    /**
     * 一行带说明的开关。整行可点——比只点开关好点中。
     * @param {{ checked: boolean, title: string, hint?: string, disabled?: boolean, onToggle: (next: boolean) => void }} props - 属性。
     * @returns {any} React 元素。
     */
    function SwitchRow(props) {
      const { checked, title, hint, disabled, onToggle } = props
      return h(
        'div',
        {
          className: 'dsm-row',
          role: 'presentation',
          onClick: () => {
            if (disabled !== true) onToggle(checked !== true)
          },
        },
        h(
          'span',
          { className: 'dsm-row-text' },
          h('span', { className: 'dsm-row-title' }, title),
          hint === undefined ? null : h('span', { className: 'dsm-row-hint' }, hint),
        ),
        h(Switch, { checked, disabled, label: title, onToggle }),
      )
    }

    /** 图标：三条横线 + 一个开关，和插件图标同构。 */
    function Glyph(props) {
      const size = props.size ?? 14
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 36 36',
          fill: 'none',
          'aria-hidden': true,
          className: props.className,
        },
        h('g', { stroke: 'currentColor', strokeWidth: 3.6, strokeLinecap: 'round', opacity: 0.85 },
          h('path', { d: 'M7 9h14' }),
          h('path', { d: 'M7 15h10' }),
          h('path', { d: 'M7 21h14' }),
        ),
        h('rect', { x: 6.5, y: 24.5, width: 23, height: 10.5, rx: 5.25, fill: 'currentColor' }),
        h('circle', { cx: 24.5, cy: 29.75, r: 3.6, fill: 'var(--dsw-alias-bg-l1, #fff)' }),
      )
    }

    /**
     * 自带技能的中文一句话。
     *
     * DSH 安装包里的技能（office / dsh-doc / j-space 等）描述是英文，改文件会被升级覆盖，
     * 所以在悬停提示这里补一层中文。用户没读之前至少知道它是干什么的。
     * 键是技能名；没命中的技能退回原文描述。
     */
    const GLOSS_ZH = {
      office: '读写 Office 文件（Word / Excel / PPT），也能查看 PDF；渲染、转换、重算之前要先加载它。',
      'office-docx': '创建、读取、编辑并校验 Word 文档（.docx）。',
      'office-pptx': '创建、读取、编辑并校验 PowerPoint 演示文稿（.pptx）。',
      'office-xlsx': '读取、创建、编辑并校验 Excel 工作簿（.xlsx），含公式计算。',
      'dsh-doc': '查 DeepSeek Harness 自己的资料：某项功能、设置、插件、工具或技能怎么用；也用于设计、审查、调试 DSH 插件与技能。',
      'j-space': '给模型建一块内部工作区：多步推理、规划、长任务、复杂调试，以及自我审计与置信度校准。',
      'diagnose-windows-sandbox-acl': 'Windows 上 DSH 沙箱读写被拒时用它：一条命令检查并修复路径上的 ACL 问题。',
    }

    /**
     * 来源标签的中文说法。
     *
     * `bundled`（随安装包发布）和 `runtime`（插件运行时注册）对用户是同一件事：
     * 「不是我装的」，所以都显示成「自带」；官方由宿主单独判定，会盖掉这一栏。
     */
    const SOURCE_ZH = {
      bundled: '自带',
      runtime: '自带',
      'user-dsh': '自装',
      'user-agents': '自装',
      'project-dsh': '工程',
      'project-agents': '工程',
    }

    /**
     * 悬停时显示的那段「简短中文介绍」。
     *
     * 优先用技能自己的描述（用户装的技能描述已经是中文）；描述是纯英文时用上面的
     * 中文补丁。最后按句读截断到 120 字左右，因为这是悬停提示，不是详情页。
     * @param {{ name: string, description?: string }} skill - 技能行。
     * @returns {string} 简介文本。
     */
    function briefOf(skill, limit = 120) {
      const description = String(skill.description ?? '').trim()
      const gloss = GLOSS_ZH[skill.name]
      const source = /[\u4e00-\u9fff]/.test(description) ? description : (gloss ?? description)
      if (source.length <= limit) return source
      const cut = source.slice(0, limit)
      const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'))
      return `${stop > 40 ? cut.slice(0, stop + 1) : cut}…`
    }

    /* ------------------------------------------------------------------ *
     * 界面 A：工具条上的胶囊
     * ------------------------------------------------------------------ */

    /**
     * 点面板和胶囊以外的地方就收起。
     * @param {{ current: HTMLElement | null }} anchorRef - 胶囊。
     * @param {{ current: HTMLElement | null }} panelRef - 面板。
     * @param {boolean} open - 是否展开。
     * @param {() => void} close - 收起。
     * @returns {void}
     */
    function useOutsideClose(anchorRef, panelRef, open, close) {
      React.useEffect(() => {
        if (open !== true) return undefined
        /** 鼠标按下时判断落点。 */
        function onDown(event) {
          const target = event.target
          if (!(target instanceof Node)) return
          if (panelRef.current !== null && panelRef.current.contains(target)) return
          if (anchorRef.current !== null && anchorRef.current.contains(target)) return
          close()
        }
        /** Esc 也能收起。 */
        function onKey(event) {
          if (event.key === 'Escape') close()
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [anchorRef, panelRef, open, close])
    }

    /**
     * 找出真正能看见的竖直范围。
     *
     * 只按 `window.innerHeight` 算是不够的：胶囊在输入框里，而输入框往上某一层
     * 容器可能带 `overflow:hidden`，浮层超出那一层的部分会被直接裁掉——这就是
     * 「新会话输入框在中页，面板朝上长，顶部的『启用技能目录』看不见也点不到」的
     * 真正原因。这里顺着祖先找到第一个会裁剪的容器，拿它的范围当可用空间。
     *
     * @param {HTMLElement} element - 锚点元素。
     * @returns {{ top: number, bottom: number }} 可见范围（视口坐标）。
     */
    function visibleRange(element) {
      let top = 0
      let bottom = window.innerHeight
      let node = element.parentElement
      let guard = 0
      // 累积所有会裁剪的祖先（hidden/clip/auto/scroll 都会挡住超出部分），
      // 取交集就是真正能看见的竖直范围。
      while (node !== null && guard < 40) {
        guard += 1
        const style = window.getComputedStyle(node)
        if (style.overflowY === 'visible' || style.overflowY === '') {
          node = node.parentElement
          continue
        }
        const rect = node.getBoundingClientRect()
        top = Math.max(top, rect.top)
        bottom = Math.min(bottom, rect.bottom)
        node = node.parentElement
      }
      if (!(bottom > top)) return { top: 0, bottom: window.innerHeight }
      return { top, bottom }
    }

    /**
     * 决定浮层朝上还是朝下开，以及最多能有多高。
     *
     * 一开始是固定朝上（`bottom:100%+10px`），在新会话里会出事：空会话的输入框
     * 停在页面垂直中间，面板朝上长会被容器裁掉，「启用技能目录」「恢复默认」
     * 这些**顶部**的东西就既看不见也点不到（面板是 `overflow:hidden`，滚不出来）。
     *
     * 现在按**可见空间**选方向：上方放得下就朝上（保持原来的手感），放不下就朝下；
     * 高度按可用空间收紧，多出来的内容由列表自己滚。
     *
     * @param {{ current: HTMLElement | null }} anchorRef - 胶囊按钮。
     * @param {boolean} open - 是否展开。
     * @returns {{ side: 'up' | 'down', style: object }} 方向与对应的行内样式。
     */
    function usePopoverPlacement(anchorRef, open) {
      const [box, setBox] = React.useState({ side: 'up', maxHeight: 0 })
      // 用 layout effect：首帧就按真实空间定尺寸，避免先以 560px 撑出去闪一下。
      React.useLayoutEffect(() => {
        if (open !== true) return undefined
        /** 量一次可用空间并更新方向。 */
        function measure() {
          const anchor = anchorRef.current
          if (anchor === null) return
          const rect = anchor.getBoundingClientRect()
          const range = visibleRange(anchor)
          const above = rect.top - range.top - 14
          const below = range.bottom - rect.bottom - 14
          // 上方能放下 300px 就朝上；否则谁的空位大就朝谁。
          const side = above >= 300 || above >= below ? 'up' : 'down'
          const room = side === 'up' ? above : below
          const maxHeight = Math.max(160, Math.min(560, Math.round(room - 8)))
          setBox({ side, maxHeight })
        }
        measure()
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        return () => {
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
        }
      }, [anchorRef, open])
      return {
        side: box.side,
        style: {
          // 还没量到（maxHeight 为 0）时先不设上限，避免 0 高度闪一下。
          maxHeight: box.maxHeight > 0 ? `${box.maxHeight}px` : undefined,
          bottom: box.side === 'up' ? 'calc(100% + 10px)' : 'auto',
          top: box.side === 'down' ? 'calc(100% + 10px)' : 'auto',
          '--dsm-max-height': box.maxHeight > 0 ? `${box.maxHeight}px` : undefined,
        },
      }
    }

    /**
     * 紧挨「完全权限」的小胶囊；展开时在它正上方浮出管理面板。
     *
     * 面板用「相对定位的包裹层 + 绝对定位的面板」贴着胶囊长出来，不自己算屏幕坐标：
     * 输入框所在的容器可能带 transform，按 viewport 坐标算出来的位置会被整体搬走，
     * 而相对定位的锚点是容器内部的坐标，不受这个影响。
     *
     * @param {{ sessionId: string }} props - 插槽属性。
     * @returns {any} React 元素。
     */
    function SkillPill(props) {
      const sessionId = props.sessionId
      const { data, error, retrying } = useSessionState(sessionId)
      const open = useOpenState(sessionId)
      const text = t()
      const styleTag = h('style', { key: 'dsm-style' }, CSS)
      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const skills = data !== null && Array.isArray(data.skills) ? data.skills : null
      const master = data === null ? true : data.master !== false
      const enabled = skills === null ? 0 : skills.filter((skill) => skill.enabled).length
      const total = skills === null ? 0 : skills.length
      const summary = master !== true ? text.allOff : skills === null ? '—' : text.count(enabled, total)
      const close = React.useCallback(() => setOpen(sessionId, false), [sessionId])
      const placement = usePopoverPlacement(anchorRef, open === true)
      useOutsideClose(anchorRef, panelRef, open === true, close)
      return h(
        React.Fragment,
        null,
        styleTag,
        h(
          'span',
          { className: 'dsm-anchor' },
          // 按钮在浮层**之前**：这样从胶囊按 Tab 能顺着走进面板，
          // 反过来（浮层先）键盘要绕整整一个工具条才能进去。
          h(
            'button',
            {
              ref: anchorRef,
              type: 'button',
              className: open === true ? 'dsm-pill dsm-pill-open' : 'dsm-pill',
              title: open === true ? text.close : text.open,
              'aria-label': `${text.name} ${summary}`,
              'aria-expanded': open === true,
              'aria-haspopup': 'dialog',
              onClick: () => {
                setOpen(sessionId, open !== true)
                if (open !== true) void load(sessionId)
              },
            },
            h(Glyph, { size: 13, className: master ? 'dsm-glyph dsm-glyph-on' : 'dsm-glyph' }),
            h('span', { className: 'dsm-pill-name' }, text.name),
            h('span', { className: master ? 'dsm-pill-count' : 'dsm-pill-count dsm-pill-count-off' }, summary),
          ),
          open === true
            ? h(
                'div',
                { className: 'dsm-popover', ref: panelRef, role: 'dialog', 'aria-label': text.name, style: placement.style },
                data === null || data.skills === undefined
                  ? h(
                      'div',
                      { className: 'dsm-panel' },
                      h(
                        'div',
                        { className: 'dsm-head' },
                        h('span', { className: 'dsm-head-title' }, text.name),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsm-ghost dsm-close',
                            onClick: close,
                            'aria-label': text.close,
                            title: text.close,
                          },
                          '✕',
                        ),
                      ),
                      // 读取失败要说清是「读失败」而不是「操作失败」，并留一个重试出口；
                      // 没有这个出口时界面会永远停在「读取中…」。
                      error === null
                        ? h('div', { className: 'dsm-quiet' }, text.loading)
                        : h(
                            React.Fragment,
                            null,
                            h('div', { className: 'dsm-error', role: 'alert' }, `${text.readFailed}${error}`),
                            retrying === true
                              ? h('div', { className: 'dsm-quiet' }, text.autoRetrying)
                              : null,
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dsm-button dsm-button-primary',
                                onClick: () => void load(sessionId, true),
                              },
                              text.retry,
                            ),
                          ),
                    )
                  : h(ManagerPanel, { sessionId, data, onClose: close }),
              )
            : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * 界面 B：模型菜单里的两行
     * ------------------------------------------------------------------ */

    /**
     * `conversation.input.model.options` 上的两行开关。
     * @param {{ sessionId: string }} props - 插槽属性。
     * @returns {any} React 元素。
     */
    function MenuOptions(props) {
      const sessionId = props.sessionId
      const { data, error } = useSessionState(sessionId)
      const text = t()
      const styleTag = h('style', { key: 'dsm-style' }, CSS)
      if (data === null || data.skills === undefined) {
        return h(React.Fragment, null, styleTag, h('div', { className: 'dsm-row dsm-row-quiet' }, text.loading))
      }
      const master = data.master !== false
      return h(
        React.Fragment,
        null,
        styleTag,
        h(SwitchRow, {
          title: text.menuMaster,
          hint: text.menuMasterAbout,
          checked: master,
          onToggle: (next) => void mutate(sessionId, 'setMaster', { value: next }),
        }),
        h(SwitchRow, {
          title: text.menuAuto,
          hint: text.menuAutoAbout,
          checked: data.auto === true,
          disabled: master !== true,
          onToggle: (next) => void mutate(sessionId, 'setAuto', { value: next }),
        }),
        error === null ? null : h('div', { className: 'dsm-error' }, `${text.failed}${error}`),
      )
    }

    /* ------------------------------------------------------------------ *
     * 界面 C：管理面板
     * ------------------------------------------------------------------ */

    /**
     * 技能详情：来源、路径、以及模型调用 `skill` 时拿到的同一份正文。
     * @param {{ sessionId: string, name: string, onBack: () => void }} props - 属性。
     * @returns {any} React 元素。
     */
    function DetailView(props) {
      const { sessionId, name, onBack } = props
      const text = t()
      const [detail, setDetail] = React.useState(null)
      const [error, setError] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        setDetail(null)
        setError(null)
        void callHost('read', { name }, sessionId).then((result) => {
          if (!alive) return
          if (result.ok === true) setDetail(result.data)
          else setError(String(result.error ?? ''))
        })
        return () => {
          alive = false
        }
      }, [sessionId, name])
      return h(
        'div',
        { className: 'dsm-detail' },
        h(
          'div',
          { className: 'dsm-detail-head' },
          h('button', { type: 'button', className: 'dsm-back', onClick: onBack }, `← ${text.back}`),
          h('span', { className: 'dsm-detail-title' }, name),
        ),
        detail === null
          ? h('div', { className: 'dsm-quiet' }, error === null ? text.loading : `${text.failed}${error}`)
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'dsm-meta' },
                h('span', { className: 'dsm-tag' }, `${text.source} · ${detail.source}`),
                detail.path === null
                  ? null
                  : h('span', { className: 'dsm-tag dsm-tag-path', title: detail.path }, `${text.path} · ${detail.path}`),
              ),
              h('pre', { className: 'dsm-content' }, detail.content),
            ),
      )
    }

    /**
     * 面板主体。
     * @param {{ sessionId: string, data: any, onClose: () => void }} props - 属性。
     * @returns {any} React 元素。
     */
    function ManagerPanel(props) {
      const { sessionId, data, onClose } = props
      const text = t()
      const [query, setQuery] = React.useState('')
      const [detailName, setDetailName] = React.useState(null)
      const [selecting, setSelecting] = React.useState(false)
      const [selected, setSelected] = React.useState(() => new Set())
      const [groupName, setGroupName] = React.useState('')
      const [targetGroup, setTargetGroup] = React.useState('')
      const [localError, setLocalError] = React.useState(null)
      /** 悬停提示：{ text, top, left, width } 或 null。坐标相对面板。 */
      const [hover, setHover] = React.useState(null)
      /**
       * 正在等第二次确认删除的组 id；null = 没有。
       * 只按 id 记，同一时间最多一个组处于确认态。
       */
      const [confirmGroup, setConfirmGroup] = React.useState(null)

      // 确认态只维持 3 秒：要么再点一次删掉，要么自己收回。
      React.useEffect(() => {
        if (confirmGroup === null) return undefined
        const timer = setTimeout(() => setConfirmGroup(null), 3000)
        return () => clearTimeout(timer)
      }, [confirmGroup])

      // 点别处（面板内其它地方、或面板外）也收回确认态，
      // 免得一个「确认删除?」在没人管的情况下一直悬着。
      React.useEffect(() => {
        if (confirmGroup === null) return undefined
        /** 落点不在那个确认中的胶囊上就收回。 */
        function onDown(event) {
          const target = event.target
          if (target instanceof Element && target.closest('.dsm-group-confirm') !== null) return
          setConfirmGroup(null)
        }
        document.addEventListener('mousedown', onDown, true)
        return () => document.removeEventListener('mousedown', onDown, true)
      }, [confirmGroup])

      /**
       * 算浮窗落点：相对面板、两个方向都夹在面板内（面板是 overflow:hidden）。
       * @param {any} event - React 鼠标事件。
       * @param {number} width - 期望宽度。
       * @returns {{ width: number, top: number, left: number } | null} 位置；锚点不在面板里时返回 null。
       */
      function positionTip(event, width) {
        const anchor = event.currentTarget
        const panel = anchor.closest('.dsm-panel')
        if (panel === null) return null
        const rect = anchor.getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        const w = Math.min(width, Math.max(200, panelRect.width - 48))
        return {
          width: w,
          top: Math.max(34, Math.min(rect.top - panelRect.top + rect.height / 2, panelRect.height - 34)),
          left: Math.max(8, Math.min(rect.right - panelRect.left + 8, panelRect.width - w - 8)),
        }
      }

      /**
       * 技能行的悬停简介。
       * @param {any} event - React 鼠标事件。
       * @param {object} skill - 技能行。
       * @returns {void}
       */
      function showHover(event, skill) {
        const pos = positionTip(event, 320)
        if (pos !== null) setHover({ ...pos, node: briefOf(skill) })
      }

      /**
       * 分组胶囊的悬停说明：这个组是把哪些活放在一起、开启后是什么效果。
       *
       * 不逐个列成员——组里的技能名字一眼看不完，而对用户有用的信息是
       * 「我点它会发生什么」。组上没写说明时退回一句数量说明。
       * 另外，组是全局存的技能名集合，里面的技能可能已经被卸载 / 改名；
       * 这种「脏成员」单独提示一行，否则用户会以为点了没反应是别的毛病。
       * @param {any} event - React 鼠标事件。
       * @param {{ name: string, description?: string, skills: string[] }} group - 分组。
       * @param {Array<{ name: string }>} allSkills - 当前目录里的全部技能。
       * @returns {void}
       */
      function showGroupHover(event, group, allSkills) {
        // 分组说明是一整句话，给宽一点、允许换行；300px 会被截成「一句话 + 省略号」
        const pos = positionTip(event, 420)
        if (pos === null) return
        const hint = String(group.description ?? '').trim()
        const present = new Set(allSkills.map((skill) => skill.name))
        const missing = group.skills.filter((name) => !present.has(name)).length
        setHover({
          ...pos,
          node: h(
            'div',
            { className: 'dsm-tip-group' },
            h('div', { className: 'dsm-tip-title' }, `${group.name} · ${group.skills.length}`),
            h(
              'div',
              { className: 'dsm-tip-text dsm-tip-paragraph' },
              hint.length > 0 ? hint : `把这一组的 ${group.skills.length} 个技能一起开关，组外技能不受影响。`,
            ),
            missing === 0 ? null : h('div', { className: 'dsm-tip-missing' }, text.missingMembers(missing)),
          ),
        })
      }

      const skills = Array.isArray(data.skills) ? data.skills : []
      const groups = Array.isArray(data.groups) ? data.groups : []
      const master = data.master !== false
      const auto = data.auto === true
      const enabledCount = skills.filter((skill) => skill.enabled).length
      /**
       * 自动模式的列表表达。
       *
       * 自动模式下「enabled」这个字段不代表本轮结果：它是「没被手动关掉」，
       * 默认状态下 44 行全是 true，用户会误以为全部启用了。所以：
       * - 列表按 `lastCatalog.autoPicked` 显示「本轮选中 / 未选中」，不再用开关表达；
       * - 开关只留占位（disabled + 压暗），避免行高跳动；
       * - 正在选技能建组时（selecting）照旧用复选框、不加自动态，
       *   否则一半行被降到 0.55 透明度，勾选时连名字都看不清。
       */
      const autoView = auto === true && master === true && selecting !== true
      const autoPicked = Array.isArray(data.lastCatalog?.autoPicked) ? data.lastCatalog.autoPicked : []
      const pickedSet = new Set(autoPicked)
      // 自动选技一个都没命中时会退回全部：列表上仍显示「未选中」（自动确实没点名），
      // 但必须说清这一轮其实是全都给了，否则和「模型看到的目录」对不上。
      const autoHintText =
        autoPicked.length === 0 && data.lastCatalog !== null && data.lastCatalog !== undefined
          ? `${text.autoListHint} · ${text.autoFallback}`
          : text.autoListHint

      const needle = query.trim().toLowerCase()
      const filtered = needle.length === 0
        ? skills
        : skills.filter(
            (skill) =>
              skill.name.toLowerCase().includes(needle) ||
              String(skill.description || '').toLowerCase().includes(needle),
          )

      const error = localError ?? (typeof data.error === 'string' ? data.error : null)

      /** 选中集合加减。 */
      function toggleSelected(name) {
        const next = new Set(selected)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        setSelected(next)
      }

      /**
       * 一个组是不是「开着」：组内成员全部启用。
       * @param {{ skills: string[] }} group - 分组。
       * @returns {boolean} 是否全开。
       */
      function groupAllOn(group) {
        if (group.skills.length === 0) return false
        const members = new Set(group.skills)
        const every = group.skills.every((name) => {
          const row = skills.find((skill) => skill.name === name)
          return row === undefined ? true : row.enabled
        })
        if (!every) return false
        // 组内全开还不够：44/44 全开时每个组都会显得「开着」，点一下反而变成关。
        // 必须真的存在「组外技能被关掉」，这个组才算在生效。
        return skills.some((row) => !members.has(row.name) && row.enabled === false)
      }

      /**
       * 开关一个分组。
       *
       * 语义是「只启用选中的分组」而不是「把这一组的技能还回去」：
       * - 开：把「已经开着的其他组 + 这一组」的成员全部留下，**其余技能一律关掉**；
       * - 关：如果还有别的组开着，只关这一组；如果这是最后一个开着的组，就恢复成全开，
       *   否则会留下「所有技能都关」的死状态。
       *
       * 多个组同时开着时它们是并集，互不干扰。
       * @param {{ id: string, skills: string[] }} group - 分组。
       * @returns {Promise<void>}
       */
      async function toggleGroup(group) {
        const others = groups.filter((item) => item.id !== group.id && groupAllOn(item))
        if (groupAllOn(group)) {
          if (others.length === 0) {
            setLocalError(await mutate(sessionId, 'reset', {}))
            return
          }
          setLocalError(await mutate(sessionId, 'setSkills', { names: [...group.skills], enabled: false }))
          return
        }
        const keep = new Set([...group.skills, ...others.flatMap((item) => item.skills)])
        setLocalError(await mutate(sessionId, 'enableOnly', { names: [...keep] }))
      }

      /**
       * 真正删组。先收掉确认态，免得删完（或失败）之后按钮还挂着「确认删除?」。
       * @param {{ id: string }} group - 分组。
       * @returns {Promise<void>}
       */
      async function removeGroup(group) {
        setConfirmGroup(null)
        setLocalError(await mutate(sessionId, 'deleteGroup', { id: group.id }))
      }

      /**
       * ✕ 的第一下只进确认态，第二下才删——误点一下不该丢掉整个组。
       * @param {{ id: string }} group - 分组。
       * @returns {void}
       */
      function askDelete(group) {
        if (confirmGroup === group.id) {
          void removeGroup(group)
          return
        }
        setConfirmGroup(group.id)
      }

      /** 用选中的技能新建一个分组。 */
      async function createGroup() {
        const name = groupName.trim()
        if (name.length === 0 || selected.size === 0) {
          setLocalError(text.needSelect)
          return
        }
        const failure = await mutate(sessionId, 'saveGroup', { name, skills: [...selected] })
        if (failure !== null) {
          setLocalError(failure)
          return
        }
        setGroupName('')
        setSelected(new Set())
        setSelecting(false)
        setLocalError(null)
      }

      /** 把选中的技能并进已有分组。 */
      async function addToGroup() {
        const group = groups.find((item) => item.id === targetGroup)
        if (group === undefined || selected.size === 0) {
          setLocalError(text.needSelect)
          return
        }
        const failure = await mutate(sessionId, 'saveGroup', {
          id: group.id,
          name: group.name,
          skills: [...new Set([...group.skills, ...selected])],
        })
        if (failure !== null) {
          setLocalError(failure)
          return
        }
        setSelected(new Set())
        setSelecting(false)
        setLocalError(null)
      }

      const header = h(
        'div',
        { className: 'dsm-head' },
        h(
          'div',
          { className: 'dsm-head-main' },
          h('span', { className: 'dsm-head-icon' }, h(Glyph, { size: 15 })),
          h('span', { className: 'dsm-head-title' }, text.name),
          h(
            'span',
            { className: 'dsm-head-summary' },
            // 自动模式下列的是「本轮挑了几个」，而不是「手动开了几个」——默认
            // 一个都不手动选，这里再显示 44/44 会让人以为全部启用了。
            data.auto === true
              ? `${text.autoOn} · ${text.thisRound} ${data.lastCatalog?.autoPicked?.length ?? 0}`
              : master !== true
                ? text.allOff
                : `${text.count(enabledCount, skills.length)} · ${text.on}`,
          ),
          // 每轮固定烧在目录上的开销。数字来自宿主估算（粗估，量级够用）。
          h(
            'span',
            { className: 'dsm-head-tokens', title: `${text.tokensLabel} ≈ ${data.tokens?.all ?? 0} ${text.tok}` },
            `≈${data.tokens?.visible ?? 0} ${text.tok}`,
          ),
        ),
        h(
          'div',
          { className: 'dsm-head-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsm-ghost',
              onClick: async () => setLocalError(await mutate(sessionId, 'reset', {})),
            },
            text.reset,
          ),
          h(
            'button',
            { type: 'button', className: 'dsm-ghost dsm-close', onClick: onClose, 'aria-label': text.close, title: text.close },
            '✕',
          ),
        ),
      )

      // 详情页复用同一套外壳：标题栏（含关闭）留在上面，正文换成一页内容，
      // 这样点进去以后还能直接关掉面板，不用先退回来。
      if (detailName !== null) {
        return h(
          'div',
          { className: 'dsm-panel' },
          header,
          h(DetailView, { sessionId, name: detailName, onBack: () => setDetailName(null) }),
        )
      }

      const switches = h(
        'div',
        { className: 'dsm-switches' },
        h(SwitchRow, {
          title: text.master,
          hint: text.masterHint,
          checked: master,
          onToggle: (next) => void mutate(sessionId, 'setMaster', { value: next }),
        }),
        h(SwitchRow, {
          title: text.auto,
          hint: text.autoHint,
          checked: auto,
          disabled: master !== true,
          onToggle: (next) => void mutate(sessionId, 'setAuto', { value: next }),
        }),
        auto === true && data.lastCatalog !== null && data.lastCatalog !== undefined && Array.isArray(data.lastCatalog.autoPicked) && data.lastCatalog.autoPicked.length > 0
          ? h('div', { className: 'dsm-note' }, `${text.autoPicked}: ${data.lastCatalog.autoPicked.join(' · ')}`)
          : null,
      )

      const groupArea = h(
        'div',
        { className: 'dsm-section' },
        h(
          'div',
          { className: 'dsm-section-head' },
          h('span', { className: 'dsm-section-title' }, text.groups),
          groups.length === 0
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'dsm-link',
                  onClick: () => {
                    setSelecting(true)
                    setSelected(new Set())
                  },
                },
                text.groupMode,
              ),
        ),
        groups.length === 0
          ? h('div', { className: 'dsm-quiet' }, text.groupsEmpty)
          : h(
              'div',
              { className: 'dsm-chips' },
              ...groups.map((group) => {
                // 胶囊的亮/灭和点击时的判断必须用同一个规则，否则会出现
                // 「看着是灭的、点一下却变成关」这种鬼状态
                const allOn = groupAllOn(group)
                // 删除确认态：第一下 ✕ 只进这个状态，第二下才真删（3 秒后 / 点别处自动收回）
                const confirming = confirmGroup === group.id
                return h(
                  'span',
                  {
                    key: group.id,
                    className: ['dsm-group', allOn ? 'dsm-group-on' : '', confirming ? 'dsm-group-confirm' : '']
                      .filter((name) => name.length > 0)
                      .join(' '),
                    // 悬停展示这一组里到底有哪几个技能（分组名 + 数字对用户不够）
                    onMouseEnter: (event) => showGroupHover(event, group, skills),
                    onMouseLeave: () => setHover(null),
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-group-main',
                      // 确认态下点胶囊本体也算确认：文字已经写着「确认删除?」，
                      // 这时候再点它还去开关整组会让人以为删成功了。
                      onClick: () => {
                        if (confirming) void removeGroup(group)
                        else void toggleGroup(group)
                      },
                      title: confirming ? text.confirmDeleteHint : allOn ? text.toggleNone : text.toggleAll,
                    },
                    confirming
                      ? h('span', { className: 'dsm-group-name' }, text.confirmDelete)
                      : h(
                          React.Fragment,
                          null,
                          h('span', { className: 'dsm-group-name' }, group.name),
                          h('span', { className: 'dsm-group-count' }, String(group.skills.length)),
                        ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-group-x',
                      title: confirming ? text.confirmDeleteHint : text.deleteGroup,
                      'aria-label': confirming ? text.confirmDelete : text.deleteGroup,
                      onClick: (event) => {
                        event.stopPropagation()
                        askDelete(group)
                      },
                    },
                    '✕',
                  ),
                )
              }),
            ),
      )

      const toolbar = h(
        'div',
        { className: 'dsm-toolbar' },
        h(
          'label',
          { className: 'dsm-search' },
          h(
            'svg',
            { width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': true, className: 'dsm-search-icon' },
            h('circle', { cx: 7, cy: 7, r: 4.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
            h('path', { d: 'M10.4 10.4 14 14', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
          ),
          h('input', {
            className: 'dsm-input',
            value: query,
            placeholder: text.search,
            'aria-label': text.search,
            onChange: (event) => setQuery(event.target.value),
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            className: selecting ? 'dsm-button dsm-button-on' : 'dsm-button',
            onClick: () => {
              setSelecting(selecting !== true)
              setSelected(new Set())
            },
          },
          selecting ? text.groupModeDone : text.groupMode,
        ),
        // 批量：一键清空（全部停用）／一键全部启用。都是「停用」不是删除，随时可逆。
        h(
          'button',
          {
            type: 'button',
            className: 'dsm-ghost',
            title: text.clearHint,
            onClick: async () => setLocalError(await mutate(sessionId, 'disableAll', {})),
          },
          text.clearAll,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsm-ghost',
            title: text.enableAllHint,
            onClick: async () => setLocalError(await mutate(sessionId, 'enableAll', {})),
          },
          text.enableAll,
        ),
      )

      const list = h(
        'div',
        { className: 'dsm-list' },
        filtered.length === 0
          ? h('div', { className: 'dsm-quiet dsm-quiet-center' }, skills.length === 0 ? text.noSkills : text.empty)
          : filtered.map((skill) => {
              // 自动模式：这一轮系统有没有点它。手动模式下不看这个，开关说了算。
              const picked = autoView && pickedSet.has(skill.name)
              return h(
                'div',
                {
                  key: skill.name,
                  className: [
                    'dsm-item',
                    selecting && selected.has(skill.name) ? 'dsm-item-picked' : '',
                    // 自动模式下没被选中的行整行降透明度：一眼能看出这一轮谁在目录里。
                    autoView && !picked ? 'dsm-item-idle' : '',
                  ]
                    .filter((name) => name.length > 0)
                    .join(' '),
                  role: 'button',
                  tabIndex: 0,
                  // 悬停浮出简介。用自绘浮窗而不是 title 属性：原生 tooltip 会整段
                  // 弹出来盖住输入框，之前就是因为这个把 title 去掉的。
                  onMouseEnter: (event) => showHover(event, skill),
                  onMouseLeave: () => setHover(null),
                  // 不给整行挂 title：原生 tooltip 会弹出一大段描述盖住输入框。
                  // 描述放详情页里看，这里只保留一行名字。
                  // 整行可点：看正文是这里最常用的动作，别让人去瞄一个小按钮。
                  // 开关自己会 stopPropagation，所以不会顺带把面板翻到详情页。
                  onClick: () => {
                    if (selecting) toggleSelected(skill.name)
                    else setDetailName(skill.name)
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (selecting) toggleSelected(skill.name)
                      else setDetailName(skill.name)
                    }
                  },
                },
                // 固定宽度的前导槽：开关 36px、复选框 13px，不加槽的话切换编组态时
                // 技能名会整体横移一格。
                h(
                  'span',
                  { className: 'dsm-lead' },
                  selecting
                    ? h('input', {
                        type: 'checkbox',
                        className: 'dsm-check',
                        checked: selected.has(skill.name),
                        'aria-label': skill.name,
                        onChange: () => toggleSelected(skill.name),
                        onClick: (event) => event.stopPropagation(),
                      })
                    : autoView
                      ? // 自动模式：开关只是占位（保留尺寸防行高跳动），并把状态压成「关」——
                        // 它本来就不代表本轮结果，这时渲染成「开」正是用户误以为全部启用的原因。
                        h(Switch, {
                          checked: false,
                          disabled: true,
                          ghost: true,
                          label: `${skill.name} — ${text.autoSwitchLocked}`,
                          onToggle: () => {},
                        })
                      : h(Switch, {
                          checked: skill.enabled === true,
                          disabled: master !== true,
                          label: `${skill.name} ${skill.enabled ? text.on : text.off}`,
                          onToggle: (next) => void mutate(sessionId, 'setSkills', { names: [skill.name], enabled: next }),
                        }),
                ),
                h('span', { className: 'dsm-item-name' }, skill.name),
                // 自动模式：用状态点 + 文字表达「本轮选中 / 未选中」，替代开关语义。
                autoView
                  ? h(
                      'span',
                      { className: picked ? 'dsm-status dsm-status-on' : 'dsm-status' },
                      h('span', { className: 'dsm-dot' }),
                      picked ? text.pickedNow : text.notPicked,
                    )
                  : null,
                // 官方技能（DSH 装包里的 + 插件运行时注册的）打「官方」标签；
                // 其余显示来源，方便区分「我装的」和「工程里的」。
                skill.official === true
                  ? h('span', { className: 'dsm-source dsm-official', title: skill.source }, text.official)
                  : h('span', { className: 'dsm-source', title: skill.source }, SOURCE_ZH[skill.source] ?? skill.source),
              )
            }),
      )

      const selectionBar = selecting
        ? h(
            'div',
            { className: 'dsm-selection' },
            h('span', { className: 'dsm-selection-count' }, text.selected(selected.size)),
            h('input', {
              className: 'dsm-input dsm-input-grow',
              value: groupName,
              placeholder: text.groupNamePlaceholder,
              onChange: (event) => setGroupName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') void createGroup()
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-button dsm-button-primary',
                disabled: selected.size === 0 || groupName.trim().length === 0,
                onClick: () => void createGroup(),
              },
              text.create,
            ),
            groups.length === 0
              ? null
              : h(
                  React.Fragment,
                  null,
                  h(
                    'select',
                    { className: 'dsm-select', value: targetGroup, onChange: (event) => setTargetGroup(event.target.value) },
                    h('option', { value: '' }, text.addToGroup),
                    ...groups.map((group) => h('option', { key: group.id, value: group.id }, group.name)),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-button',
                      disabled: selected.size === 0 || targetGroup.length === 0,
                      onClick: () => void addToGroup(),
                    },
                    '→',
                  ),
                ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-button',
                onClick: () => {
                  setSelecting(false)
                  setSelected(new Set())
                },
              },
              text.cancel,
            ),
          )
        : null

      // 列表上方的一行小字：自动模式下开关不生效，要逐个控制得先切手动。
      // 放在列表外面（不随列表滚动），并且只在自动模式真的在管这份列表时显示。
      const autoHint = autoView ? h('div', { className: 'dsm-auto-hint' }, autoHintText) : null

      return h(
        'div',
        { className: 'dsm-panel' },
        header,
        error === null ? null : h('div', { className: 'dsm-error' }, `${text.failed}${error}`),
        switches,
        groupArea,
        toolbar,
        autoHint,
        list,
        selectionBar,
        hover === null
          ? null
          : h(
              'div',
              {
                className: 'dsm-tip',
                style: { top: `${hover.top}px`, left: `${hover.left}px`, width: `${hover.width}px` },
                role: 'tooltip',
              },
              hover.node,
            ),
      )
    }

    /* ------------------------------------------------------------------ *
     * 样式
     * ------------------------------------------------------------------ */

    /**
     * 类名全部 `dsm-` 前缀；颜色/圆角/字距只用主题 token，
     * 所以深浅色切换自动跟随，不会出现写死的白底黑字。
     */
    const CSS = `
/* 开关：36×20 轨道 / 2px 内边距 / 16px 滑块 / 120ms 位移，与 DSH 自带 Switch 一致 */
.dsm-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background-color 120ms ease}
.dsm-switch[aria-checked='true']{background:var(--dsw-alias-brand-primary)}
.dsm-switch:disabled{cursor:default;opacity:.5}
/* 自动模式下的占位开关：只占位、不表达状态，所以压到几乎看不见，但仍看得见「这里有个开关」 */
.dsm-switch:disabled.dsm-switch-ghost{opacity:.3}
.dsm-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsm-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb);transition:transform 120ms ease,background-color 120ms ease}
.dsm-switch[aria-checked='true'] .dsm-thumb{background:var(--dsw-alias-label-primary-foreground);transform:translateX(16px)}

/* 工具条胶囊 */
.dsm-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;transition:background-color 120ms ease,color 120ms ease,border-color 120ms ease}
@media (hover:hover){.dsm-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.dsm-pill:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsm-pill-open{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.dsm-glyph{flex:0 0 auto;color:var(--dsw-alias-label-caption)}
.dsm-glyph-on{color:var(--dsw-alias-brand-primary)}
.dsm-pill-name{font-weight:500}
.dsm-pill-count{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsm-pill-count-off{color:var(--dsw-alias-label-caption)}

/* 模型菜单里的行 */
.dsm-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:34px;padding:0 8px;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
@media (hover:hover){.dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dsm-row-quiet{cursor:default;color:var(--dsw-alias-label-tertiary)}
.dsm-row-text{display:flex;flex-direction:column;min-width:0;gap:1px}
.dsm-row-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-row-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 面板：贴着胶囊长出来的浮层 */
.dsm-anchor{position:relative;display:inline-flex}
.dsm-popover{position:absolute;bottom:calc(100% + 10px);left:0;z-index:50;width:min(680px,calc(100vw - 56px))}
.dsm-panel{margin:0;position:relative;display:flex;flex-direction:column;gap:10px;padding:12px 14px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-l1,var(--dsw-alias-bg-l2,#fff)));color:var(--dsw-alias-label-primary);box-shadow:0 18px 48px -18px rgba(0,0,0,.5),0 2px 8px -4px rgba(0,0,0,.28);max-height:var(--dsm-max-height,min(60vh,calc(100vh - 96px)));overflow:hidden;animation:dsm-in 140ms ease}
.dsm-panel>*{flex:0 0 auto}
.dsm-panel>.dsm-list{flex:1 1 auto;min-height:0;max-height:none}
/* 悬停简介：贴着行右侧浮出，不挡点击（pointer-events:none） */
.dsm-tip{position:absolute;z-index:6;transform:translateY(-50%);padding:6px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-l2,#fff));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;box-shadow:0 10px 26px -12px rgba(0,0,0,.45);pointer-events:none;white-space:normal;word-break:break-word}
/* 分组浮窗：每组一行「技能名 — 一句话」，名字等宽、描述弱化 */
.dsm-tip-group{display:flex;flex-direction:column;gap:4px}
.dsm-tip-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsm-tip-line{display:flex;gap:6px;align-items:baseline}
.dsm-tip-name{flex:0 0 auto;color:var(--dsw-alias-label-primary);font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);font-size:10.5px}
.dsm-tip-text{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-tip-more{color:var(--dsw-alias-label-caption);font-size:10.5px;padding-top:1px}
/* 组里有成员已经不在目录里（被卸载 / 改名）：单独一行灰字说明，别让胶囊静默失效 */
.dsm-tip-missing{color:var(--dsw-alias-label-caption);font-size:10.5px;line-height:16px;padding-top:1px}
/* 分组说明是一整段话：允许换行，不要单行省略号 */
.dsm-tip-paragraph{white-space:normal;overflow:visible;text-overflow:clip;line-height:18px;color:var(--dsw-alias-label-secondary)}
/* 面板里所有可交互元素统一带焦点环：宿主若有全局 outline:none，这里兜住 */
.dsm-panel :is(button,select,input,[role='button']):focus-visible,.dsm-anchor>button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
@keyframes dsm-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.dsm-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsm-head-main{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-head-icon{display:inline-flex;align-items:center;color:var(--dsw-alias-brand-primary)}
.dsm-head-title{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsm-head-summary{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsm-head-tokens{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsm-head-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.dsm-ghost{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:4px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}
@media (hover:hover){.dsm-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.dsm-close{font-size:12px;padding:4px 7px}

.dsm-switches{display:flex;flex-direction:column;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-l1,transparent)}
.dsm-note{padding:4px 10px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-business-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.dsm-section{display:flex;flex-direction:column;gap:6px}
.dsm-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsm-section-title{font-size:11px;line-height:16px;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}
.dsm-link{border:0;background:transparent;padding:0;color:var(--dsw-alias-state-business-primary);font-size:11px;line-height:16px;cursor:pointer}
@media (hover:hover){.dsm-link:hover{text-decoration:underline}}
.dsm-chips{display:flex;flex-wrap:wrap;gap:6px}
.dsm-group{display:inline-flex;align-items:center;max-width:100%;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;overflow:hidden;background:transparent;transition:border-color 120ms ease,background-color 120ms ease}
.dsm-group:focus-within{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary))}
.dsm-group-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary)}
.dsm-group-on .dsm-group-main,.dsm-group-on .dsm-group-x,.dsm-group-on .dsm-group-count{color:var(--dsw-alias-label-primary-foreground)}
.dsm-group-main{display:inline-flex;align-items:center;gap:6px;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;padding:3px 8px 3px 10px;cursor:pointer}
.dsm-group-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-group-count{font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;background:rgba(127,127,127,.18);font-variant-numeric:tabular-nums}
/* ✕ 默认藏起来：只在悬停 / 键盘焦点时露出，误点一下不再直接删掉整组 */
.dsm-group-x{border:0;background:transparent;color:var(--dsw-alias-label-caption);font-size:10px;line-height:1;padding:3px 8px 3px 2px;cursor:pointer;opacity:0;transition:opacity 120ms ease}
.dsm-group:hover .dsm-group-x,.dsm-group:focus-within .dsm-group-x,.dsm-group-x:focus-visible{opacity:.85}
@media (hover:hover){.dsm-group-x:hover{opacity:1}}
/* 触摸设备没有 hover：常显，否则根本点不到 */
@media (hover:none){.dsm-group-x{opacity:.6}}
/* 确认删除态：边框和文字转错误色，比只换字明显得多 */
.dsm-group-confirm{border-color:var(--dsw-alias-state-error-primary,#c0392b);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c0392b) 10%,transparent)}
.dsm-group-confirm .dsm-group-main,.dsm-group-confirm .dsm-group-x{color:var(--dsw-alias-state-error-primary,#c0392b)}
.dsm-group-confirm .dsm-group-x{opacity:1}
/* 「组开着」是品牌色实底：确认态换成错误色实底，否则红字压在品牌底上看不清 */
.dsm-group-on.dsm-group-confirm{border-color:var(--dsw-alias-state-error-primary,#c0392b);background:var(--dsw-alias-state-error-primary,#c0392b)}
.dsm-group-on.dsm-group-confirm .dsm-group-main,.dsm-group-on.dsm-group-confirm .dsm-group-x,.dsm-group-on.dsm-group-confirm .dsm-group-count{color:var(--dsw-alias-label-primary-foreground)}

.dsm-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;row-gap:6px}
.dsm-search{position:relative;display:flex;align-items:center;flex:1 1 190px;min-width:0}
.dsm-search-icon{position:absolute;left:9px;color:var(--dsw-alias-label-caption);pointer-events:none}
.dsm-input{box-sizing:border-box;width:100%;padding:6px 10px 6px 28px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-l1,transparent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;outline:none;transition:border-color 120ms ease,box-shadow 120ms ease}
.dsm-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsm-input:focus-visible{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-focus-ring-color,transparent)}
.dsm-input-grow{flex:1 1 140px;padding-left:10px}
.dsm-button{flex:0 0 auto;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px;padding:6px 12px;cursor:pointer;white-space:nowrap;transition:background-color 120ms ease,color 120ms ease,border-color 120ms ease}
.dsm-button:disabled{opacity:.45;cursor:default}
@media (hover:hover){.dsm-button:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.dsm-button-primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsm-button-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsm-select{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px;padding:6px 8px;max-width:150px}
/* 自动模式下列表上方的一行小字：解释为什么这一列开关点不动 */
.dsm-auto-hint{padding:0 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}

/* 列表自己滚：面板整体不滚，标题栏和底部操作条才始终可见 */
.dsm-list{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-height:0;max-height:min(380px,40vh);overflow-y:auto;overscroll-behavior:contain;margin:0 -6px;padding:0 6px}
.dsm-item{display:flex;align-items:center;gap:10px;min-height:32px;padding:3px 8px;border-radius:var(--dsw-radius-sm);transition:background-color 120ms ease,opacity 120ms ease;cursor:pointer;outline:none}
.dsm-item:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary)) inset}
@media (hover:hover){.dsm-item:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dsm-item-picked{background:var(--dsw-alias-interactive-bg-hover)}
/* 自动模式下这一轮没被选中的行：整行降透明度，一眼看出谁不在本轮目录里 */
.dsm-item-idle{opacity:.55}
/* 自动模式下的行状态：品牌色点 = 本轮选中，灰点 = 未选中 */
.dsm-status{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption);white-space:nowrap}
.dsm-dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-caption)}
.dsm-status-on{color:var(--dsw-alias-brand-primary)}
.dsm-status-on .dsm-dot{background:var(--dsw-alias-brand-primary)}
.dsm-lead{flex:0 0 36px;display:flex;align-items:center}
.dsm-item-name{flex:1 1 auto;min-width:0;border:0;background:transparent;padding:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-check{flex:0 0 auto;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dsm-source{flex:0 0 auto;font-size:10px;line-height:14px;padding:1px 7px;border-radius:999px;color:var(--dsw-alias-label-caption);border:.5px solid var(--dsw-alias-border-l2);font-variant-numeric:tabular-nums}
/* 「官方」标签：用品牌色描边，和灰色来源标签区分开 */
.dsm-official{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:500}

.dsm-selection{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 2px 2px;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsm-selection-count{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}

.dsm-detail{display:flex;flex-direction:column;gap:10px}
.dsm-detail-head{display:flex;align-items:center;gap:10px;min-width:0}
.dsm-back{border:0;background:transparent;padding:2px 6px 2px 0;color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px;cursor:pointer;flex:0 0 auto}
.dsm-detail-title{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-meta{display:flex;flex-wrap:wrap;gap:6px}
.dsm-tag{font-size:10px;line-height:14px;padding:2px 8px;border-radius:999px;color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l2)}
.dsm-tag-path{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-content{margin:0;max-height:min(380px,38vh);overflow:auto;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-l1,transparent);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);white-space:pre-wrap;word-break:break-word}

.dsm-quiet{padding:8px 2px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.dsm-quiet-center{text-align:center;padding:18px 8px}
.dsm-error{padding:6px 10px;font-size:11px;line-height:17px;color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-secondary));border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c0392b) 8%,transparent)}
.dsm-error:empty{display:none}
`

    /* ------------------------------------------------------------------ *
     * 注册
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots'],
      apply(ctx) {
        // 工具条上的入口：紧挨「完全权限」，和 DSH 自己的控件齐平。
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'skill-manager', order: 20 },
            SkillPill,
          ),
        )
        // 展开后的面板由胶囊自己以浮层方式画出，不再额外占用插槽。
        // 模型菜单里的两行开关，位置对齐自带的「启用智能体团队协作」。
        ctx.slots.inject('conversation.input.model.options', () =>
          ctx.slots.register(
            { name: 'conversation.input.model.options', id: 'skill-manager', order: 20 },
            MenuOptions,
          ),
        )
      },
    }
  },
})
