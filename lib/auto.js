/**
 * Skill Manager —— 自动选技（需求 3「自动选择是否读取技能」的判定逻辑）。
 *
 * 设计取舍：**不做语义向量、不调模型**。理由有三条：
 *
 *   1. 这一步发生在模型请求前的同步路径上（用户消息被本轮领取时）。在这里发一次
 *      LLM 请求等于把首字延迟翻倍，而且会把「技能目录」这种纯元数据变成计费调用。
 *   2. 判定必须可解释。用户点开界面要能看懂「为什么这一轮只列了这 5 个」，
 *      关键词重合度可以一句话说清，向量相似度不行。
 *   3. 误杀代价可控。没有任何技能够格时**退回全集**，所以最坏情况等同于关闭
 *      自动选技，不会出现「明明装了这个技能却怎么都调不到」。
 *
 * ## 打分口径（第一版踩过的坑）
 *
 * 第一版用「命中词数 × 1 分，满 11 分算相关」。问题是描述命中最多 5 分、
 * whenToUse 最多 3 分——**光靠描述永远到不了 11**，只有技能名被原样提起时才会命中。
 * 结果中文自然语句（「把这段中文润色一下」）一律退回全集，等于自动选技没生效。
 *
 * 现在改成**覆盖率 + 命中数**双条件：
 *
 *   - `cover` = 用户这句话里有多少比例的关键词出现在这个技能的文本里；
 *   - 够格条件 = 命中至少 2 个不同关键词，且覆盖率 ≥ 12%；技能名/名字片段命中则直接够格。
 *
 * 覆盖率天然自带归一化：短问题命中 2 个词就算相关，长问题要命中更多才算，
 * 而「随便说一句」基本凑不满两个词，于是安静地退回全集。
 *
 * 打分是纯函数，输入技能摘要 + 本轮用户文本，输出入选集合。不读磁盘、不碰 ctx。
 *
 * @module skill-manager/lib/auto
 */

/** 技能名整串出现在文本里时的分数（直接秒杀其它候选）。 */
const NAME_VERBATIM_SCORE = 100

/** 单个技能名片段命中时给的分数。名字片段是很强的信号。 */
const NAME_SEGMENT_SCORE = 20

/** 覆盖率满分权重：`cover` 是 0~1 的比例。 */
const COVERAGE_WEIGHT = 60

/** 每命中一个不同关键词给的分数。 */
const OVERLAP_WEIGHT = 2

/** 够格所需的最少「不同关键词」命中数。 */
const MIN_OVERLAP = 2

/** 够格所需的最低覆盖率。 */
const MIN_COVERAGE = 0.12

/** 默认最多列出几个候选。DSH 原生目录是全列，自动模式的意义就是压掉长尾。 */
export const DEFAULT_LIMIT = 8

/** ASCII 词：字母数字串，长度至少 2。 */
const ASCII_WORD = /[a-z0-9]{2,}/g

/** CJK 片段：连续的中日韩字符。 */
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g

/** 这些英文词在描述里到处都是，命中它们没有区分度。 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'from', 'as',
  'is', 'are', 'be', 'it', 'its', 'this', 'that', 'these', 'those', 'you', 'your', 'we', 'our',
  'can', 'will', 'should', 'must', 'may', 'use', 'uses', 'used', 'using', 'when', 'then', 'than',
  'not', 'no', 'do', 'does', 'done', 'into', 'about', 'after', 'before', 'each', 'other',
  'any', 'all', 'some', 'such', 'only', 'also', 'more', 'most', 'very', 'just', 'like',
  'skill', 'skills', 'task', 'tasks', 'work', 'working', 'based',
])

/**
 * 中文里到处都有的 bigram。它们几乎出现在每个技能描述里，算进覆盖率只会拉平差异。
 * 只收真正没有区分度的高频虚词组合，不动「代码」「文档」「表格」这类实词。
 */
const CJK_STOP = new Set([
  '可以', '我们', '你们', '他们', '什么', '这个', '那个', '这些', '那些', '一下', '一些',
  '时候', '因为', '所以', '如果', '但是', '然后', '需要', '进行', '一个', '没有', '就是',
  '还是', '应该', '已经', '之后', '之前', '通过', '以及', '并且', '或者', '而且', '自己',
  '现在', '开始', '使用', '用来', '用于', '如何', '怎么', '这样', '那样', '这么', '那么',
])

/**
 * 把文本拆成可用于比对的词集合。
 *
 * ASCII 部分按词取；CJK 没有空格分词，用 2-gram 近似——「中文文章」会拆成
 * 「中文」「文文」「文章」，命中两三个 bigram 基本就意味着同一个短语。
 * @param {string} text - 原始文本。
 * @returns {Set<string>} 小写词集合。
 */
