/* ============================================================
   vent.js — 解压发泄特效引擎
   ============================================================ */
(function () {
  "use strict";

  const canvas = document.getElementById("fxCanvas");
  const ctx = canvas.getContext("2d");
  const ventBtn = document.getElementById("ventBtn");
  const ventPanel = document.getElementById("ventPanel");
  const ventGrid = document.getElementById("ventGrid");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  // ---------- 粒子系统 ----------
  const particles = [];
  const MAX_PARTICLES = 1200;
  function W() { return window.innerWidth; }
  function H() { return window.innerHeight; }
  const rand = (a, b) => a + Math.random() * (b - a);
  function addParticle(p) { if (particles.length >= MAX_PARTICLES) particles.shift(); particles.push(p); }

  // ---------- 烟花 ----------
  function launchFirework() {
    const x = rand(W() * 0.15, W() * 0.85);
    const targetY = rand(H() * 0.12, H() * 0.4);
    const startY = H();
    const hue = Math.floor(rand(0, 360));
    const riseFrames = 55;
    addParticle({
      type: "rocket", x: x, y: startY, vx: rand(-0.3, 0.3),
      vy: -(startY - targetY) / riseFrames, life: riseFrames, maxLife: riseFrames,
      hue: hue, size: 2.5, trail: []
    });
  }
  function explodeFirework(x, y, hue) {
    const outer = 48, inner = 24;
    for (let i = 0; i < outer; i++) {
      const angle = (Math.PI * 2 * i) / outer + rand(-0.05, 0.05);
      const speed = rand(3.5, 6.5);
      addParticle({
        type: "star", x: x, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: rand(60, 95), maxLife: 95,
        hue: hue + rand(-15, 15), size: rand(2, 3.5),
        trail: [], twinkle: rand(0, Math.PI * 2)
      });
    }
    for (let i = 0; i < inner; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(1, 3);
      addParticle({
        type: "star", x: x, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: rand(40, 70), maxLife: 70,
        hue: hue + rand(-20, 20), size: rand(1.5, 2.5),
        trail: [], twinkle: rand(0, Math.PI * 2)
      });
    }
    addParticle({ type: "flash", x: x, y: y, life: 12, maxLife: 12, size: 40, hue: hue });
  }

  // ---------- 打拳 ----------
  function launchPunch() {
    const emojis = ["👊", "🥊", "💪"];
    const cx = rand(W() * 0.25, W() * 0.75);
    const cy = rand(H() * 0.25, H() * 0.65);
    const fromLeft = Math.random() < 0.5;
    const startX = fromLeft ? -80 : W() + 80;
    const dir = fromLeft ? 1 : -1;
    particles.push({
      type: "emoji", emoji: emojis[Math.floor(rand(0, emojis.length))],
      x: startX, y: cy,
      vx: dir * rand(20, 30), vy: 0, life: 28, maxLife: 28,
      size: rand(90, 130), rot: 0, vrot: rand(-0.1, 0.1)
    });
    setTimeout(function () {
      addCrack(cx, cy);
      triggerShake(14, 500);
      for (let i = 0; i < 24; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(5, 12);
        addParticle({
          type: "spark", x: cx, y: cy,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rand(30, 50), maxLife: 50, hue: rand(0, 40), size: rand(3, 7), isImpact: true
        });
      }
      addParticle({ type: "text", text: "砰!", x: cx, y: cy, vx: 0, vy: -1, life: 45, maxLife: 45, size: 64 });
    }, 480);
  }

  // ---------- 扔大便 ----------
  function launchPoop() {
    for (let i = 0; i < 10; i++) {
      const side = Math.floor(rand(0, 4));
      let x, y, vx, vy;
      if (side === 0) { x = rand(20, W() * 0.2); y = H() + rand(30, 80); vx = rand(8, 13); vy = -rand(14, 19); }
      else if (side === 1) { x = rand(W() * 0.8, W() - 20); y = H() + rand(30, 80); vx = -rand(8, 13); vy = -rand(14, 19); }
      else if (side === 2) { x = rand(20, W() * 0.2); y = rand(20, H() * 0.15); vx = rand(7, 12); vy = rand(2, 5); }
      else { x = rand(W() * 0.35, W() * 0.65); y = H() + rand(30, 80); vx = rand(-6, 6); vy = -rand(16, 22); }
      addParticle({
        type: "emoji", emoji: "💩",
        x: x, y: y, vx: vx, vy: vy,
        life: 200, maxLife: 200,
        size: rand(48, 72), rot: 0, vrot: rand(-0.3, 0.3),
        gravity: 0.42
      });
    }
  }

  // ---------- 捏碎 ----------
  function launchCrush() {
    triggerSqueeze();
    const words = ["啊—", "碎!", "💥", "呃!", "嘎!"];
    for (let i = 0; i < 16; i++) {
      addParticle({
        type: "text", text: words[Math.floor(rand(0, words.length))],
        x: W() / 2 + rand(-120, 120), y: H() / 2 + rand(-80, 80),
        vx: rand(-4, 4), vy: rand(-7, -2),
        life: rand(45, 75), maxLife: 75,
        size: rand(22, 46), hue: rand(0, 30)
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(3, 8);
      addParticle({
        type: "spark", x: W() / 2, y: H() / 2,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(25, 45), maxLife: 45, hue: rand(0, 30), size: rand(2, 5)
      });
    }
  }

  // ---------- 撕纸 ----------
  let tearCooldown = 0;
  function launchTear() {
    const now = Date.now();
    if (now - tearCooldown < 150) return;
    tearCooldown = now;
    const existing = document.querySelectorAll(".tear-overlay");
    if (existing.length >= 6) existing[0].remove();

    const w = W(), h = H();
    const tearX = rand(w * 0.2, w * 0.8);
    const leftW = tearX, rightW = w - tearX;
    const shiftL = -rand(18, 40), shiftR = rand(18, 40);

    const cs = getComputedStyle(document.documentElement);
    const bg1 = (cs.getPropertyValue("--bg-1") || "#667eea").trim();
    const bg2 = (cs.getPropertyValue("--bg-2") || "#764ba2").trim();

    function makeJaggedPath(height) {
      const steps = 16;
      let d = "M0,0";
      for (let i = 0; i < steps; i++) {
        d += " L" + rand(8, 18).toFixed(1) + "," + ((i + 0.5) * (height / steps)).toFixed(1);
        d += " L" + rand(1, 5).toFixed(1) + "," + ((i + 1) * (height / steps)).toFixed(1);
      }
      d += " L0," + height + " Z";
      return d;
    }

    const overlay = document.createElement("div");
    overlay.className = "tear-overlay";

    const pieceL = document.createElement("div");
    pieceL.className = "tear-piece-l";
    pieceL.style.width = leftW + "px";
    pieceL.style.background = "linear-gradient(90deg, " + bg2 + ", " + bg1 + ")";
    const jagL = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    jagL.setAttribute("class", "tear-jag");
    jagL.style.right = "0";
    jagL.setAttribute("width", "20");
    jagL.setAttribute("height", h);
    jagL.setAttribute("viewBox", "0 0 20 " + h);
    jagL.setAttribute("preserveAspectRatio", "none");
    const pathL = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathL.setAttribute("d", makeJaggedPath(h));
    pathL.setAttribute("fill", "rgba(0,0,0,0.75)");
    jagL.appendChild(pathL);
    pieceL.appendChild(jagL);

    const pieceR = document.createElement("div");
    pieceR.className = "tear-piece-r";
    pieceR.style.width = rightW + "px";
    pieceR.style.background = "linear-gradient(270deg, " + bg2 + ", " + bg1 + ")";
    const jagR = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    jagR.setAttribute("class", "tear-jag");
    jagR.style.left = "0";
    jagR.style.transform = "scaleX(-1)";
    jagR.setAttribute("width", "20");
    jagR.setAttribute("height", h);
    jagR.setAttribute("viewBox", "0 0 20 " + h);
    jagR.setAttribute("preserveAspectRatio", "none");
    const pathR = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathR.setAttribute("d", makeJaggedPath(h));
    pathR.setAttribute("fill", "rgba(0,0,0,0.75)");
    jagR.appendChild(pathR);
    pieceR.appendChild(jagR);

    overlay.appendChild(pieceL);
    overlay.appendChild(pieceR);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
      pieceL.style.transform = "translateX(" + shiftL + "px)";
      pieceR.style.transform = "translateX(" + shiftR + "px)";
    });

    for (let i = 0; i < 24; i++) {
      addParticle({
        type: "confetti", x: tearX + rand(-10, 10), y: rand(0, h),
        vx: rand(-8, 8), vy: rand(-6, 3),
        life: rand(70, 130), maxLife: 130,
        w: rand(5, 11), h: rand(9, 16), rot: rand(0, Math.PI * 2), vrot: rand(-0.35, 0.35),
        color: ["#fff", "#ffd166", "#ff6b6b", "#06d6a0", "#667eea"][Math.floor(rand(0, 5))],
        swing: rand(0, Math.PI * 2), gravity: 0.2
      });
    }

    setTimeout(function () {
      overlay.style.transition = "opacity 0.4s ease";
      overlay.style.opacity = "0";
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400);
    }, 1400);
  }

  // ---------- 彩带 ----------
  function launchConfetti() {
    for (let i = 0; i < 80; i++) {
      (function (i) {
        setTimeout(function () {
          addParticle({
            type: "confetti", x: rand(0, W()), y: rand(-40, -10),
            vx: rand(-2, 2), vy: rand(2, 5),
            life: rand(180, 280), maxLife: 280,
            w: rand(6, 12), h: rand(14, 22), rot: rand(0, Math.PI * 2), vrot: rand(-0.25, 0.25),
            color: ["#ff6b6b", "#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#06d6a0", "#ffd166", "#fff"][Math.floor(rand(0, 8))],
            swing: rand(0, Math.PI * 2), gravity: 0.05
          });
        }, i * 25);
      })(i);
    }
  }

  // ---------- 变色 ----------
  const BG_PALETTES = [
    ["#667eea", "#764ba2"],
    ["#f093fb", "#f5576c"],
    ["#4facfe", "#00f2fe"],
    ["#43e97b", "#38f9d7"],
    ["#fa709a", "#fee140"],
    ["#30cfd0", "#330867"],
    ["#a8edea", "#fed6e3"],
    ["#ff9a9e", "#fecfef"],
    ["#5ee7df", "#b490ca"],
    ["#f6d365", "#fda085"],
    ["#0ba360", "#3cba92"],
    ["#ee9ca7", "#ffdde1"],
  ];
  const BG_KEY = "work-countdown-bg";
  let bgIdx = 0;

  function saveBgIdx(idx) {
    try { localStorage.setItem(BG_KEY, String(idx)); } catch (e) {}
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
      window.Capacitor.Plugins.Preferences.set({ key: BG_KEY, value: String(idx) }).catch(function () {});
    }
  }
  function applyBgIdx(idx) {
    bgIdx = idx;
    const palette = BG_PALETTES[bgIdx] || BG_PALETTES[0];
    document.documentElement.style.setProperty("--bg-1", palette[0]);
    document.documentElement.style.setProperty("--bg-2", palette[1]);
  }
  function loadBgIdx() {
    let idx = null;
    try { idx = parseInt(localStorage.getItem(BG_KEY)); } catch (e) {}
    if (!isNaN(idx) && idx >= 0 && idx < BG_PALETTES.length) applyBgIdx(idx);
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
      window.Capacitor.Plugins.Preferences.get({ key: BG_KEY }).then(function (res) {
        if (res.value != null) {
          const i = parseInt(res.value);
          if (!isNaN(i) && i >= 0 && i < BG_PALETTES.length) applyBgIdx(i);
        }
      }).catch(function () {});
    }
  }
  function changeBgColor() {
    let next;
    do { next = Math.floor(rand(0, BG_PALETTES.length)); } while (next === bgIdx && BG_PALETTES.length > 1);
    applyBgIdx(next);
    saveBgIdx(next);
  }

  // ---------- 防抖包装 ----------
  const COOLDOWN = 300;
  const lastFire = {};
  function debounced(key, fn) {
    return function () {
      const now = Date.now();
      if (now - (lastFire[key] || 0) < COOLDOWN) return;
      lastFire[key] = now;
      fn();
    };
  }

  const ACTIONS = [
    { emoji: "🎆", label: "放烟花", fn: debounced("fw",  function () { for (let i = 0; i < 5; i++) setTimeout(launchFirework, i * 320); }) },
    { emoji: "👊", label: "打拳",   fn: debounced("punch", launchPunch) },
    { emoji: "💩", label: "大便",   fn: debounced("poop", launchPoop) },
    { emoji: "💢", label: "捏碎",   fn: debounced("crush", launchCrush) },
    { emoji: "🎨", label: "变色",   fn: debounced("bg", changeBgColor) },
    { emoji: "🎉", label: "庆祝",   fn: debounced("party", function () { for (let i = 0; i < 3; i++) setTimeout(launchFirework, i * 450); launchConfetti(); }) },
  ];

  ACTIONS.forEach(function (act) {
    const btn = document.createElement("button");
    btn.className = "vent-item";
    btn.innerHTML = act.emoji;
    btn.addEventListener("click", function () { act.fn(); });
    ventGrid.appendChild(btn);
  });

  // ---------- 川剧变脸 ----------
  const FACES = ["😊", "🤩", "😎", "🤪", "😜", "😈", "👻", "🤡", "👽", "😺", "🥳", "🙀"];
  let faceIdx = 0, faceTimer = null;

  function renderFace(emoji, withFlip) {
    ventBtn.innerHTML = '<span class="face' + (withFlip ? ' flip' : '') + '">' + emoji + '</span>';
  }
  function nextFace() {
    faceIdx = (faceIdx + 1) % FACES.length;
    renderFace(FACES[faceIdx], true);
  }
  function startFaceCycle() {
    renderFace(FACES[faceIdx], false);
    faceTimer = setInterval(nextFace, 1600);
  }
  function stopFaceCycle() {
    if (faceTimer) { clearInterval(faceTimer); faceTimer = null; }
  }

  ventBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    const open = ventPanel.classList.toggle("open");
    ventBtn.classList.toggle("active", open);
    if (open) { stopFaceCycle(); renderFace("✕", true); }
    else { startFaceCycle(); }
  });
  document.addEventListener("click", function (e) {
    if (!ventPanel.contains(e.target) && e.target !== ventBtn && ventPanel.classList.contains("open")) {
      ventPanel.classList.remove("open");
      ventBtn.classList.remove("active");
      startFaceCycle();
    }
  });

  startFaceCycle();
  loadBgIdx();

  // ============ 全屏特效：裂痕 / 震屏 / 挤压 ============

  const cardEl = document.querySelector(".card");
  let shakeTimer = null;
  function triggerShake(intensity, duration) {
    if (!cardEl) return;
    cardEl.style.setProperty("--shake-i", intensity + "px");
    cardEl.classList.add("fx-shake");
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(function () { cardEl.classList.remove("fx-shake"); }, duration);
  }
  function triggerSqueeze() {
    if (!cardEl) return;
    cardEl.classList.remove("fx-squeeze");
    void cardEl.offsetWidth;
    cardEl.classList.add("fx-squeeze");
    setTimeout(function () { cardEl.classList.remove("fx-squeeze"); }, 600);
  }

  // ---------- 屏幕裂痕 ----------
  let crackLayer = document.getElementById("crackLayer");
  if (!crackLayer) {
    crackLayer = document.createElement("div");
    crackLayer.id = "crackLayer";
    document.body.appendChild(crackLayer);
  }

  function addCrack(cx, cy) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "crack-svg");
    svg.style.left = "0";
    svg.style.top = "0";
    svg.setAttribute("width", W());
    svg.setAttribute("height", H());

    const shadowLines = [];
    const brightLines = [];
    const smallShadowLines = [];
    const smallLines = [];

    const branches = 14;
    for (let b = 0; b < branches; b++) {
      const baseAngle = (Math.PI * 2 * b) / branches + rand(-0.18, 0.18);
      let x = cx, y = cy;
      const segs = Math.floor(rand(5, 9));
      let points = x + "," + y;
      for (let s = 0; s < segs; s++) {
        const len = rand(35, 90);
        const ang = baseAngle + rand(-0.4, 0.4);
        x += Math.cos(ang) * len;
        y += Math.sin(ang) * len;
        points += " " + x + "," + y;
        if (s > 0 && Math.random() < 0.5) {
          let bx = x, by = y;
          const bang = ang + rand(-1.1, 1.1);
          for (let k = 0; k < Math.floor(rand(2, 4)); k++) {
            bx += Math.cos(bang) * rand(12, 32);
            by += Math.sin(bang) * rand(12, 32);
            smallLines.push(bx + "," + by);
            smallShadowLines.push(bx + "," + by);
          }
        }
      }
      brightLines.push(points);
      shadowLines.push(points);
    }

    shadowLines.forEach(function (pts) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      p.setAttribute("points", pts);
      p.setAttribute("class", "crack-shadow");
      svg.appendChild(p);
    });
    smallShadowLines.forEach(function (pts) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      p.setAttribute("points", pts);
      p.setAttribute("class", "crack-line-small-shadow");
      svg.appendChild(p);
    });
    brightLines.forEach(function (pts) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      p.setAttribute("points", pts);
      p.setAttribute("class", "crack-line");
      svg.appendChild(p);
    });
    smallLines.forEach(function (pts) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      p.setAttribute("points", pts);
      p.setAttribute("class", "crack-line-small");
      svg.appendChild(p);
    });

    const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    center.setAttribute("cx", cx);
    center.setAttribute("cy", cy);
    center.setAttribute("r", rand(4, 9));
    center.setAttribute("class", "crack-center");
    svg.appendChild(center);

    crackLayer.appendChild(svg);

    setTimeout(function () {
      svg.style.opacity = "0";
      setTimeout(function () { if (svg.parentNode) svg.parentNode.removeChild(svg); }, 800);
    }, 2000);
  }

  // ---------- 主渲染循环 ----------
  function loop() {
    ctx.clearRect(0, 0, W(), H());
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life--;

      if (p.type === "rocket") {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 12) p.trail.shift();
        p.x += p.vx; p.y += p.vy;
        for (let t = 0; t < p.trail.length; t++) {
          const a = (t / p.trail.length) * 0.8;
          ctx.fillStyle = "hsla(" + p.hue + ",100%,75%," + a + ")";
          const tr = Math.max(0.1, p.size * (t / p.trail.length));
          ctx.beginPath(); ctx.arc(p.trail[t].x, p.trail[t].y, tr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "hsla(" + p.hue + ",100%,85%,0.95)";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size + rand(-0.5, 0.5), 0, Math.PI * 2); ctx.fill();
        if (p.life <= 0) { explodeFirework(p.x, p.y, p.hue); particles.splice(i, 1); }
      } else if (p.type === "star") {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 6) p.trail.shift();
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.06;
        p.vx *= 0.985; p.vy *= 0.985;
        p.twinkle += 0.3;
        const twinkle = 0.6 + Math.abs(Math.sin(p.twinkle)) * 0.4;
        const alpha = (p.life / p.maxLife) * twinkle;
        for (let t = 0; t < p.trail.length; t++) {
          const ta = (t / p.trail.length) * alpha * 0.6;
          ctx.fillStyle = "hsla(" + p.hue + ",100%,70%," + ta + ")";
          const tr = Math.max(0.1, p.size * (t / p.trail.length) * 0.8);
          ctx.beginPath(); ctx.arc(p.trail[t].x, p.trail[t].y, tr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "hsla(" + p.hue + ",100%,80%," + alpha + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.size * (p.life / p.maxLife)), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === "flash") {
        const k = 1 - p.life / p.maxLife;
        const radius = Math.max(0.1, p.size * k);
        const alpha = p.life / p.maxLife;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        grad.addColorStop(0, "hsla(" + p.hue + ",100%,90%," + alpha + ")");
        grad.addColorStop(0.4, "hsla(" + p.hue + ",100%,70%," + (alpha * 0.5) + ")");
        grad.addColorStop(1, "hsla(" + p.hue + ",100%,60%,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === "spark") {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.05;
        p.vx *= 0.98; p.vy *= 0.98;
        const alpha = p.life / p.maxLife;
        ctx.fillStyle = "hsla(" + p.hue + ",100%," + (p.isImpact ? 60 : 65) + "%," + alpha + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.size * alpha), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === "emoji") {
        p.x += p.vx; p.y += p.vy;
        if (p.gravity) p.vy += p.gravity;
        p.rot += p.vrot;
        const alpha = Math.min(1, p.life / 20);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.font = p.size + "px serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.emoji, 0, 0);
        ctx.restore();
      } else if (p.type === "text") {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.05;
        const alpha = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.hue != null ? "hsl(" + p.hue + ",90%,65%)" : "#ffd166";
        ctx.font = "bold " + p.size + "px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      } else if (p.type === "confetti") {
        p.swing += 0.1;
        p.x += p.vx + Math.sin(p.swing) * 1.2;
        p.y += p.vy;
        if (p.gravity) p.vy += p.gravity;
        p.rot += p.vrot;
        const alpha = Math.min(1, p.life / 40);
        const flip = Math.abs(Math.cos(p.rot));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.sin(p.rot) * 0.3);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w * flip / 2, -p.h / 2, Math.max(0.5, p.w * flip), p.h);
        ctx.restore();
      }

      if (p.life <= 0 || p.y > H() + 120 || p.y < -200 || p.x < -200 || p.x > W() + 200) {
        particles.splice(i, 1);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
