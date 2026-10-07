/*
 * 胜利女神：NIKKE 妮姬喜好排序 —— 界面逻辑（无框架、无构建）
 *
 * 与明日方舟版（akrank）同一套排序引擎（js/engine.js，源自 uzkk/favorite），
 * 这里按 NIKKE 的数据结构改写了筛选树与卡片展示：
 *   稀有度 SSR/SR/R ｜ 职业 火力/防御/辅助 ｜ 企业 ｜ 爆裂阶段 ｜ 武器 ｜ 属性 ｜ 去除联动
 */
;(function () {
  'use strict'

  var DATA = window.AK_DATA
  var E = window.AKEngine
  if (!DATA || !E) {
    document.getElementById('app').innerHTML =
      '<div class="section"><p>数据或引擎加载失败，请确认 js/data.js 与 js/engine.js 存在。</p></div>'
    return
  }

  var app = document.getElementById('app')
  var CHARS = DATA.characters || DATA.operators || []
  var byId = {}
  CHARS.forEach(function (c) { byId[c.id] = c })

  // 筛选维度：键 -> 界面标题
  var DIMENSIONS = [
    { key: 'rarity', label: '按稀有度', short: 'short' },
    { key: 'cls', label: '按职业', short: 'medium' },
    { key: 'company', label: '按企业', short: 'medium' },
    { key: 'burst', label: '按爆裂阶段', short: 'short' },
    { key: 'weapon', label: '按武器', short: 'medium' },
    { key: 'element', label: '按属性', short: 'short' },
  ]
  var GROUPS = DATA.groups || {}
  var RANK_OPTIONS = [1, 5, 7, 10, 20, 50, 100]
  var LS_KEY = 'nikkerank.settings.v1'
  var AVATAR_BASE = 'assets/portraits/'

  function valuesOf (dim) {
    return (GROUPS[dim] || []).map(function (g) { return g.value })
  }
  function countsOf (dim) {
    return (GROUPS[dim] || []).map(function (g) { return g.count })
  }

  /* ------------------------------------------------------------------ *
   * 设置项（记忆到 localStorage）
   * ------------------------------------------------------------------ */
  function defaultSettings () {
    var s = { excludeCollab: false, excludeVariant: false, ranknum: 10 }
    DIMENSIONS.forEach(function (d) { s[d.key] = valuesOf(d.key).slice() })
    return s
  }

  function loadSettings () {
    var fallback = defaultSettings()
    try {
      var raw = localStorage.getItem(LS_KEY)
      if (!raw) return fallback
      var saved = JSON.parse(raw)
      if (!saved || saved.version !== 1) return fallback
      var s = saved.settings || {}
      var out = { excludeCollab: !!s.excludeCollab, excludeVariant: !!s.excludeVariant, ranknum: s.ranknum }
      DIMENSIONS.forEach(function (d) {
        var allowed = valuesOf(d.key)
        var picked = (s[d.key] || fallback[d.key]).filter(function (v) { return allowed.indexOf(v) >= 0 })
        out[d.key] = picked
      })
      if (out.ranknum === null || out.ranknum === undefined) out.ranknum = fallback.ranknum
      return out
    } catch (e) {
      return fallback
    }
  }

  function saveSettings (s) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ version: 1, settings: s }))
    } catch (e) { /* 隐私模式等场景下忽略 */ }
  }

  /* ------------------------------------------------------------------ *
   * 全局状态
   * ------------------------------------------------------------------ */
  var state = {
    view: 'settings',
    settings: loadSettings(),
    pool: [],
    sorter: null,
    ranking: [],
    questionCount: 0,
  }

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */
  function esc (str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function poolOperators () {
    var s = state.settings
    return CHARS.filter(function (c) {
      for (var i = 0; i < DIMENSIONS.length; i++) {
        var d = DIMENSIONS[i]
        if (s[d.key].indexOf(c[d.key]) < 0) return false
      }
      if (s.excludeCollab && c.collab) return false
      if (s.excludeVariant && c.variant) return false
      return true
    })
  }

  function avatarPath (op) { return AVATAR_BASE + op.entryId + '.png' }

  function metaLine (op) {
    return op.cls + ' · ' + op.rarity + ' · ' + op.burst + ' · ' + op.element
  }

  function estimateText (poolSize, ranknum) {
    if (poolSize <= 1) return '已选择 ' + poolSize + ' 名角色，无需作答即可出结果。'
    var n = ranknum === Infinity ? poolSize : Math.min(ranknum, poolSize)
    var raw = E.estimateQuestions(poolSize, ranknum)
    var rounded = Math.max(10, Math.round(raw / 10) * 10)
    return '预计需要回答约 <b class="emphasize">' + rounded + '</b> 轮：确定第 1 名要淘汰其余 ' +
      (poolSize - 1) + ' 名，之后每确定一名约需 log₂' + poolSize + ' ≈ ' +
      Math.ceil(Math.log(poolSize) / Math.LN2) + ' 轮' +
      (n >= poolSize ? '（全部排序题量很大，建议先选较小的排名数）' : '') + '。'
  }

  /* ------------------------------------------------------------------ *
   * 视图：设置
   * ------------------------------------------------------------------ */
  function renderSettings () {
    var s = state.settings
    var pool = poolOperators()
    var allOn = DIMENSIONS.every(function (d) { return s[d.key].length === valuesOf(d.key).length })

    var groupsHtml = DIMENSIONS.map(function (d) {
      var values = valuesOf(d.key)
      var counts = countsOf(d.key)
      var allPicked = s[d.key].length === values.length
      var items = (GROUPS[d.key] || []).map(function (g) {
        var checked = s[d.key].indexOf(g.value) >= 0
        return '<li class="inline ' + d.short + '">' +
          '<label class="checkbox' + (checked ? ' checked' : '') + '">' +
          '<span class="box"></span>' +
          '<input type="checkbox" data-dim="' + d.key + '" data-value="' + esc(g.value) + '"' +
          (checked ? ' checked' : '') + '>' +
          '<span class="label">' + esc(g.name) + '</span>' +
          '<span class="count">' + g.count + '</span></label></li>'
      }).join('')
      return '<li>' +
        '<p><label class="checkbox' + (allPicked ? ' checked' : '') + '">' +
        '<span class="box"></span><input type="checkbox" data-dim-all="' + d.key + '"' +
        (allPicked ? ' checked' : '') + '><span class="label">' + d.label + '</span></label></p>' +
        '<ul class="inline-list">' + items + '</ul></li>'
    }).join('')

    var collabCount = CHARS.filter(function (c) { return c.collab }).length
    var collabTip = collabCount
      ? '联动角色 ' + collabCount + ' 名：' + (DATA.collabSources || []).map(function (c) {
        return c.name + ' ' + c.count
      }).join('、') + '；勾选后这些不参与测试'
      : '联动角色'

    var variantCount = CHARS.filter(function (c) { return c.variant }).length
    var variantSample = CHARS.filter(function (c) { return c.variant }).slice(0, 4)
      .map(function (c) { return c.name }).join('、')
    var variantTip = variantCount
      ? '同名换皮版本 ' + variantCount + ' 名（如 ' + variantSample + ' 等）；' +
        '勾选后只保留本体，参测 ' + CHARS.filter(function (c) { return !c.variant }).length + ' 名'
      : '同名换皮版本'

    var rankItems = RANK_OPTIONS.filter(function (n) { return n <= pool.length || !pool.length })
      .map(function (n) {
        return '<li class="inline short"><label class="radio' + (s.ranknum === n ? ' checked' : '') + '">' +
          '<span class="box"></span><input type="radio" name="ranknum" data-ranknum="' + n + '"' +
          (s.ranknum === n ? ' checked' : '') + '><span class="label">' + n + '</span></label></li>'
      }).join('')

    var html = '' +
      '<div class="favorite">' +
      '  <div class="section">' +
      '    <p class="title"><label class="checkbox' + (allOn ? ' checked' : '') + '">' +
      '      <span class="box"></span><input type="checkbox" data-all="1"' + (allOn ? ' checked' : '') + '>' +
      '      <span class="label">所有妮姬</span></label></p>' +
      '    <ul>' + groupsHtml + '</ul>' +
      '  </div>' +

      '  <div class="section">' +
      '    <p class="list"><span>其他选项：</span>' +
      '      <ul class="inline-list">' +
      '      <li class="inline long">' +
      '        <label class="checkbox' + (s.excludeVariant ? ' checked' : '') + '" title="' + esc(variantTip) + '">' +
      '          <span class="box"></span><input type="checkbox" data-exclude-variant="1"' +
      (s.excludeVariant ? ' checked' : '') + '>' +
      '          <span class="label">去除异格角色</span><span class="count">' + variantCount + '</span></label>' +
      '      </li>' +
      '      <li class="inline long">' +
      '        <label class="checkbox' + (s.excludeCollab ? ' checked' : '') + '" title="' + esc(collabTip) + '">' +
      '          <span class="box"></span><input type="checkbox" data-exclude-collab="1"' +
      (s.excludeCollab ? ' checked' : '') + '>' +
      '          <span class="label">去除联动角色</span><span class="count">' + collabCount + '</span></label>' +
      '      </li>' +
      '      </ul>' +
      '    </p>' +
      '    <p class="comment">已选择 <b class="emphasize">' + pool.length + '</b> 名角色参与测试' +
      (pool.length ? '' : '（请至少在每个维度里勾选一项）') + '</p>' +
      '    <hr>' +
      '    <p class="list"><span>选择排名数：</span>' +
      '      <ul class="inline-list">' + rankItems +
      '        <li class="inline short"><label class="radio' + (s.ranknum === Infinity ? ' checked' : '') + '">' +
      '          <span class="box"></span><input type="radio" name="ranknum" data-ranknum="all"' +
      (s.ranknum === Infinity ? ' checked' : '') + '>' +
      '<span class="label">全选 (' + pool.length + ')</span></label></li>' +
      '      </ul>' +
      '    </p>' +
      '    <p class="comment">' + estimateText(pool.length, s.ranknum) + '</p>' +
      '  </div>' +

      '  <div class="button-container">' +
      '    <button class="btn' + (pool.length ? '' : ' disabled') + '" data-act="start"' +
      (pool.length ? '' : ' disabled') + '>开始测试</button>' +
      '    <button class="btn warning" data-act="reset">恢复默认设置</button>' +
      '    <button class="btn" data-act="about">关于本命测试</button>' +
      '  </div>' +
      '</div>'

    app.innerHTML = html
  }

  /* ------------------------------------------------------------------ *
   * 视图：二择
   * ------------------------------------------------------------------ */
  function renderQuiz () {
    var sorter = state.sorter
    var pair = sorter.currentPair
    if (!pair) {
      state.ranking = sorter.getRanking()
      state.questionCount = sorter.questionCount
      state.view = 'result'
      return renderResult()
    }

    var cards = pair.map(function (node, index) {
      var op = node.meta
      return '<td>' +
        '<div class="char-view loading" data-pick="' + index + '">' +
        '  <img src="' + esc(avatarPath(op)) + '" alt="' + esc(node.name) + '">' +
        '  <div class="mask"><i class="spinner"></i></div>' +
        '  <div class="info"><div class="name">' + esc(node.name) + '</div>' +
        '    <div class="nick">' + esc(op.squad) + '</div>' +
        '    <div class="meta">' + esc(metaLine(op)) + '</div>' +
        '  </div>' +
        '</div></td>'
    }).join('')

    var html = '' +
      '<div class="favorite">' +
      '  <h3 class="tac">第 ' + sorter.questionCount + ' 轮：请<span class="emphasize">点击图片</span>选择更喜欢的妮姬</h3>' +
      (sorter.currentRank > 0 ? '<h4 class="tac">排名第 ' + sorter.currentRank + ' 的角色已经确定</h4>' : '') +
      '  <table class="tac quiz-table">' +
      '    <tr class="characters">' + cards + '</tr>' +
      '    <tr>' +
      '      <td><button class="btn" data-act="exclude0" title="将左边的角色从剩余名单中剔除">不再出现左边的角色</button></td>' +
      '      <td><button class="btn" data-act="exclude1" title="将右边的角色从剩余名单中剔除">不再出现右边的角色</button></td>' +
      '    </tr>' +
      '    <tr>' +
      '      <td><button class="btn" data-act="excludeBoth" title="将两边的角色都从剩余名单中剔除">不再出现这两个角色</button></td>' +
      '      <td><button class="btn" data-act="previous" title="重新作答上一题"' +
      (sorter.questionCount === 1 || sorter.isPrevious ? ' disabled' : '') + '>等下，选错了……</button></td>' +
      '    </tr>' +
      '    <tr>' +
      '      <td><button class="btn" data-act="randomPick" title="本题随机作答">随便替我选个叭</button></td>' +
      '      <td><button class="btn" data-act="randomPickAll" title="本题及之后的所有题都随机作答">累了，之后都随便选叭</button></td>' +
      '    </tr>' +
      '    <tr><td colspan="2"><button class="btn warning" data-act="backToSettings" title="返回主界面">返回主界面</button></td></tr>' +
      '  </table>' +
      '  <p class="comment tac keyboard-hint">快捷键：<kbd>1</kbd> / <kbd>←</kbd> 选左边，<kbd>2</kbd> / <kbd>→</kbd> 选右边，' +
      '<kbd>Backspace</kbd> 退回上一题</p>' +
      '</div>'

    app.innerHTML = html
  }

  /* ------------------------------------------------------------------ *
   * 视图：结果
   * ------------------------------------------------------------------ */
  function renderResult () {
    var nodes = state.ranking

    function card (node, rank) {
      var op = node.meta
      return '<div class="char-view result' + (rank === 1 ? ' first' : '') + '">' +
        '<div class="rank">第 ' + rank + ' 位</div>' +
        '<img src="' + esc(avatarPath(op)) + '" alt="' + esc(node.name) + '">' +
        '<div class="info"><div class="name">' + esc(node.name) + '</div>' +
        '<div class="nick">' + esc(op.squad) + '</div>' +
        '<div class="meta">' + esc(op.cls + ' · ' + op.rarity + ' · ' + op.burst) + '</div></div>' +
        '</div>'
    }

    var rows = ''
    if (nodes.length) {
      rows = '<div class="row row-first">' + card(nodes[0], 1) + '</div>' +
        (nodes.length > 1
          ? '<div class="row">' + nodes.slice(1).map(function (n, i) { return card(n, i + 2) }).join('') + '</div>'
          : '')
    }

    var tableRows = nodes.map(function (node, i) {
      var op = node.meta
      return '<tr><td class="index">' + (i + 1) + '</td>' +
        '<td class="name">' + esc(node.name) + '</td>' +
        '<td class="nick">' + esc(op.squad) + '</td>' +
        '<td class="prof">' + esc(op.cls) + '</td>' +
        '<td class="rarity">' + esc(op.rarity) + '</td>' +
        '<td class="prof">' + esc(op.burst) + '</td>' +
        '<td class="prof">' + esc(op.element) + '</td></tr>'
    }).join('')

    var prefer = E.tagPreference(
      nodes.map(function (n) { return n.id }),
      state.pool.map(function (o) { return o.id }),
      byId
    )

    var prefHtml
    if (nodes.length < 7) {
      prefHtml = '<p>排名数量过少（少于 7 名），不予统计。</p>'
    } else if (!prefer.length) {
      prefHtml = '<p>未找到明显的偏好，你的口味相当均衡。</p>'
    } else {
      var high = prefer.filter(function (p) { return p.value >= 0.2 })
      prefHtml = '' +
        (high.length
          ? '<div class="tac high-pref-box"><p>从你的选择来看，你极有可能是：</p><p>' +
            high.map(function (p) { return '<span class="high-pref">' + esc(p.name) + '控</span>' }).join('') +
            '</p></div>'
          : '') +
        '<table class="result"><tr><th>标签</th><th>命中人数</th><th>你的占比</th><th>全体占比</th><th>参考值</th></tr>' +
        prefer.map(function (p) {
          return '<tr><td>' + esc(p.name) + '</td><td>' + p.count + '</td>' +
            '<td>' + (p.share * 100).toFixed(1) + '%</td>' +
            '<td>' + (p.baseline * 100).toFixed(1) + '%</td>' +
            '<td>' + p.value.toFixed(3) + '</td></tr>'
        }).join('') +
        '</table>' +
        '<p class="comment">参考值 = 该标签在你前 ' + nodes.length + ' 名中的加权占比 − 在全部参测角色中的占比，' +
        '大于 0 表示你比随机情况更偏爱这个标签。标签取自角色所属部队、企业、职业、武器与属性。</p>'
    }

    var html = '' +
      '<div class="favorite">' +
      '  <h2 class="tac">您的前 ' + nodes.length + ' 位本命妮姬排行</h2>' +
      '  <div class="ranking">' + rows + '</div>' +

      '  <details class="section collapse-view" open>' +
      '    <summary><h3>测试结果</h3></summary>' +
      '    <p>' + (state.pool.length <= 1
        ? '本次只有 <b>1</b> 名角色参测，无需作答。'
        : '本次测试中，您通过 <b>' + state.questionCount + '</b> 轮回答，从共计 <b>' + state.pool.length +
          '</b> 名角色中选出了前 <b>' + nodes.length + '</b> 名。') + '</p>' +
      '    <table class="result">' +
      '      <tr><th class="index">排名</th><th class="name">角色</th><th class="nick">部队</th>' +
      '      <th class="prof">职业</th><th class="rarity">稀有度</th><th class="prof">阶段</th>' +
      '      <th class="prof">属性</th></tr>' +
      tableRows +
      '    </table>' +
      '    <p class="tac"><button class="btn small" data-act="copy">复制结果（纯文本）</button></p>' +
      '  </details>' +

      '  <details class="section collapse-view" open>' +
      '    <summary><h3>偏好分析</h3></summary>' + prefHtml +
      '  </details>' +

      '  <div class="button-container">' +
      '    <button class="btn warning" data-act="backToSettings">返回主界面</button>' +
      '    <button class="btn" data-act="restart">用同样的设置再来一次</button>' +
      '    <button class="btn" data-act="about">关于本命测试</button>' +
      '  </div>' +
      '</div>'

    app.innerHTML = html
  }

  /* ------------------------------------------------------------------ *
   * 视图切换与测试流程
   * ------------------------------------------------------------------ */
  function render () {
    if (state.view === 'settings') renderSettings()
    else if (state.view === 'quiz') renderQuiz()
    else renderResult()
    window.scrollTo(0, 0)
  }

  function startQuiz () {
    var pool = poolOperators()
    if (!pool.length) return
    state.pool = pool
    var maxRank = pool.length
    if (state.settings.ranknum !== Infinity && state.settings.ranknum > maxRank) {
      var candidates = RANK_OPTIONS.filter(function (n) { return n <= maxRank })
      state.settings.ranknum = candidates.length ? candidates[candidates.length - 1] : 1
    }
    saveSettings(state.settings)
    state.sorter = new E.Sorter(pool, state.settings.ranknum)
    state.view = 'quiz'
    prefetch(pool)
    if (!state.sorter.currentPair) {
      state.ranking = state.sorter.getRanking()
      state.questionCount = state.sorter.questionCount
      state.view = 'result'
    }
    render()
  }

  var prefetching = false
  function prefetch (pool) {
    if (prefetching) return
    prefetching = true
    var i = 0
    function next () {
      if (i >= pool.length) return
      var img = new Image()
      img.src = avatarPath(pool[i++])
      setTimeout(next, 0)
    }
    next()
  }

  function finishIfDone (advanced) {
    if (advanced) { renderQuiz(); return }
    state.ranking = state.sorter.getRanking()
    state.questionCount = state.sorter.questionCount
    state.view = 'result'
    render()
  }

  function rankingText () {
    var lines = ['胜利女神：NIKKE 妮姬喜好排序 · 我的前 ' + state.ranking.length + ' 名']
    state.ranking.forEach(function (node, i) {
      var op = node.meta
      lines.push((i + 1) + '. ' + node.name + '（' + op.squad + '，' + metaLine(op) + '）')
    })
    lines.push('参测角色 ' + state.pool.length + ' 名，共回答 ' + state.questionCount + ' 轮。')
    return lines.join('\n')
  }

  /* ------------------------------------------------------------------ *
   * 事件
   * ------------------------------------------------------------------ */
  app.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act], [data-pick]') : null
    if (!el) return

    if (el.hasAttribute('data-pick') && state.view === 'quiz') {
      finishIfDone(state.sorter.selectChar(Number(el.getAttribute('data-pick'))))
      return
    }

    var act = el.getAttribute('data-act')
    if (!act) return

    if (act === 'start' || act === 'restart') { startQuiz(); return }
    if (act === 'about') { window.location.href = 'about.html'; return }
    if (act === 'backToSettings') { state.view = 'settings'; render(); return }
    if (act === 'reset') { state.settings = defaultSettings(); saveSettings(state.settings); render(); return }

    if (state.view === 'result') {
      if (act === 'copy') {
        var text = rankingText()
        function done (ok) {
          var btn = app.querySelector('[data-act="copy"]')
          if (!btn) return
          btn.textContent = ok ? '已复制到剪贴板' : '复制失败，请手动选中表格'
          setTimeout(function () { btn.textContent = '复制结果（纯文本）' }, 2000)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true) }, function () { done(false) })
        } else {
          var ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          try { done(document.execCommand('copy')) } catch (e) { done(false) }
          document.body.removeChild(ta)
        }
        return
      }
      return
    }

    if (state.view !== 'quiz') return
    var sorter = state.sorter
    if (act === 'exclude0') finishIfDone(sorter.exclude(0))
    else if (act === 'exclude1') finishIfDone(sorter.exclude(1))
    else if (act === 'excludeBoth') finishIfDone(sorter.exclude(0, 1))
    else if (act === 'previous') finishIfDone(sorter.previous())
    else if (act === 'randomPick') finishIfDone(sorter.randomPick())
    else if (act === 'randomPickAll') finishIfDone(sorter.randomPickForAll())
  })

  app.addEventListener('change', function (ev) {
    var t = ev.target
    if (!t || !t.matches) return
    var s = state.settings

    if (t.matches('[data-all]')) {
      DIMENSIONS.forEach(function (d) { s[d.key] = t.checked ? valuesOf(d.key).slice() : [] })
      saveSettings(s); renderSettings(); return
    }
    var allDim = t.getAttribute && t.getAttribute('data-dim-all')
    if (allDim) {
      s[allDim] = t.checked ? valuesOf(allDim).slice() : []
      saveSettings(s); renderSettings(); return
    }
    var dim = t.getAttribute && t.getAttribute('data-dim')
    if (dim) {
      var v = t.getAttribute('data-value')
      var i = s[dim].indexOf(v)
      if (t.checked && i < 0) s[dim].push(v)
      if (!t.checked && i >= 0) s[dim].splice(i, 1)
      s[dim].sort(function (a, b) { return valuesOf(dim).indexOf(a) - valuesOf(dim).indexOf(b) })
      saveSettings(s); renderSettings(); return
    }
    if (t.matches('[data-exclude-variant]')) {
      s.excludeVariant = t.checked
      saveSettings(s); renderSettings(); return
    }
    if (t.matches('[data-exclude-collab]')) {
      s.excludeCollab = t.checked
      saveSettings(s); renderSettings(); return
    }
    if (t.matches('[data-ranknum]')) {
      var rv = t.getAttribute('data-ranknum')
      s.ranknum = rv === 'all' ? Infinity : Number(rv)
      saveSettings(s); renderSettings()
    }
  })

  /* 头像加载完成后去掉转圈遮罩 */
  document.addEventListener('load', function (ev) {
    var t = ev.target
    if (!t || t.tagName !== 'IMG') return
    if (t.parentNode && t.parentNode.classList) t.parentNode.classList.remove('loading')
  }, true)
  document.addEventListener('error', function (ev) {
    var t = ev.target
    if (!t || t.tagName !== 'IMG') return
    if (t.parentNode && t.parentNode.classList) {
      t.parentNode.classList.remove('loading')
      t.parentNode.classList.add('broken')
    }
  }, true)

  /* 键盘快捷键 */
  document.addEventListener('keydown', function (ev) {
    if (state.view !== 'quiz') return
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return
    var sorter = state.sorter
    if (!sorter) return
    var key = ev.key
    if (key === '1' || key === 'ArrowLeft') { ev.preventDefault(); finishIfDone(sorter.selectChar(0)) }
    else if (key === '2' || key === 'ArrowRight') { ev.preventDefault(); finishIfDone(sorter.selectChar(1)) }
    else if (key === 'Backspace') {
      if (sorter.questionCount === 1 || sorter.isPrevious) return
      ev.preventDefault()
      finishIfDone(sorter.previous())
    } else if (key === 'r' || key === 'R') { ev.preventDefault(); finishIfDone(sorter.randomPick()) }
  })

  render()
})()
