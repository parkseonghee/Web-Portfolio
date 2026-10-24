/* 필름 스트립: 가로로 넘기는 필름 프레임
   - 무대(.stage)는 scroll-snap 가로 트랙. 페이지 하나 = 필름 프레임 하나
   - 휠 한 번 / ←→ / PageUp·PageDown / Space = 한 페이지 이동 (이동 중 700ms 입력 무시)
     패널 안에 세로 스크롤이 남아 있으면 그 스크롤을 먼저 처리하고, 끝에 닿았을 때만 이동
   - 767px 이하에서는 휠 변환 없이 스와이프만. 가로 넘김은 터치 이벤트로 직접 처리(방향 잠금 · 한 장씩 · 끝에서 저항),
     좌우 가장자리 ‹ › 버튼, 아래 점 표시, 처음 들어왔을 때 1회 스와이프 안내
   - URL 해시로 페이지 지정 (#profile, #roguetower ...), 뒤로가기 지원
   - 테이프는 Web Animations(translate3d)로 이동. 페이지가 넘어갈 때 5배로 빨라졌다가 감속, 탭이 숨겨지면 정지
   - 영상은 현재 페이지(큰 컷) · 열린 상세 화면에서만 재생 (webm → mp4, 안 되면 포스터)
   - 왼쪽 목차(비디오 대여점 테이프 더미)를 누르면 테이프가 뽑혔다 돌아오며 그 페이지로 이동
     1023px 이하에서는 목차 대신 INDEX 버튼 → 페이지 목록(popover)
   - 페이지 정보(순서 · 해시 · 이름 · 그룹 색)는 scenes 배열 하나를 필름 테이프 / 목차 / 위치 표시 / 해시가 함께 쓴다
   - 모바일: 패널 내용이 더 남아 있으면 아래에 "▼ SCROLL" 힌트 (.has-more)
   - 움직임 줄이기 설정이면 테이프 정지, 페이지 이동 즉시, 영상 대신 첫 프레임 */
