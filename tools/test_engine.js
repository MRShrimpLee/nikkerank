/*
 * 胜利女神：NIKKE 妮姬喜好排序 —— 引擎与数据集测试
 *   node tools/test_engine.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const E = require(path.join(__dirname, '..', 'js', 'engine.js'))
const DATA = require(path.join(__dirname, '..', 'js', 'data.js'))
const CHARS = DATA.characters
const DIMS = ['rarity', 'cls', 'company', 'burst', 'weapon', 'element']

let passed = 0
let failed = 0

function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')) }
}
function section (title) { console.log('\n' + title) }

/* 固定种子随机源，保证测试可复现 */
function makeRng (seed) {
  let s = seed >>> 0
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
function shuffle (arr, rng) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}
function playGame (pool, truth, ranknum, rng) {
  const sorter = new E.Sorter(pool, ranknum, rng)
  const better = {}
  truth.forEach((c, i) => { better[c.id] = i })
  let guard = 0
  while (sorter.currentPair) {
    if (++guard > 200000) throw new Error('题目数量异常')
    const pair = sorter.currentPair
    const pick = better[pair[0].id] <= better[pair[1].id] ? 0 : 1
    if (!sorter.selectChar(pick)) break
  }
  return { ranking: sorter.getRanking().map(n => n.id), questions: sorter.questionCount }
}

section('1. 排序正确性（与真实喜好一致）')
{
  const rng = makeRng(20260107)
  const pool = CHARS.slice(0, 20)
  const truth = shuffle(pool, rng)
  for (const ranknum of [1, 3, 5, 20]) {
    const { ranking, questions } = playGame(pool, truth, ranknum, rng)
    const expect = truth.slice(0, Math.min(ranknum, pool.length)).map(c => c.id)
    check(`ranknum=${ranknum} 结果正确`, JSON.stringify(ranking) === JSON.stringify(expect))
    check(`ranknum=${ranknum} 轮数合理 (${questions} 轮)`, questions >= 1 && questions < 200)
  }
}

section('2. 全量规模：205 名取前 10')
{
  const rng = makeRng(7)
  const truth = shuffle(CHARS, rng)
  const { ranking, questions } = playGame(CHARS, truth, 10, rng)
  const expect = truth.slice(0, 10).map(c => c.id)
  check('前 10 名与真实喜好一致', JSON.stringify(ranking) === JSON.stringify(expect))
  const lower = CHARS.length - 1
  const upper = lower + 10 * (Math.ceil(Math.log2(CHARS.length)) + 4)
  check(`轮数 ${questions} ≥ 下界 N−1 = ${lower}`, questions >= lower)
  check(`轮数 ${questions} ≤ 上界 ${upper}`, questions <= upper)
  check('轮数远小于两两全比', questions < 1000)
  const est = E.estimateQuestions(CHARS.length, 10)
  check(`题量预估 ${est} 与实际 ${questions} 同量级`, est >= questions * 0.8 && est <= questions * 1.8)
}

section('3. 全排序与边界')
{
  const rng = makeRng(99)
  const pool = CHARS.slice(30, 42)
  const truth = shuffle(pool, rng)
  const { ranking } = playGame(pool, truth, Infinity, rng)
  check('全序结果与真实喜好完全一致', JSON.stringify(ranking) === JSON.stringify(truth.map(c => c.id)))

  const one = CHARS.slice(0, 1)
  const s1 = new E.Sorter(one, 1, makeRng(1))
  check('只有 1 名角色时直接出结果', s1.getRanking().length === 1 && s1.currentPair === false)

  const two = CHARS.slice(0, 2)
  const s2 = new E.Sorter(two, 2, makeRng(2))
  s2.selectChar(0)
  check('2 名角色选完后结果长度 2', s2.getRanking().length === 2)
}

section('4. 剔除 / 回退 / 随机')
{
  const rng = makeRng(4242)
  const pool = CHARS.slice(0, 20)
  const truth = shuffle(pool, rng)
  const better = {}
  truth.forEach((c, i) => { better[c.id] = i })

  const sorter = new E.Sorter(pool, 5, rng)
  const gone = sorter.currentPair[0].id
  sorter.exclude(0)
  let again = false
  let guard = 0
  while (sorter.currentPair && guard++ < 100000) {
    const p = sorter.currentPair
    if (p[0].id === gone || p[1].id === gone) again = true
    if (!sorter.selectChar(better[p[0].id] <= better[p[1].id] ? 0 : 1)) break
  }
  check('被剔除的角色不再出现', !again)
  check('结果中不含被剔除的角色', sorter.getRanking().map(n => n.id).indexOf(gone) < 0)

  const s3 = new E.Sorter(pool, 4, makeRng(555))
  for (let i = 0; i < 5; i++) {
    const p = s3.currentPair
    if (!s3.selectChar(better[p[0].id] <= better[p[1].id] ? 0 : 1)) break
  }
  const before = s3.questionCount
  s3.previous()
  check('回退后题号回到上一题（净 −1）', s3.questionCount === before - 1)
  check('回退后 isPrevious 为真', s3.isPrevious === true)

  const s4 = new E.Sorter(CHARS.slice(0, 30), 5, makeRng(31337))
  s4.randomPickForAll()
  const r = s4.getRanking()
  check('随机作答能排满 5 名且不重复', r.length === 5 && new Set(r.map(n => n.id)).size === 5)
}

