/*
 * 明日方舟干员喜好排序 —— 排序引擎
 *
 * 算法与数据结构移植自 uzkk/favorite（MIT，作者 Shigma）：
 *   lib/utils/SortNode.ts     -> SortNode
 *   lib/utils/BackupTree.ts   -> BackupTree
 *   lib/utils/sort.mixin.ts   -> Sorter
 *   lib/utils/index.ts        -> tagPreference / estimateQuestions
 *
 * 原理：Pairwise Comparison（两两比较）+ 二叉树二分插入。
 *   根节点的 children 是「还没输过的候选池」，每答一题就把败者挂到胜者名下，
 *   候选池只剩一个时向下钻取，从而依次确定第 1、2、3…… 名。
 *   确定第 1 名需要 N−1 轮（其余每人都要被淘汰一次），其后每名约需 log₂N 轮。
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.AKEngine = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  /* ------------------------------------------------------------------ *
   * SortNode：排序树节点
   * ------------------------------------------------------------------ */
  function SortNode(id, name, nick, meta, tags) {
    this.id = id === undefined ? 0 : id
    this.name = name || ''
    this.nick = nick || ''
    this.meta = meta || {}
    this.tags = tags || []
    this.isEven = false
    this.parent = null
    this.children = []
  }

  SortNode.fromOperator = function (op) {
    return new SortNode(op.id, op.name, op.nick, op, op.tags)
  }

  SortNode.prototype.clone = function () {
    var node = new SortNode(this.id, this.name, this.nick, this.meta, this.tags)
    node.isEven = this.isEven
    return node
  }

  /** 当前排名（根节点为 0） */
  SortNode.prototype.rank = function () {
    if (!this.parent) return 0
    return this.isEven ? this.parent.rank() : this.level()
  }

  /** 节点深度 */
  SortNode.prototype.level = function () {
    if (!this.parent) return 0
    return this.parent.level() + 1
  }

  /**
   * 把 child 挂到当前节点下（child 会先脱离原父节点）
   * doEvenAction：并列处理，把当前节点的所有子节点转挂到 child 下
   */
  SortNode.prototype.add = function (child, doEvenAction) {
    if (child.parent) {
      var siblings = child.parent.children
      var idx = siblings.indexOf(child)
      if (idx >= 0) siblings.splice(idx, 1)
    }
    if (doEvenAction) {
      var copies = this.children.splice(0, this.children.length)
      for (var i = copies.length - 1; i >= 0; i--) {
        copies[i].parent = child
      }
      child.children.push.apply(child.children, copies)
    }
    this.children.push(child)
    child.parent = this
  }

  /** 从树中移除当前节点（其子节点上交给父节点） */
  SortNode.prototype.remove = function () {
    while (this.children.length > 0) {
      this.parent.add(this.children[0], false)
    }
    var idx = this.parent.children.indexOf(this)
    if (idx >= 0) this.parent.children.splice(idx, 1)
    this.parent = null
  }

  /** 全树按 id 查找节点 */
  SortNode.prototype.findSortObjectById = function (id) {
    if (this.id === id) return this
    for (var i = 0; i < this.children.length; i++) {
      var found = this.children[i].findSortObjectById(id)
      if (found !== null) return found
    }
    return null
  }

  /* ------------------------------------------------------------------ *
   * BackupTree：只记录 id / isEven 的轻量快照，用于「选错了」回退
   * ------------------------------------------------------------------ */
  function BackupTree(byId) {
    this.byId = byId || null
    this.nodes = []
    this.cTree = null
  }

  BackupTree.prototype.setup = function (root) {
    this.cTree = new SortNode(0)
    this.nodes = []
    this.init(root, this)
    return this
  }

  BackupTree.prototype.init = function (node, tree) {
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i]
      var branch = new BackupTree(this.byId)
      branch.id = child.id
      branch.isEven = child.isEven
      tree.nodes.push(branch)
      this.init(child, branch)
    }
  }

  BackupTree.prototype.restore = function (idTree, cNode) {
    idTree = idTree || this
    cNode = cNode || this.cTree
    for (var i = 0; i < idTree.nodes.length; i++) {
      var branch = idTree.nodes[i]
      var op = this.byId ? this.byId[branch.id] : null
      if (!op) continue // 干员已不在数据集中（理论上不会发生）
      var node = SortNode.fromOperator(op)
      node.isEven = branch.isEven
      cNode.add(node, false)
      this.restore(branch, node)
    }
    return this.cTree
  }

  /* ------------------------------------------------------------------ *
   * Sorter：一局测试的完整状态机
   * ------------------------------------------------------------------ */
  function Sorter(pool, ranknum, random) {
    this.ranknum = ranknum === undefined ? 1 : ranknum
    // 随机源可注入，便于测试用固定种子复现；站点默认用 Math.random
    this.random = typeof random === 'function' ? random : Math.random
    this.byId = {}
    this.root = new SortNode(0)
    for (var i = 0; i < pool.length; i++) {
      var op = pool[i]
      this.byId[op.id] = op
      this.root.add(SortNode.fromOperator(op))
    }
    this.currentPair = []
    this.questionCount = 1
    this.currentRank = 0
    this.isPrevious = false
    this.backupPair = null
    this.backupTree = null
    this.init()
  }

  Sorter.prototype.init = function () {
    this.currentPair = this.ask(this.root)
    this.backupTree = new BackupTree(this.byId).setup(this.root)
  }

  Sorter.prototype.backup = function () {
    this.backupPair = this.currentPair.slice()
    this.backupTree.setup(this.root)
  }

  Sorter.prototype.restore = function () {
    this.currentPair = this.backupPair.slice()
    this.backupPair = null
    this.currentRank = 0
    this.root = this.backupTree.restore()
  }

  /** 取下一对题目；返回 false 表示测试结束 */
  Sorter.prototype.ask = function (node, pair) {
    if (pair) {
      var left = node.findSortObjectById(pair[0].id)
      var right = node.findSortObjectById(pair[1].id)
      if (left !== null && right !== null) return [left, right]
    }
    if (node.children.length === 0) return false
    if (node.children.length === 1) {
      this.currentRank = node.level() + 1
      return this.ask(node.children[0])
    }
    var both = [0, 0]
    while (both[0] === both[1]) {
      for (var i = 0; i < 2; i++) {
        both[i] = Math.floor(this.random() * node.children.length)
      }
    }
    return [node.children[both[0]], node.children[both[1]]]
  }

  Sorter.prototype.getNextPair = function (back) {
    this.currentPair = back ? this.ask(this.root, this.currentPair) : this.ask(this.root)
    if (this.currentPair && this.currentPair[1].level() <= this.ranknum) {
      this.questionCount += 1
      return true
    }
    return false
  }

  Sorter.prototype.moveOn = function (back) {
    return this.getNextPair(back)
  }

  /** 选择更喜欢的那个（index 为 0 或 1） */
  Sorter.prototype.selectChar = function (index) {
    this.backup()
    this.currentPair[index].add(this.currentPair[1 - index], false)
    this.isPrevious = false
    return this.moveOn(false)
  }

  /** 让指定一侧的干员不再出现（index 可为多个，如 (0, 1)） */
  Sorter.prototype.exclude = function () {
    this.backup()
    for (var i = 0; i < arguments.length; i++) {
      this.currentPair[arguments[i]].remove()
    }
    this.isPrevious = false
    return this.moveOn(false)
  }

  /** 回到上一题重答 */
  Sorter.prototype.previous = function () {
    this.restore()
    this.questionCount -= 2
    this.isPrevious = true
    return this.moveOn(true)
  }

  Sorter.prototype.randomPick = function () {
    return this.selectChar(Math.floor(this.random() * 2))
  }

  /** 本题及之后全部随机作答 */
  Sorter.prototype.randomPickForAll = function () {
    var index = Math.floor(this.random() * 2)
    this.currentPair[index].add(this.currentPair[1 - index], false)
    var pair = this.ask(this.root)
    while (pair && pair[1].level() <= this.ranknum) {
      this.questionCount += 1
      index = Math.floor(this.random() * 2)
      pair[index].add(pair[1 - index], false)
      pair = this.ask(this.root)
    }
    this.isPrevious = false
    return this.moveOn(false)
  }

  /** 测试是否已结束（selectChar 等返回 false 即结束） */
  Sorter.prototype.isFinished = function () {
    return !this.currentPair
  }

  /** 取最终排名（返回 SortNode 数组，长度最多为 ranknum） */
  Sorter.prototype.getRanking = function () {
    var ranking = []
    var node = this.root
    for (var i = 0; i < this.ranknum; i++) {
      node = node.children[0]
      if (!node) break
      ranking.push(node)
    }
    return ranking
  }

  /* ------------------------------------------------------------------ *
   * 题量预估
   *
   * 这个算法是「依次淘汰」：确定第 1 名必须让其余每个人都输一次，所以要
   * poolSize − 1 轮；之后每确定一名，都是在前一名击败过的对手里二分插入，
   * 约需 log₂(poolSize) 轮。全排序约需 poolSize · log₂(poolSize) 轮。
   * ------------------------------------------------------------------ */
  function estimateQuestions(poolSize, ranknum) {
    if (poolSize <= 1) return 0
    var n = ranknum === Infinity ? poolSize : Math.min(ranknum, poolSize)
    var perRank = Math.ceil(Math.log(poolSize) / Math.LN2) + 4
    return (poolSize - 1) + Math.max(0, n - 1) * perRank
  }

  /* ------------------------------------------------------------------ *
   * 偏好标签分析
   *
   * 原版用「你的人气排名 vs 官方人气投票」计算偏好值；明日方舟没有可用的
   * 权威人气基线，因此改为「你的前 N 名 vs 整个候选池」的对比：
   *   w_i = 1 / (1 + i)                      第 i 名的权重（i 从 0 开始）
   *   S_k = Σ_{i∈前N且带标签k} w_i / Σ_i w_i   标签 k 在前 N 名中的加权占比
   *   B_k = 候选池中带标签 k 的干员数 / 候选池人数   随机情况下的期望占比
   *   参考值 = S_k - B_k                       > 0 表示你对这个标签有超出平均的偏好
   * ------------------------------------------------------------------ */
  function tagPreference(rankingIds, poolIds, byId) {
    var denominator = 0
    var i
    for (i = 0; i < rankingIds.length; i++) denominator += 1 / (1 + i)

    var inRanking = {}
    for (i = 0; i < rankingIds.length; i++) inRanking[rankingIds[i]] = 1

    var tagScore = {}
    var tagTotal = {}
    var tagPool = {}
    var poolSize = poolIds.length || 1

    for (i = 0; i < poolIds.length; i++) {
      var poolOp = byId[poolIds[i]]
      if (!poolOp) continue
      for (var t = 0; t < poolOp.tags.length; t++) {
        var tag = poolOp.tags[t]
        tagPool[tag] = (tagPool[tag] || 0) + 1
      }
    }

    for (i = 0; i < rankingIds.length; i++) {
      var op = byId[rankingIds[i]]
      if (!op) continue
      var weight = 1 / (1 + i)
      for (var j = 0; j < op.tags.length; j++) {
        var key = op.tags[j]
        tagScore[key] = (tagScore[key] || 0) + weight
        tagTotal[key] = (tagTotal[key] || 0) + 1
      }
    }

    var result = []
    for (var name in tagScore) {
      if (!Object.prototype.hasOwnProperty.call(tagScore, name)) continue
      var share = tagScore[name] / denominator
      var baseline = (tagPool[name] || 0) / poolSize
      result.push({
        tag: name,
        name: name,
        count: tagTotal[name],
        share: share,
        baseline: baseline,
        value: share - baseline,
      })
    }
    return result
      .filter(function (p) { return p.value > 0 })
      .sort(function (a, b) { return b.value - a.value })
  }

  return {
    SortNode: SortNode,
    BackupTree: BackupTree,
    Sorter: Sorter,
    tagPreference: tagPreference,
    estimateQuestions: estimateQuestions,
  }
})
