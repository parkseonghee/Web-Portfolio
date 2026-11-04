/* 필름 스트립 — 게임 플레이 이력 · 공부 계획 페이지
   - 데이터는 js/records.js (PLAY_HISTORY / STUDY_PLAN / STUDY_LOG) 그대로
   - 패널 안에 스크롤이 생기지 않게 목록은 쪽 넘김(◀ ▶), 단원은 챕터를 누르면 컷 위에 펼친다
   - 내용 높이가 바뀌면 "film:refit" 이벤트로 filmstrip.js에 다시 맞추라고 알린다 */
(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stat(value, label) {
    return "<li><b>" + esc(value) + "</b><span>" + esc(label) + "</span></li>";
  }
  function refit(el) { document.dispatchEvent(new CustomEvent("film:refit", { detail: el })); } // el이 든 페이지만 다시 맞춤

  /* ---------- 게임 플레이 이력 ---------- */
  // "121.4시간", "119분", "2026.07 ~ 2026.09 (89.0시간 / 37일)" → 분. 시간 기록이 없으면 0
  function toMinutes(text) {
    var h = /([\d.]+)시간/.exec(text);
    if (h) return parseFloat(h[1]) * 60;
    var m = /(\d+)분/.exec(text);
    return m ? parseInt(m[1], 10) : 0;
  }
  function isRoguelike(genre) { return /로그라이[크트]/.test(genre); }

  function initPlayHistory() {
    if (typeof PLAY_HISTORY === "undefined" || !document.getElementById("phList")) return;
    var data = PLAY_HISTORY;
    var PAGE_SIZE = 6; // 2열 × 3줄
    var list = document.getElementById("phList");
    var empty = document.getElementById("phEmpty");
    var note = document.getElementById("phNote");
    var search = document.getElementById("phSearch");
    var prev = document.getElementById("phPrev");
    var next = document.getElementById("phNext");
    var pageNum = document.getElementById("phPage");
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-scene="play-history"] .seg-btn'));
    var platform = "pc";
    var page = 0;

    var pcMinutes = data.pc.reduce(function (sum, g) { return sum + toMinutes(g[2]); }, 0);
    var rogueCount = data.pc.concat(data.mobile).filter(function (g) { return isRoguelike(g[3]); }).length;
    document.getElementById("phStats").innerHTML =
      stat(data.pc.length + "종", "PC (Steam) · 누적 약 " + Math.round(pcMinutes / 60) + "시간") +
      stat(data.mobile.length + "종", "모바일 · Play 게임즈 기록 153종 중 상위") +
      stat(rogueCount + "종", "로그라이크 계열 · 로그타워 개발에 직접 참고");

    function render() {
      var games = data[platform];
      var q = search.value.trim().toLowerCase();
      var max = games.reduce(function (m, g) { return Math.max(m, toMinutes(g[2])); }, 1);
      var matched = [];
      var rank = 0; // 배지가 있는 고정 항목은 순위에서 뺀다
      games.forEach(function (g) {
        var n = g[5] ? 0 : ++rank; // 검색과 상관없이 순위는 전체 목록 기준
        if (q && (g[0] + " " + g[3]).toLowerCase().indexOf(q) === -1) return;
        matched.push([g, n]);
      });
      var pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
      page = Math.min(page, pages - 1);

      list.innerHTML = matched.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(function (item) {
        var g = item[0], n = item[1];
        var name = g[1]
          ? '<a href="' + esc(g[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(g[0]) + " ↗</a>"
          : esc(g[0]);
        var bar = platform === "pc"
          ? '<span class="game-bar" aria-hidden="true"><span style="width:' + Math.max(2, toMinutes(g[2]) / max * 100).toFixed(1) + '%"></span></span>'
          : "";
        return '<li class="game">' +
          '<span class="game-rank">' + (n || "") + "</span>" +
          '<div class="game-main">' +
            '<div class="game-head"><h3 class="game-name">' + name + "</h3>" +
              (g[5] ? '<span class="pill">' + esc(g[5]) + "</span>" : "") +
              '<span class="game-genre">' + esc(g[3]) + "</span></div>" +
            '<p class="game-time">' + esc(g[2]) + "</p>" + bar +
            '<p class="game-desc" title="' + esc(g[4]) + '">' + esc(g[4]) + "</p>" +
          "</div></li>";
      }).join("");
      empty.hidden = matched.length > 0;
      pageNum.textContent = (page + 1) + " / " + pages;
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
      note.innerHTML = platform === "pc"
        ? "<p>" + esc(data.pcNote) + '</p><p><a href="' + esc(data.steamProfile) + '" target="_blank" rel="noopener noreferrer">Steam 프로필에서 전체 목록 보기 ↗</a></p>'
        : "<ul>" + data.mobileNote.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>";
      refit(list);
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        platform = tab.getAttribute("data-platform");
        page = 0;
        tabs.forEach(function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
        render();
      });
    });
    search.addEventListener("input", function () { page = 0; render(); });
    prev.addEventListener("click", function () { page--; render(); });
    next.addEventListener("click", function () { page++; render(); });
    render();
  }

  /* ---------- 공부 계획 ---------- */
  function initStudyPlan() {
    if (typeof STUDY_PLAN === "undefined" || !document.getElementById("spChapters")) return;
    var plan = STUDY_PLAN;
    var log = typeof STUDY_LOG === "undefined" ? {} : STUDY_LOG;
    function key(title) { return title.split(" ")[0]; }
    function minutesOf(r) { return (r.theory || 0) + (r.practice || 0) + (r.apply || 0); }
    function isDone(title) { var r = log[key(title)]; return !!(r && r.date); }

    var total = 0, done = 0, minutes = 0, dates = [];
    plan.chapters.forEach(function (ch) {
      ch[1].forEach(function (title) {
        total++;
        var r = log[key(title)];
        if (r && r.date) { done++; dates.push(r.date); }
        if (r) minutes += minutesOf(r);
      });
    });
    var pct = total ? Math.round(done / total * 1000) / 10 : 0;
    dates.sort();

    document.getElementById("spLead").textContent = "선정 이유: " + plan.reason + ". 이론과 실습, 응용으로 나눠 실제로 배운 것을 직접 해 보는 데 집중합니다.";
    document.getElementById("spPct").textContent = pct + "%";
    document.getElementById("spFill").style.width = pct + "%";
    document.getElementById("spStats").innerHTML =
      stat(done + " / " + total, "완료 단원") +
      stat(minutes.toLocaleString() + "분", "누적 공부 시간") +
      stat(dates[0] || "—", "시작일");

    document.getElementById("spCards").innerHTML =
      '<div class="plan-card"><p class="plan-label">마음가짐</p><p class="plan-quote">' + plan.mindset.map(esc).join("<br>") + "</p></div>" +
      '<div class="plan-card"><p class="plan-label">목표</p><p class="plan-big">' + esc(plan.goal) + "</p>" +
        '<p class="plan-sub">느낌 상상하기 · ' + esc(plan.feeling) + "</p></div>" +
      '<div class="plan-card"><p class="plan-label">완독 보상</p><p class="plan-big">🎉 ' + esc(plan.reward) + "</p></div>";

    // 챕터 타일: "CHAPTER 1. 프로그래밍을 시작합시다" → "CH 1" + 제목
    var grid = document.getElementById("spChapters");
    grid.innerHTML = plan.chapters.map(function (ch, i) {
      var items = ch[1];
      var chDone = items.filter(isDone).length;
      var head = ch[0].split(". ");
      var tag = head[0].replace("CHAPTER", "CH").replace("APPENDIX", "APP");
      return '<li><button type="button" class="chapter-tile' + (chDone === items.length ? " is-done" : "") + '" data-ch="' + i + '">' +
        '<span class="chapter-tag">' + esc(tag) + '</span><span class="chapter-name">' + esc(head.slice(1).join(". ")) + "</span>" +
        '<span class="chapter-count">' + chDone + "/" + items.length + "</span>" +
        '<span class="chapter-bar" aria-hidden="true"><span style="width:' + (chDone / items.length * 100) + '%"></span></span>' +
        "</button></li>";
    }).join("");

    var sheet = document.getElementById("spSheet");
    var sheetTitle = document.getElementById("spSheetTitle");
    var lessons = document.getElementById("spLessons");
    var opener = null;

    function openChapter(btn) {
      var ch = plan.chapters[+btn.getAttribute("data-ch")];
      opener = btn;
      sheetTitle.textContent = ch[0];
      lessons.innerHTML = ch[1].map(function (title) {
        var r = log[key(title)] || {};
        var meta = [];
        if (r.date) meta.push(esc(r.date));
        if (r.theory) meta.push("이론 " + r.theory + "분");
        if (r.practice) meta.push("실습 " + r.practice + "분");
        if (r.apply) meta.push("응용 " + r.apply + "분");
        if (r.youtube) meta.push('<a href="' + esc(r.youtube) + '" target="_blank" rel="noopener noreferrer">유튜브 ↗</a>');
        return '<li class="lesson' + (r.date ? " is-done" : "") + '">' +
          '<span class="lesson-check" aria-label="' + (r.date ? "완료" : "예정") + '"></span>' +
          '<div><p class="lesson-title">' + esc(title) + "</p>" +
          (r.note ? '<p class="lesson-note">' + esc(r.note) + "</p>" : "") +
          (meta.length ? '<p class="lesson-meta">' + meta.join(" · ") + "</p>" : "") +
          "</div></li>";
      }).join("");
      sheet.hidden = false;
      document.getElementById("spSheetClose").focus();
    }
    function closeChapter() {
      sheet.hidden = true;
      if (opener) opener.focus();
    }

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest(".chapter-tile");
      if (btn) openChapter(btn);
    });
    document.getElementById("spSheetClose").addEventListener("click", closeChapter);
    sheet.addEventListener("keydown", function (e) { if (e.key === "Escape") closeChapter(); });
    refit(grid);
  }

  initPlayHistory();
  initStudyPlan();
})();