section('5. 偏好分析（标签 = 部队/企业/职业/武器/属性）')
{
  const pool = CHARS.slice(0, 60)
  const byId = {}
  CHARS.forEach(c => { byId[c.id] = c })
  const squad = pool[0].squad
  const same = pool.filter(c => c.squad === squad).slice(0, 8)
  const pref = E.tagPreference(same.map(c => c.id), pool.map(c => c.id), byId)
  check(`构造样本：${squad} 共 ${same.length} 名`, same.length > 0)
  check('偏好结果非空且按参考值降序',
    pref.length > 0 && pref.every((p, i) => i === 0 || pref[i - 1].value >= p.value))
  check('参考值均 > 0、占比在 [0,1]',
    pref.every(p => p.value > 0 && p.share >= 0 && p.share <= 1 && p.baseline >= 0 && p.baseline <= 1))
}

section('6. 数据集完整性')
{
  check('角色总数为 205', CHARS.length === 205, '实际 ' + CHARS.length)
  check('内部 id 唯一', new Set(CHARS.map(c => c.id)).size === CHARS.length)
  check('百科条目 id 唯一', new Set(CHARS.map(c => c.entryId)).size === CHARS.length)
  check('每条都有中文名', CHARS.every(c => c.name))
  const required = ['rarity', 'cls', 'company', 'burst', 'weapon', 'element', 'squad']
  required.forEach(f => {
    const empty = CHARS.filter(c => !c[f])
    check(`字段 ${f} 无缺失`, empty.length === 0, empty.map(c => c.name).slice(0, 5).join('、'))
  })
  check('稀有度取值只有 SSR/SR/R',
    CHARS.every(c => ['SSR', 'SR', 'R'].indexOf(c.rarity) >= 0))
  check('职业取值只有 火力型/防御型/辅助型',
    CHARS.every(c => ['火力型', '防御型', '辅助型'].indexOf(c.cls) >= 0))
  check('属性取值只有 5 种（已把「雷电」并入「电击」）',
    CHARS.every(c => ['燃烧', '水冷', '铁甲', '风压', '电击'].indexOf(c.element) >= 0))
  check('每条都有偏好分析用的 tags', CHARS.every(c => c.tags && c.tags.length >= 4))

  // 分组统计与逐一统计一致
  let groupOk = true
  let detail = ''
  DIMS.forEach(dim => {
    const counts = {}
    CHARS.forEach(c => { counts[c[dim]] = (counts[c[dim]] || 0) + 1 })
    const groups = (DATA.groups[dim] || [])
    groups.forEach(g => { if (g.count !== counts[g.value]) { groupOk = false; detail = dim + ' ' + g.value } })
    if (groups.reduce((s, g) => s + g.count, 0) !== CHARS.length) { groupOk = false; detail = dim + ' 合计不符' }
  })
  check('六个维度的分组计数与角色数据一致', groupOk, detail)

  // 联动
  const collab = CHARS.filter(c => c.collab)
  check('联动角色 24 名', collab.length === 24, '实际 ' + collab.length)
  check('联动来源覆盖 9 个 IP', (DATA.collabSources || []).length === 9,
    '实际 ' + (DATA.collabSources || []).length)
  check('非联动角色的 collabName 为空', CHARS.filter(c => !c.collab).every(c => !c.collabName))

  // 异格 / 换皮
  const variants = CHARS.filter(c => c.variant)
  check('异格（同名换皮）角色 47 名', variants.length === 47, '实际 ' + variants.length)
  check('每个异格都有本体名', variants.every(c => c.baseNameRaw))
  check('每个异格的本体都在数据集里（baseId 能找到）',
    variants.every(c => c.baseId > 0 && CHARS.some(x => x.id === c.baseId)),
    variants.filter(c => !c.baseId).map(c => c.name).join('、'))
  check('本体角色没有被误标为异格',
    CHARS.filter(c => !c.variant).every(c => !c.baseNameRaw && c.baseId === 0))
  check('去除异格后剩余 158 名本体', CHARS.filter(c => !c.variant).length === 158,
    '实际 ' + CHARS.filter(c => !c.variant).length)
  check('名字不含重名（换皮靠「：」区分）',
    new Set(CHARS.map(c => c.name)).size === CHARS.length)
  check('带全角冒号的角色都被标为异格',
    CHARS.filter(c => c.name.indexOf('：') >= 0).every(c => c.variant))
  check('安妮：奇迹仙女 的本体指向 N102',
    (() => { const v = CHARS.find(c => c.name === '安妮：奇迹仙女'); const b = CHARS.find(c => c.name === 'N102')
      return v && b && v.baseNameRaw === 'N102' && v.baseId === b.id })())

  // 头像
  const dir = path.join(__dirname, '..', 'assets', 'portraits')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'))
  const missing = CHARS.filter(c => !fs.existsSync(path.join(dir, c.entryId + '.png')) || fs.statSync(path.join(dir, c.entryId + '.png')).size < 2048)
  check('205 张角色图齐全（无缺失/空文件）', missing.length === 0,
    missing.map(c => c.name).slice(0, 5).join('、'))
  check('头像目录没有多余文件', files.length === CHARS.length,
    '文件 ' + files.length + ' / 角色 ' + CHARS.length)
}

console.log('\n' + '='.repeat(46))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
console.log('='.repeat(46))
process.exit(failed ? 1 : 0)