(function () {
  "use strict";

  var tv = document.querySelector(".tv-on");
  if (tv) tv.addEventListener("animationend", function (e) { if (e.target === tv) tv.remove(); });

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mobile = window.matchMedia("(max-width: 767px)");

  var LOCK_MS = 700;
  var BASE_SPEED = 0.08;   // 테이프 기본 속도 (px/ms) — 기존 CSS 애니메이션(2880px / 36s)과 같음
  var BOOST = 4;           // 페이지가 넘어갈 때 추가 배수 (1 + 4 = 5배)
  var BOOST_DECAY_MS = 450;

  var stage = document.getElementById("stage");
  var pages = Array.prototype.slice.call(stage.querySelectorAll(".page"));

  /* ---------- 페이지 데이터: HTML의 data-* 를 한 번만 읽어 모든 곳에서 같이 쓴다 ---------- */
  // 그룹 이름 → 색. 페이지 순서는 여기가 아니라 HTML의 <section> 배치 순서로 정해진다
  var GROUP_COLORS = {
    profile: "#6FA3D8", roguetower: "#D9564A", zoojack: "#4FAE78",
    growth: "#A3C76B", roblox: "#C9A27E",
    history: "#3FB8C4", study: "#E07A3F", goals: "#D96BA0", contact: "#B48AD8"
  };
  var TILTS = [-8, 5, -4, 6, -3, 4, -6, 3, -5, 7]; // 목차 테이프를 대충 쌓은 기울기 (페이지가 더 많으면 반복)
  var scenes = pages.map(function (p, i) {
    var group = p.getAttribute("data-group");
    return {
      el: p,
      id: p.getAttribute("data-scene"),       // URL 해시
      title: p.getAttribute("data-title"),    // 테이프 · 목차 · SCENE 표시
      num: pad(i + 1),
      group: group,
      color: GROUP_COLORS[group] || "#888"
    };
  });
  var tapes = Array.prototype.slice.call(document.querySelectorAll(".tape-track"));
  var sceneNum = document.getElementById("sceneNum");
  var sceneName = document.getElementById("sceneName");
  var sceneIndex = document.getElementById("sceneIndex");
  document.getElementById("sceneTotal").textContent = pad(pages.length);
  var sceneDots = document.getElementById("sceneDots");
  var dots = scenes.map(function () { return sceneDots.appendChild(document.createElement("i")); });
  var prevBtn = document.getElementById("swipePrev");
  var nextBtn = document.getElementById("swipeNext");

  var current = -1;
  var target = 0;          // 마지막으로 가라고 한 페이지 (연속 키 입력이 누적되게)
  var autoScrolling = false;
  var lockUntil = 0;
  var hashTimer = null;

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------- 테이프: 페이지 목록으로 프레임 번호를 채운다 ---------- */
  var segHtml = scenes.map(function (sc, i) {
    return '<span class="tape-seg"><b data-n="' + i + '">' + sc.num + "</b> " +
      sc.title + " · SEONGHEE PARK · UNITY CLIENT ·</span>";
  }).join("");
  tapes.forEach(function (t) {
    // 두 벌을 이어 붙여 끊김 없이 반복
    t.innerHTML = '<span class="tape-copy">' + segHtml + '</span><span class="tape-copy">' + segHtml + "</span>";
  });
  var tapeNums = Array.prototype.slice.call(document.querySelectorAll(".tape-seg b"));

  /* ---------- 왼쪽 목차: VHS 테이프 등면 ---------- */
  var indexNav = document.getElementById("tapeIndex");
  if (indexNav) indexNav.style.setProperty("--vhs-count", scenes.length); // 페이지 수에 맞춰 테이프 높이 조절
  var vhs = scenes.map(function (sc, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "vhs";
    b.style.setProperty("--tilt", TILTS[i % TILTS.length] + "deg");
    b.style.setProperty("--band", sc.color);
    b.innerHTML = '<span class="vhs-label"><b class="vhs-num">' + sc.num + '</b><span class="vhs-name">' +
      sc.title + '</span></span><span class="vhs-band" aria-hidden="true"></span>';
    b.addEventListener("click", function () {
      if (!reduceMotion) {
        // 쭉 뽑혔다가 제자리로 (애니메이션을 다시 걸기 위해 클래스를 뺐다 넣는다)
        b.classList.remove("is-pulling");
        void b.offsetWidth;
        b.classList.add("is-pulling");
      }
      goTo(i);
    });
    b.addEventListener("animationend", function () { b.classList.remove("is-pulling"); });
    if (indexNav) indexNav.appendChild(b);
    return b;
  });

  /* ---------- INDEX 버튼 메뉴 (1023px 이하) ---------- */
  var indexMenu = document.getElementById("indexMenu");
  var indexBtn = document.getElementById("indexBtn");
  var indexItems = [];
  if (indexMenu) {
    var indexList = document.getElementById("indexList");
    indexItems = scenes.map(function (sc, i) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "index-item";
      b.style.setProperty("--band", sc.color);
      b.innerHTML = "<b>" + sc.num + "</b><span>" + sc.title + '</span><i aria-hidden="true"></i>';
      b.addEventListener("click", function () {
        if (indexMenu.hidePopover) indexMenu.hidePopover();
        goTo(i);
      });
      li.appendChild(b);
      indexList.appendChild(li);
      return b;
    });
    indexMenu.addEventListener("toggle", function (e) {
      var open = e.newState === "open";
      indexBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && indexItems[current]) indexItems[current].focus();
    });
  }

  /* ---------- 테이프 이동: Web Animations(translate3d)로 합성 스레드에서 돈다 ----------
     평소에는 매 프레임 JS · 스타일 계산 · 레이아웃 읽기가 없다.
     페이지가 넘어갈 때만 잠깐 playbackRate를 5배로 올렸다가 감속하고(그동안만 rAF), 탭이 숨겨지면 멈춘다 */
  var tapeAnims = [];
  var tapeW = 0;
  function buildTapes() {
    var w = tapes[0].firstChild.offsetWidth;
    if (!w || w === tapeW) return;
    var phase = tapeAnims[0] ? (tapeAnims[0].currentTime % (tapeW / BASE_SPEED)) / (tapeW / BASE_SPEED) : 0;
    tapeAnims.forEach(function (a) { a.cancel(); });
    tapeW = w;
    var from = [-w, 0], to = [0, -w]; // 위: 오른쪽으로, 아래: 왼쪽으로
    tapeAnims = [];
    tapes.forEach(function (el, n) {
      if (reduceMotion || !el.animate) { el.style.transform = "translate3d(" + from[n] + "px, 0, 0)"; return; }
      var a = el.animate(
        [{ transform: "translate3d(" + from[n] + "px, 0, 0)" }, { transform: "translate3d(" + to[n] + "px, 0, 0)" }],
        { duration: w / BASE_SPEED, iterations: Infinity });
      a.currentTime = phase * w / BASE_SPEED;
      if (document.hidden) a.pause();
      tapeAnims.push(a);
    });
  }
  var boostStart = 0, boostRaf = 0;
  function setTapeRate(r) {
    tapeAnims.forEach(function (a) { if (a.updatePlaybackRate) a.updatePlaybackRate(r); else a.playbackRate = r; });
  }
  function boostTape() {
    if (!tapeAnims.length) return;
    boostStart = performance.now();
    if (!boostRaf) boostRaf = requestAnimationFrame(decayTape);
  }
  function decayTape(now) {
    var b = BOOST * Math.exp(-Math.max(0, now - boostStart) / BOOST_DECAY_MS);
    if (b < 0.02) b = 0;
    setTapeRate(1 + b);
    boostRaf = b ? requestAnimationFrame(decayTape) : 0;
  }
  buildTapes();

  /* ---------- 영상: 현재 페이지의 큰 컷 · 열린 상세 화면 안에서만 재생, 나머지는 일시정지 ---------- */
  var videos = Array.prototype.slice.call(document.querySelectorAll(".cut-media video, .sheet video"));
  videos.forEach(function (v) {
    v.addEventListener("playing", function () { v.classList.add("is-on"); }); // 첫 프레임이 나오면 포스터 위로 페이드 인
  });

  function syncMedia() {
    videos.forEach(function (v) {
      var owner = v.closest(".page, .sheet");
      var on = !reduceMotion && !document.hidden && (openSheet ? owner === openSheet : owner === pages[current]);
      if (on) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* 자동 재생이 막히면 포스터가 그대로 보인다 */ });
      } else {
        v.pause(); // 아직 재생 전이어도 호출 → autoplay 취소
      }
    });
  }
  document.addEventListener("visibilitychange", function () {
    tapeAnims.forEach(function (a) { if (document.hidden) a.pause(); else a.play(); });
    syncMedia();
  });

  /* ---------- 현재 페이지 ---------- */
  function setCurrent(i, opts) {
    opts = opts || {};
    if (i === current) return;
    var first = current < 0;
    current = i;
    pages.forEach(function (p, n) {
      p.classList.toggle("is-current", n === i);
      if (n === i) p.setAttribute("aria-current", "step"); else p.removeAttribute("aria-current");
    });
    tapeNums.forEach(function (b) { b.classList.toggle("is-on", +b.getAttribute("data-n") === i); });
    [vhs, indexItems].forEach(function (list) {
      list.forEach(function (b, n) {
        b.classList.toggle("is-current", n === i);
        if (n === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      });
    });
    sceneNum.textContent = sceneIndex.textContent = scenes[i].num;
    sceneName.textContent = scenes[i].title;
    dots.forEach(function (d, n) { d.classList.toggle("is-on", n === i); });
    prevBtn.hidden = i === 0;
    nextBtn.hidden = i === pages.length - 1;
    if (!first && !reduceMotion) boostTape();
    syncMedia();

    // 스와이프 중간 페이지까지 기록되지 않게, 멈춘 뒤에 해시를 남긴다
    clearTimeout(hashTimer);
    var hash = "#" + scenes[i].id;
    if (opts.push !== false) {
      hashTimer = setTimeout(function () {
        if (location.hash !== hash) history.pushState(null, "", hash);
      }, 300);
    }
  }

  /* 페이지 위치는 화면 크기가 바뀔 때만 다시 읽는다 (스크롤 중 매 프레임 offsetLeft를 읽으면
     방금 바꾼 클래스 때문에 강제 레이아웃이 생긴다) */
  var geo = null;
  function measure() {
    geo = {
      half: stage.clientWidth / 2,
      centers: pages.map(function (p) { return p.offsetLeft + p.offsetWidth / 2; })
    };
    return geo;
  }

  function leftFor(i) {
    var g = geo || measure();
    return g.centers[i] - g.half;
  }

  function nearest() {
    var g = geo || measure();
    var center = stage.scrollLeft + g.half;
    var best = 0, bestD = Infinity;
    g.centers.forEach(function (c, i) {
      var d = Math.abs(c - center);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function goTo(i, opts) {
    opts = opts || {};
    i = Math.max(0, Math.min(pages.length - 1, i));
    target = i;
    var left = leftFor(i);
    var smooth = !reduceMotion && !opts.instant;
    if (Math.abs(stage.scrollLeft - left) > 1) {
      autoScrolling = smooth;
      stage.scrollTo({ left: left, behavior: smooth ? "smooth" : "auto" });
    }
    setCurrent(i, opts);
  }

  function step(dir) {
    // 이동이 끝나기 전에 또 누르면 목표 페이지 기준으로 이어서 이동
    var base = autoScrolling ? target : current;
    if (base + dir < 0 || base + dir >= pages.length) return false;
    goTo(base + dir);
    return true;
  }

  /* ---------- 스크롤(스와이프)로 바뀐 페이지 반영 ---------- */
  var scrollRaf = 0, scrollEndTimer = null;
  function onScrollEnd() {
    autoScrolling = false;
    var i = nearest();
    target = i;
    setCurrent(i);
  }
  stage.addEventListener("scroll", function () {
    if (!scrollRaf) {
      scrollRaf = requestAnimationFrame(function () {
        scrollRaf = 0;
        if (!autoScrolling) setCurrent(target = nearest());
      });
    }
    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(onScrollEnd, 150); // scrollend 미지원 브라우저 대비
  }, { passive: true });
  stage.addEventListener("scrollend", function () { clearTimeout(scrollEndTimer); onScrollEnd(); });

  /* ---------- 모바일 스와이프 (767px 이하, 터치) ----------
     브라우저는 세로 스크롤만 맡고(CSS touch-action: pan-y), 가로 넘김은 여기서 직접 처리한다
     - 방향 잠금: 가로 이동 > 세로 × 1.3 이면 페이지 넘김. 브라우저가 세로 스크롤을 시작했으면(취소 불가) 손대지 않음.
       그 사이(대각선)는 둘 다 움직이지 않고 더 움직일 때까지 기다린다
     - 끄는 동안 페이지가 손가락을 따라오고(--drag), 놓으면 이전/다음 한 장으로만 이동 (빠르게 튕겨도 한 장)
     - 첫 페이지에서 오른쪽, 마지막 페이지에서 왼쪽으로 끌면 저항이 걸렸다가 돌아옴
     - 이동할 때는 무대를 새 페이지로 바로 스크롤하고, 그만큼 --drag를 보정한 뒤 0으로 미끄러뜨린다 */
  var SWIPE_SLOP = 10;    // 이만큼 움직여야 방향을 정함 (px)
  var SWIPE_RATIO = 1.3;  // 가로 > 세로 × 1.3 이면 가로
  var FLICK_V = 0.35;     // 이보다 빠르게 튕기면 거리와 상관없이 넘김 (px/ms)
  var COMMIT = 0.2;       // 페이지 폭의 20% 넘게 끌면 넘김
  var touch = null, settleTimer = 0;

  function setDrag(x) { stage.style.setProperty("--drag", x + "px"); }
  function dragNow() { return parseFloat(getComputedStyle(pages[0]).translate) || 0; } // 미끄러지는 중 · 넘겨보기 중인 위치
  function pageStep() { var g = geo || measure(); return g.centers.length > 1 ? g.centers[1] - g.centers[0] : stage.clientWidth; }
  function resist(x) { return (x < 0 ? -1 : 1) * 64 * (1 - Math.exp(-Math.abs(x) / 160)); } // 최대 64px까지 점점 무거워짐

  function settle(from) {
    clearTimeout(settleTimer);
    stage.classList.remove("is-settling");
    if (reduceMotion || Math.abs(from) < 1) { setDrag(0); return; }
    setDrag(from);
    void stage.offsetWidth; // from 위치를 먼저 그린 뒤 0으로 전환
    stage.classList.add("is-settling");
    setDrag(0);
    settleTimer = setTimeout(function () { stage.classList.remove("is-settling"); }, 360);
  }

  function startTouch(e) {
    if (!mobile.matches || openSheet || e.touches.length > 1) { if (touch) settle(touch.shown); touch = null; return; }
    var t = e.touches[0];
    var base = stage.classList.contains("is-settling") || stage.classList.contains("is-peeking") ? dragNow() : 0;
    clearTimeout(settleTimer);
    stage.classList.remove("is-settling", "is-peeking");
    setDrag(base);
    touch = { x: t.clientX, y: t.clientY, base: base, shown: base, axis: "", samples: [] };
  }

  function moveTouch(e) {
    if (!touch) return;
    var t = e.touches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (!touch.axis) {
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (!e.cancelable || (ay > SWIPE_SLOP && ay >= ax)) touch.axis = "y";
      else if (ax > SWIPE_SLOP && ax > ay * SWIPE_RATIO) touch.axis = "x";
      if (touch.axis !== "x") return;
      touch.x = t.clientX; // 잠긴 지점부터 따라오게 (갑자기 튀지 않게)
      dx = 0;
      hideCoach();
    }
    if (touch.axis !== "x") return;
    if (e.cancelable) e.preventDefault(); // pan-y를 모르는 브라우저에서도 세로로 같이 움직이지 않게
    var x = touch.base + dx, w = pageStep();
    if ((x > 0 && current === 0) || (x < 0 && current === pages.length - 1)) x = resist(x);
    else x = Math.max(-w, Math.min(w, x));
    touch.shown = x;
    setDrag(x);
    touch.samples.push([t.clientX, e.timeStamp]);
    while (touch.samples.length > 2 && e.timeStamp - touch.samples[0][1] > 100) touch.samples.shift();
  }

  function endTouch(e) {
    if (!touch) return;
    var tc = touch;
    touch = null;
    if (tc.axis !== "x" || e.type === "touchcancel") { settle(tc.shown); return; }
    var s = tc.samples, v = 0;
    if (s.length > 1 && s[s.length - 1][1] > s[0][1]) v = (s[s.length - 1][0] - s[0][0]) / (s[s.length - 1][1] - s[0][1]);
    var dir = 0;
    if (Math.abs(v) > FLICK_V) dir = v < 0 ? 1 : -1;
    else if (Math.abs(tc.shown) > pageStep() * COMMIT) dir = tc.shown < 0 ? 1 : -1;
    var to = current + dir;
    if (!dir || to < 0 || to >= pages.length) { settle(tc.shown); return; }
    var left = leftFor(to);
    var from = left - stage.scrollLeft + tc.shown; // 스크롤이 바로 옮겨진 만큼 페이지를 되돌려 두면 화면은 그대로
    target = to;
    autoScrolling = false;
    stage.scrollTo({ left: left, behavior: "auto" });
    setCurrent(to);
    settle(from);
  }
  // 가장자리 ‹ › 버튼 위에서 시작한 스와이프도 넘어가게 (밀면 버튼은 눌리지 않음)
  [stage, prevBtn, nextBtn].forEach(function (el) {
    el.addEventListener("touchstart", startTouch, { passive: true });
    el.addEventListener("touchmove", moveTouch, { passive: false });
    el.addEventListener("touchend", endTouch);
    el.addEventListener("touchcancel", endTouch);
  });

  /* 좌우 가장자리 ‹ › 버튼 */
  prevBtn.addEventListener("click", function () { hideCoach(); step(-1); });
  nextBtn.addEventListener("click", function () { hideCoach(); step(1); });

  /* ---------- 처음 들어왔을 때 스와이프 안내 (모바일, 1회) ----------
     로드 1초 뒤 아래쪽 말풍선(손가락이 오른쪽 → 왼쪽으로 2회) + 현재 패널을 왼쪽으로 40px 살짝 넘겨보기.
     스와이프 · 탭 · 4초 뒤 사라지고, 본 적이 있으면(localStorage) 다시 띄우지 않는다.
     떠 있는 동안 ▼ SCROLL 힌트는 숨김 (body.is-coaching). 움직임 줄이기면 문구만 */
  var COACH_KEY = "film.swipeCoachSeen";
  var COACH_HAND = '<span class="coach-hand" aria-hidden="true"><svg viewBox="0 0 24 24">' +
    '<path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-4 0"/><path d="M14 10V9a2 2 0 0 0-4 0v1"/>' +
    '<path d="M10 9.5V4a2 2 0 0 0-4 0v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>' +
    "</svg></span>";
  var coach = null, coachStartTimer = 0, coachHideTimer = 0;
  function coachSeen() { try { return localStorage.getItem(COACH_KEY) === "1"; } catch (err) { return false; } }
  function markCoachSeen() { try { localStorage.setItem(COACH_KEY, "1"); } catch (err) { /* 저장이 막혀도 안내는 정상 동작 */ } }

  function showCoach() {
    if (!mobile.matches || openSheet || pages.length < 2 || coachSeen()) return;
    markCoachSeen();
    coach = document.createElement("div");
    coach.className = "swipe-coach";
    coach.setAttribute("aria-hidden", "true"); // 화면 읽기는 ‹ › 버튼 이름으로 안내
    coach.innerHTML = (reduceMotion ? "" : COACH_HAND) + "<span>← 옆으로 넘겨서 보기 →</span>";
    document.body.appendChild(coach);
    document.body.classList.add("is-coaching");
    void coach.offsetWidth;
    coach.classList.add("is-on");
    if (!reduceMotion) {
      stage.style.setProperty("--peek", (current < pages.length - 1 ? -40 : 40) + "px"); // 마지막 페이지면 이전 쪽으로
      stage.classList.add("is-peeking");
    }
    coachHideTimer = setTimeout(hideCoach, 4000);
    document.addEventListener("touchstart", hideCoach, { capture: true, passive: true });
    document.addEventListener("pointerdown", hideCoach, true);
  }
  // 안내가 뜨기 전에 이미 넘겼으면 띄우지 않음
  function hideCoach() {
    clearTimeout(coachStartTimer);
    if (!coach) { if (mobile.matches) markCoachSeen(); return; }
    var c = coach;
    coach = null;
    clearTimeout(coachHideTimer);
    document.removeEventListener("touchstart", hideCoach, { capture: true });
    document.removeEventListener("pointerdown", hideCoach, true);
    document.body.classList.remove("is-coaching");
    c.classList.remove("is-on");
    setTimeout(function () { c.remove(); }, reduceMotion ? 0 : 320);
  }
  stage.addEventListener("animationend", function (e) {
    if (e.animationName === "swipe-peek") stage.classList.remove("is-peeking");
  });
  // 문서가 준비된 뒤 1초 (load는 영상 · 이미지까지 기다려 느린 회선에서 한참 늦어지므로 쓰지 않음)
  coachStartTimer = setTimeout(showCoach, 1000);

  /* ---------- 패널 안 세로 스크롤이 남았는지 ---------- */
  function scrollableInside(el, page, dy) {
    var stop = page.querySelector(".page-in");
    for (; el && el !== page; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1) {
        var oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll") {
          if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return el;
          if (dy < 0 && el.scrollTop > 0) return el;
        }
      }
      if (el === stop) break;
    }
    return null;
  }

  /* ---------- 휠 → 가로 이동 (데스크톱) ----------
     passive 리스너: 브라우저가 JS를 기다리지 않고 바로 스크롤한다.
     - 세로 휠은 무대가 스스로 스크롤하지 않으므로(가로 전용) 막을 필요 없이 한 페이지씩 이동만 시킨다
     - 가로 휠(트랙패드 좌우 밀기)은 무대가 직접 스크롤하고 scroll-snap이 한 장씩 맞춘다
     - 옆 페이지 패널은 CSS(pointer-events: none)로 휠을 받지 않는다
     - passive라서 리스너가 돌 때 브라우저가 이미 패널을 끝까지 스크롤했을 수 있다.
       그래서 바로 넘기지 않고 두 프레임 뒤에 "이번 휠로 패널이 움직였는지"(scroll 이벤트)를 보고 정한다 */
  var lastWheelAt = 0, lastWheelMag = 0, innerScrollAt = 0, innerMovedAt = 0, wheelPending = false;
  document.addEventListener("scroll", function (e) {
    if (e.target !== stage && pages[current] && pages[current].contains(e.target)) innerMovedAt = performance.now();
  }, { capture: true, passive: true });
  window.addEventListener("wheel", function (e) {
    if (openSheet) return; // 상세 시트가 열려 있으면 시트 스크롤 그대로
    if (e.target.closest && e.target.closest(".index-menu")) return; // 목차 메뉴 안 스크롤 그대로
    if (mobile.matches || e.ctrlKey) return; // 모바일은 스와이프만, Ctrl+휠은 확대
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    var delta = e.deltaY;
    var now = performance.now();

    // 패널 안에 세로로 더 스크롤할 곳이 있으면 그쪽을 먼저
    var page = e.target.closest && e.target.closest(".page");
    if (page && page === pages[current] && scrollableInside(e.target, page, delta)) {
      innerScrollAt = now;
      return;
    }

    var mag = Math.abs(delta);
    var gap = now - lastWheelAt, prevMag = lastWheelMag;
    lastWheelAt = now; lastWheelMag = mag;

    if (now < lockUntil) return;
    if (mag < 2) return;
    if (now - innerScrollAt < 400) return;          // 패널 끝에 막 닿은 같은 제스처는 넘기지 않음
    if (gap < 100 && mag <= prevMag) return;          // 트랙패드 관성 꼬리
    if (now - innerMovedAt < 100) return;             // 바로 전까지 패널이 움직이던 중
    if (wheelPending) return;
    wheelPending = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        wheelPending = false;
        if (innerMovedAt >= now - 100) { innerScrollAt = innerMovedAt; return; } // 이번 휠은 패널 스크롤이었음
        if (step(delta > 0 ? 1 : -1)) lockUntil = performance.now() + LOCK_MS;
      });
    });
  }, { passive: true });

  /* ---------- 키보드 ---------- */
  document.addEventListener("keydown", function (e) {
    if (openSheet || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    var dir = 0, scrollFirst = false;
    switch (e.key) {
      case "ArrowRight": dir = 1; break;
      case "ArrowLeft": dir = -1; break;
      case "PageDown": dir = 1; scrollFirst = true; break;
      case "PageUp": dir = -1; scrollFirst = true; break;
      case "Enter": // 프로젝트 페이지에서 Enter = 상세 보기 (링크·버튼 위에서는 그대로)
        if (t.closest && t.closest("a, button, summary")) return;
        if (pages[current].getAttribute("data-detail")) openDetail(pages[current].getAttribute("data-detail"));
        return;
      case " ":
        if (t.closest && t.closest("a, button, summary")) return; // Space로 버튼 누르기는 그대로
        dir = e.shiftKey ? -1 : 1; scrollFirst = true; break;
      default: return;
    }
    e.preventDefault();
    if (scrollFirst) {
      var inner = pages[current].querySelector(".page-in");
      if (scrollableInside(inner, pages[current], dir)) {
        inner.scrollBy({ top: dir * inner.clientHeight * 0.85, behavior: reduceMotion ? "auto" : "smooth" });
        return;
      }
    }
    step(dir);
  });

  /* ---------- 옆 페이지 클릭 = 그 페이지로 이동 ---------- */
  stage.addEventListener("mousedown", function (e) {
    var page = e.target.closest(".page");
    if (page && page !== pages[current]) e.preventDefault(); // 포커스·텍스트 선택 막기
  }, true);
  stage.addEventListener("click", function (e) {
    var page = e.target.closest(".page");
    if (!page) return;
    if (page === pages[current]) {
      // 프로젝트 페이지는 패널 아무 데나 누르면 상세 시트가 열림 (링크·버튼·펼치기, 글자 드래그는 제외)
      var detail = page.getAttribute("data-detail");
      var sel = window.getSelection && String(window.getSelection());
      if (detail && (e.target.closest("[data-open-detail]") ||
          (!sel && !e.target.closest("a, button, summary, details, input")))) openDetail(detail);
      return;
    }
    e.preventDefault();
    e.stopPropagation(); // 옆 페이지 안의 링크·버튼은 누르지 않음
    goTo(pages.indexOf(page));
  }, true);
  // Tab으로 옆 페이지 안에 포커스가 들어가면 그 페이지로
  stage.addEventListener("focusin", function (e) {
    var page = e.target.closest(".page");
    if (page && page !== pages[current]) goTo(pages.indexOf(page));
  });

  /* ---------- 프로젝트 상세 시트 (dialog) ----------
     - 열 때 해시를 #<시트 id>로 남겨서 뒤로가기 = 닫기
     - 다른 시트로 바꿀 때는 해시를 교체만 하고, 닫을 때 그 프로젝트 페이지 해시로 맞춘다 */
  var sheets = {};
  var openSheet = null;
  var sheetPushed = false, sheetSwitched = false;
  Array.prototype.forEach.call(document.querySelectorAll("dialog.sheet"), function (d) {
    sheets[d.id] = d;
    // close 이벤트는 비동기라, 코드로 닫을 때는 openSheet를 먼저 바꿔 두고 여기서 걸러낸다
    d.addEventListener("close", function () {
      if (openSheet !== d) return;
      openSheet = null;
      syncMedia();
      if (sheetPushed && !sheetSwitched) history.back();
      else history.replaceState(null, "", "#" + scenes[current].id);
      sheetPushed = sheetSwitched = false;
    });
    d.addEventListener("click", function (e) {
      if (e.target === d || e.target.closest("[data-close-detail]")) { d.close(); return; }
      var sw = e.target.closest("[data-switch-detail]");
      if (sw) openDetail(sw.getAttribute("data-switch-detail"));
    });
  });

  function ownerOf(id) {
    for (var i = 0; i < pages.length; i++) if (pages[i].getAttribute("data-detail") === id) return i;
    return -1;
  }

  function openDetail(id, opts) {
    opts = opts || {};
    var d = sheets[id];
    if (!d || openSheet === d) return;
    var prev = openSheet;
    openSheet = d;
    if (prev) prev.close();
    var owner = ownerOf(id);
    if (owner >= 0 && owner !== current) goTo(owner, { instant: true, push: false });
    clearTimeout(hashTimer);
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    d.scrollTop = 0;
    if (opts.push !== false) {
      if (prev) { history.replaceState(null, "", "#" + id); sheetSwitched = true; }
      else { history.pushState(null, "", "#" + id); sheetPushed = true; }
    }
    syncMedia();
  }

  function closeSilently() {
    if (!openSheet) return;
    var d = openSheet;
    openSheet = null;
    sheetPushed = sheetSwitched = false;
    d.close();
    syncMedia();
  }

  /* ---------- URL 해시 ---------- */
  function indexFromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    for (var i = 0; i < scenes.length; i++) if (scenes[i].id === id) return i;
    return -1;
  }
  window.addEventListener("popstate", function () {
    var id = decodeURIComponent(location.hash.slice(1));
    if (sheets[id]) { openDetail(id, { push: false }); return; }
    closeSilently();
    var i = indexFromHash();
    goTo(i < 0 ? 0 : i, { push: false });
  });

  /* ---------- 패널 안 스크롤 줄이기 (768px 이상) ----------
     내용이 패널보다 조금 크면 zoom으로 줄여서 한 화면에 맞춘다 (최대 MIN_ZOOM까지).
     그보다 더 크면 글자가 너무 작아지므로 줄이지 않고 패널 안 세로 스크롤로 보여 준다.
     줄이면 줄바꿈이 달라지므로 몇 번 반복해서 맞춘다. 모바일은 세로 스크롤 그대로 */
  var MIN_ZOOM = 0.8;
  // 모든 페이지를 먼저 초기화(쓰기)하고 한 번에 크기를 읽는다 → 페이지마다 강제 레이아웃이 생기지 않음.
  // 넘치는 페이지만 zoom을 반복해서 맞춘다
  function fitPages(list) {
    var items = (list || pages).map(function (page) {
      var inner = page.querySelector(".page-in");
      return { inner: inner, el: inner.querySelector(".cuts, .profile") };
    }).filter(function (it) { return it.el; });
    items.forEach(function (it) { it.el.style.zoom = it.el.style.minHeight = ""; });
    if (mobile.matches) return;
    items.forEach(function (it) {
      var cs = getComputedStyle(it.inner);
      it.avail = it.inner.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      it.h = it.el.getBoundingClientRect().height;
    });
    items.forEach(function (it) {
      var zoom = 1, h = it.h;
      for (var n = 0; n < 5 && h > it.avail + 1; n++) {
        zoom = Math.max(MIN_ZOOM, zoom * it.avail / h - 0.005);
        it.el.style.zoom = zoom;
        // zoom을 걸면 min-height: 100%도 같이 줄어드니, 패널 높이를 꽉 채우도록 보정
        if (it.el.classList.contains("cuts")) it.el.style.minHeight = (it.avail / zoom) + "px";
        if (zoom === MIN_ZOOM) break;
        h = it.el.getBoundingClientRect().height;
      }
    });
  }

  var resizeRaf = 0;
  window.addEventListener("resize", function () {
    geo = null; // 다음 프레임 전에 들어오는 이동 · 스크롤도 새 위치로 계산하게 바로 비움
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      geo = null;
      buildTapes();
      fitPages();
      if (current >= 0) stage.scrollTo({ left: leftFor(current), behavior: "auto" });
    });
  });
  fitPages();
  // 플레이 이력 · 공부 계획처럼 내용이 바뀌는 페이지가 다시 맞춰 달라고 할 때 (그 페이지만)
  document.addEventListener("film:refit", function (e) {
    var page = e.detail && e.detail.closest ? e.detail.closest(".page") : null;
    requestAnimationFrame(function () { fitPages(page ? [page] : null); });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitPages(); });
  window.addEventListener("load", function () { fitPages(); });

  /* ---------- 스크롤 힌트 (모바일): 패널 내용이 더 남아 있으면 .page에 .has-more ----------
     패널 스크롤 · 내용 크기 변화(펼치기, 목록 쪽 넘김, 화면 회전)마다 다시 계산. 끝까지 내리면 사라짐 */
  function updateHint(page) {
    var inner = page.querySelector(".page-in");
    var more = mobile.matches && inner.scrollHeight - inner.clientHeight - inner.scrollTop > 4;
    if (page.classList.contains("has-more") !== more) page.classList.toggle("has-more", more);
  }
  var hintRaf = 0, hintQueue = [];
  function queueHint(page) {
    if (hintQueue.indexOf(page) < 0) hintQueue.push(page);
    if (!hintRaf) hintRaf = requestAnimationFrame(function () {
      hintRaf = 0;
      var list = hintQueue; hintQueue = [];
      list.forEach(updateHint);
    });
  }
  pages.forEach(function (page) {
    var inner = page.querySelector(".page-in");
    inner.addEventListener("scroll", function () { queueHint(page); }, { passive: true });
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { queueHint(page); });
      ro.observe(inner);
      Array.prototype.forEach.call(inner.children, function (c) { ro.observe(c); });
    }
    queueHint(page);
  });
  if (mobile.addEventListener) mobile.addEventListener("change", function () {
    pages.forEach(queueHint);
    if (!mobile.matches) { touch = null; hideCoach(); stage.classList.remove("is-settling", "is-peeking"); setDrag(0); }
  });

  var startId = decodeURIComponent(location.hash.slice(1));
  var start = sheets[startId] ? ownerOf(startId) : indexFromHash();
  goTo(start < 0 ? 0 : start, { instant: true, push: false });
  if (sheets[startId]) openDetail(startId, { push: false });
})();