export function tokenize(text) {
  const words = new Set()
  if (typeof text !== 'string' || text.length === 0) return words
  const lower = text.toLowerCase()
  for (const match of lower.matchAll(ASCII_WORD)) {
    const word = match[0]
    if (STOP_WORDS.has(word)) continue
    words.add(word)
  }
  for (const match of lower.matchAll(CJK_RUN)) {
    const run = match[0]
    if (run.length === 1) {
      words.add(run)
      continue
    }
    for (let index = 0; index + 1 < run.length; index += 1) words.add(run.slice(index, index + 2))
    if (run.length <= 4) words.add(run)
  }
  return words
}

/**
 * 取「有区分度」的词：去掉停用词，以及中文里到处都是的高频 bigram。
 *
 * 编组匹配必须用这个，不能用裸 `tokenize`：「把一」「一个」「需要」这类词会让
 * 体量大的分组（编程 14 个技能）变成磁铁，把无关的话全吸过去。
 * @param {string} text - 原始文本。
 * @returns {string[]} 去重后的词表。
 */
export function keywordsOf(text) {
  const words = []
  for (const word of tokenize(text)) {
    if (CJK_STOP.has(word)) continue
    words.push(word)
  }
  return words
}

/**
 * 把技能名拆成片段（kebab-case → 词）。
 * @param {string} name - 技能名，例如 `my-skill-zh`。
 * @returns {string[]} 片段，例如 `['my', 'skill', 'zh']`。
 */
function nameSegments(name) {
  return String(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((segment) => segment.length >= 2 && !STOP_WORDS.has(segment))
}

/**
 * 给一个技能算分。
 *
 * @param {{ name: string, description?: string, whenToUse?: string }} skill - 技能摘要。
 * @param {string} lowerText - 已经小写化的用户文本。
 * @param {string[]} keywords - 用户文本里的有区分度关键词。
 * @returns {{ score: number, qualified: boolean }} 分数与是否够格。
 */
function scoreSkill(skill, lowerText, keywords) {
  const name = String(skill.name)
  const lowerName = name.toLowerCase()
  let score = 0
  let strong = false
  let overlap = 0
  if (lowerText.includes(lowerName)) {
    score += NAME_VERBATIM_SCORE
    strong = true
  }
  for (const segment of nameSegments(name)) {
    if (lowerText.includes(segment)) {
      score += NAME_SEGMENT_SCORE
      strong = true
    }
  }
  if (keywords.length > 0) {
    // 把技能自己的文本也拆成词集合，再和用户关键词取交集。用集合而不是逐词
    // 扫字符串，长描述（上千字）也只是一次散列查找。
    const haystack = new Set([
      ...tokenize(`${name} ${String(skill.description ?? '')} ${String(skill.whenToUse ?? '')}`),
    ])
    for (const word of keywords) if (haystack.has(word)) overlap += 1
    const cover = overlap / keywords.length
    score += Math.round(COVERAGE_WEIGHT * cover) + overlap * OVERLAP_WEIGHT
    if (overlap >= MIN_OVERLAP && cover >= MIN_COVERAGE) strong = true
  }
  return { score, qualified: strong && score > 0 }
}

/**
 * 从技能摘要里挑出与本轮用户文本相关的那些。
 *
 * @param {Array<{ name: string, description?: string, whenToUse?: string }>} skills - 可参与选择的技能（已经按启用状态过滤过）。
 * @param {string} text - 本轮用户文本；多段文本请先拼接。
 * @param {{ limit?: number }} [options] - `limit` 是入选上限。
 * @returns {{ matched: string[], scores: Record<string, number>, fallback: boolean }}
 *   `matched` 是入选技能名（按分数降序）；`fallback: true` 表示没有候选够格，调用方应退回全集。
 */
export function selectRelevant(skills, text, options = {}) {
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT
  const source = String(text ?? '')
  if (source.trim().length === 0) return { matched: [], scores: {}, fallback: true }
  const lowerText = source.toLowerCase()
  const keywords = keywordsOf(source)
  /** @type {Array<{ name: string, score: number }>} */
  const scored = []
  for (const skill of skills) {
    const { score, qualified } = scoreSkill(skill, lowerText, keywords)
    if (qualified) scored.push({ name: String(skill.name), score })
  }
  if (scored.length === 0) return { matched: [], scores: {}, fallback: true }
  scored.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
  /** @type {Record<string, number>} */
  const scores = {}
  for (const item of scored) scores[item.name] = item.score
  return { matched: scored.slice(0, limit).map((item) => item.name), scores, fallback: false }
}

/**
 * 从消息批次里取出「用户真正说的话」。
 *
 * 只认 `source.kind === 'user'` 的文本块——技能目录、skill 内容注入、系统提醒
 * 都是别的来源，拿它们去打分会自己命中自己。
 * @param {Array<{ source?: { kind?: string }, content?: Array<{ type: string, text?: string }> }>} messages - 步骤消息。
 * @returns {string} 拼接后的用户文本。
 */
export function userTextOf(messages) {
  if (!Array.isArray(messages)) return ''
  const parts = []
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    if (message.source?.kind !== 'user') continue
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n')
}
