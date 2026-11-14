/**
 * Skill Manager —— 自动选技的「编组优先」判定。
 *
 * 自动选技先看有没有现成的编组能覆盖这一轮的任务；有就整组上，没有才逐个挑。
 * 这样做的理由：编组是用户自己按工作场景划出来的（写作 / 编程 / 通用设计），
 * 它比关键词更能代表「这类活需要哪一套技能」。单独挑几个反而容易漏。
 *
 * 打分口径与 auto.js 一致：**覆盖率**（任务里有几个关键词落在这个组的文本里）
 * 加**名字命中**（组名被原样提起）。不做语义向量、不调模型——这一步在模型请求
 * 之前的同步路径上，加一次 LLM 调用等于把首字延迟翻倍。
 *
 * 误判方向的选择：宁可**漏判**也不乱判。判错组的代价是把一整组不相关的技能摆到
 * 模型面前（比漏掉更糟），所以门槛设得比单技能选择更高。
 *
 * @module skill-manager/lib/group-match
 */

import { keywordsOf, tokenize } from './auto.js'

/** 组名整串出现在任务里：基本可以确定用户就在说这个组。 */
const GROUP_NAME_SCORE = 100

/** 组名里的词命中（例如「写作」出现在「帮我写作」里）。 */
const GROUP_NAME_SEGMENT_SCORE = 30

/** 覆盖率权重。 */
const COVERAGE_WEIGHT = 70

/** 一个组至少有这么多关键词落在任务里才算「相关」。 */
const MIN_HITS = 2

/** 覆盖率门槛。比单技能的 0.12 高，因为判错整个组的代价更大。 */
const MIN_COVERAGE = 0.2

/**
 * 短句的判定长度上限。
 *
 * 中文按二字组切，「做张封面」只切出 4 个词，能命中的通常只有 1 个 —— 拿真实词数
 * 当分母会让短句永远够不到门槛。所以分母取 `min(本常量, 词数)`：短句按 4 个词算，
 * 长句照真实词数算，长短句的门槛才是一把尺子。
 */
const SHORT_TOKEN_LIMIT = 4

/**
 * 把一个分组的全部可读文本摊平：组名 + 说明 + 成员名 + 成员描述。
 *
 * 成员描述也要算进去——用户说「润色一下」时，「写作」这个组名可能不出现，
 * 但组里某个成员技能的描述里有「编辑中文文章…」。
 * @param {{ name: string, description?: string, skills: string[] }} group - 分组。
 * @param {Array<{ name: string, description?: string }>} skills - 全部技能摘要。
 * @returns {string} 用于匹配的文本。
 */
function groupHaystack(group, skills) {
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  const parts = [String(group.name ?? ''), String(group.description ?? '')]
  for (const name of group.skills) {
    parts.push(name)
    const skill = byName.get(name)
    if (skill !== undefined) parts.push(String(skill.description ?? ''))
  }
  return parts.join('\n')
}

/** 已经整组启用的编组：加权。只够打破平局，压不过明显更贴题的另一组。 */
const ENGAGED_BONUS = 8

/** 第二组要够第一组得分的这个比例才并入（跨活儿的任务才给并集）。 */
const SECOND_GROUP_RATIO = 0.75

/**
 * 挑出最匹配当前任务的分组。
 *
 * @param {Array<{ name: string, description?: string, skills: string[] }>} groups - 全部分组。
 * @param {Array<{ name: string, description?: string }>} skills - 全部技能摘要。
 * @param {string} text - 本轮用户输入。
 * @param {Set<string>} [engaged] - 当前已整组启用的分组名（只作为偏好）。
 * @returns {{ name: string, skills: string[], score: number } | undefined} 命中的分组。
 */
export function pickGroup(groups, skills, text, engaged = new Set()) {
  if (groups.length === 0) return undefined
  // 用去停用词的词表：裸 tokenize 里的「把一」「一个」「需要」会让体量大的组变成磁铁
  const tokens = keywordsOf(text)
  if (tokens.length === 0) return undefined
  const lower = text.toLowerCase()

  const scored = []
  for (const group of groups) {
    if (group.skills.length === 0) continue
    const haystack = groupHaystack(group, skills)
    const hayLower = haystack.toLowerCase()
    const groupName = String(group.name ?? '').trim().toLowerCase()
    // 只含组名 + 组说明的「头部」：命中落在这里比落在成员描述里可信得多
    const headerLower = `${group.name ?? ''}\n${group.description ?? ''}`.toLowerCase()
    let strongHits = 0

    // 组名整串出现 = 用户明确在说这个组
    let score = groupName.length > 0 && lower.includes(groupName) ? GROUP_NAME_SCORE : 0
    let hits = 0
    for (const token of tokens) {
      if (hayLower.includes(token) === false) continue
      hits += 1
      if (groupName.includes(token)) score += GROUP_NAME_SEGMENT_SCORE
      // 命中落在「组名 / 组说明」里比落在成员描述里强得多：前者说明用户就在说这类活，
      // 后者常常只是某个技能描述里恰好有同一个词。
      if (headerLower.includes(token)) strongHits += 1
    }
    // 够格条件：**至少一个词命中在组名/组说明里**。只命中成员描述的词不算——
    // 实测那是最大误判源（「扫描后台」「列个计划」被吸进编程组）。
    if (strongHits < 1) continue
    const coverage = hits / Math.min(SHORT_TOKEN_LIMIT, tokens.length)
    if (coverage < MIN_COVERAGE && score === 0) continue
    score += coverage * COVERAGE_WEIGHT
    if (engaged.has(group.name)) score += ENGAGED_BONUS
    scored.push({ score, name: group.name, skills: [...group.skills], strongHits })
  }
  scored.sort((left, right) => right.score - left.score)
  return scored[0]
}

/**
 * 挑出最匹配的分组，**最多两个**。
 *
 * 跨活儿的任务（「帮我写技术文档」同时沾写作和编程）只给一个组会漏掉一半技能。
 * 第二个组要求：得分不低于第一组的 `SECOND_GROUP_RATIO`，且两组技能重叠不超过一半
 * （重叠多说明它们其实在说同一件事，并起来没意义）。
 * @param {Array<{ name: string, description?: string, skills: string[] }>} groups - 全部分组。
 * @param {Array<{ name: string, description?: string }>} skills - 全部技能摘要。
 * @param {string} text - 本轮用户输入。
 * @param {Set<string>} [engaged] - 已整组启用的分组名。
 * @returns {Array<{ name: string, skills: string[], score: number }>} 命中的分组（0–2 个）。
 */
export function pickGroups(groups, skills, text, engaged = new Set()) {
  const first = pickGroup(groups, skills, text, engaged)
  if (first === undefined) return []
  const scored = []
  // 重新跑一遍打分，拿到全部候选（pickGroup 只返回最好的那个）
  for (const group of groups) {
    if (group.name === first.name || group.skills.length === 0) continue
    const single = pickGroup([group], skills, text, engaged)
    if (single !== undefined) scored.push(single)
  }
  const second = scored
    .filter((item) => item.score >= first.score * SECOND_GROUP_RATIO)
    .filter((item) => {
      const overlap = item.skills.filter((name) => first.skills.includes(name)).length
      return overlap * 2 <= Math.min(item.skills.length, first.skills.length)
    })
    .sort((left, right) => right.score - left.score)[0]
  return second === undefined ? [first] : [first, second]
}
