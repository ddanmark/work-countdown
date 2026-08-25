// vent 组件 — 解压发泄 Canvas 2D 粒子引擎（作为主页透明覆盖层，不开新页面）
// 粒子类型：rocket / star / flash / spark / emoji / text / confetti / crack
// 变色特效会通知主页切换背景（changebg 事件），本组件自身不持有背景。
const theme = require("../../utils/theme.js");
const BG_PALETTES = theme.BG_PALETTES;

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(v) {
        if (v) {
          // canvas 节点随 wx:if 渲染，等下一帧再取
          wx.nextTick(() => this.initCanvas());
        } else {
          this._onHide();
        }
      },
    },
  },

  data: {
    actions: [
      { key: "fw", emoji: "🎆" },
      { key: "punch", emoji: "👊" },
      { key: "poop", emoji: "💩" },
      { key: "crush", emoji: "💢" },
      { key: "bg", emoji: "🎨" },
      { key: "party", emoji: "🎉" },
    ],
    fxShake: false,
    fxSqueeze: false,
  },

  lifetimes: {
    created() {
      this.particles = [];
      this.cracks = [];
      this.MAX_PARTICLES = 1200;
      this.lastFire = {};
      this.COOLDOWN = 300;
      this.bgIdx = theme.loadBgIdx();
      this.running = false;
      this._timers = [];
    },
    detached() { this._onHide(); },
  },

  methods: {
    _onHide() {
      this.running = false;
      this._timers.forEach((t) => clearTimeout(t));
      this._timers = [];
    },

    // ---------- Canvas 初始化（组件内需 .in(this)）----------
    initCanvas() {
      const q = this.createSelectorQuery().in(this);
      q.select("#fxCanvas").fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        this.canvas = res[0].node;
        this.ctx = this.canvas.getContext("2d");
        const info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
        this.dpr = info.pixelRatio || 1;
        this.Ww = info.windowWidth;
        this.Hh = info.windowHeight;
        this.canvas.width = this.Ww * this.dpr;
        this.canvas.height = this.Hh * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.loopBound = this.loop.bind(this);
        this.running = true;
        this.canvas.requestAnimationFrame(this.loopBound);
      });
    },

    rand(a, b) { return a + Math.random() * (b - a); },
    W() { return this.Ww; },
    H() { return this.Hh; },
    addParticle(p) { if (this.particles.length >= this.MAX_PARTICLES) this.particles.shift(); this.particles.push(p); },
    later(fn, ms) { const t = setTimeout(fn, ms); this._timers.push(t); return t; },

    // ---------- 烟花 ----------
    launchFirework() {
      const x = this.rand(this.W() * 0.15, this.W() * 0.85);
      const targetY = this.rand(this.H() * 0.12, this.H() * 0.4);
      const startY = this.H();
      const hue = Math.floor(this.rand(0, 360));
      const riseFrames = 55;
      this.addParticle({
        type: "rocket", x: x, y: startY, vx: this.rand(-0.3, 0.3),
        vy: -(startY - targetY) / riseFrames, life: riseFrames, maxLife: riseFrames,
        hue: hue, size: 2.5, trail: [],
      });
    },
    explodeFirework(x, y, hue) {
      const outer = 48, inner = 24;
      for (let i = 0; i < outer; i++) {
        const angle = (Math.PI * 2 * i) / outer + this.rand(-0.05, 0.05);
        const speed = this.rand(3.5, 6.5);
        this.addParticle({
          type: "star", x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: this.rand(60, 95), maxLife: 95, hue: hue + this.rand(-15, 15),
          size: this.rand(2, 3.5), trail: [], twinkle: this.rand(0, Math.PI * 2),
        });
      }
      for (let i = 0; i < inner; i++) {
        const angle = this.rand(0, Math.PI * 2);
        const speed = this.rand(1, 3);
        this.addParticle({
          type: "star", x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: this.rand(40, 70), maxLife: 70, hue: hue + this.rand(-20, 20),
          size: this.rand(1.5, 2.5), trail: [], twinkle: this.rand(0, Math.PI * 2),
        });
      }
      this.addParticle({ type: "flash", x: x, y: y, life: 12, maxLife: 12, size: 40, hue: hue });
    },

    // ---------- 打拳 ----------
    launchPunch() {
      const emojis = ["👊", "🥊", "💪"];
      const cx = this.rand(this.W() * 0.25, this.W() * 0.75);
      const cy = this.rand(this.H() * 0.25, this.H() * 0.65);
      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft ? -80 : this.W() + 80;
      const dir = fromLeft ? 1 : -1;
      this.particles.push({
        type: "emoji", emoji: emojis[Math.floor(this.rand(0, emojis.length))],
        x: startX, y: cy, vx: dir * this.rand(20, 30), vy: 0, life: 28, maxLife: 28,
        size: this.rand(90, 130), rot: 0, vrot: this.rand(-0.1, 0.1),
      });
      this.later(() => {
        this.addCrack(cx, cy);
        this.triggerShake(14, 500);
        for (let i = 0; i < 24; i++) {
          const a = this.rand(0, Math.PI * 2);
          const s = this.rand(5, 12);
          this.addParticle({
            type: "spark", x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: this.rand(30, 50), maxLife: 50, hue: this.rand(0, 40), size: this.rand(3, 7), isImpact: true,
          });
        }
        this.addParticle({ type: "text", text: "砰!", x: cx, y: cy, vx: 0, vy: -1, life: 45, maxLife: 45, size: 64 });
      }, 480);
    },

    // ---------- 扔大便 ----------
    launchPoop() {
      for (let i = 0; i < 10; i++) {
        const side = Math.floor(this.rand(0, 4));
        let x, y, vx, vy;
        if (side === 0) { x = this.rand(20, this.W() * 0.2); y = this.H() + this.rand(30, 80); vx = this.rand(8, 13); vy = -this.rand(14, 19); }
        else if (side === 1) { x = this.rand(this.W() * 0.8, this.W() - 20); y = this.H() + this.rand(30, 80); vx = -this.rand(8, 13); vy = -this.rand(14, 19); }
        else if (side === 2) { x = this.rand(20, this.W() * 0.2); y = this.rand(20, this.H() * 0.15); vx = this.rand(7, 12); vy = this.rand(2, 5); }
        else { x = this.rand(this.W() * 0.35, this.W() * 0.65); y = this.H() + this.rand(30, 80); vx = this.rand(-6, 6); vy = -this.rand(16, 22); }
        this.addParticle({
          type: "emoji", emoji: "💩", x: x, y: y, vx: vx, vy: vy,
          life: 200, maxLife: 200, size: this.rand(48, 72), rot: 0, vrot: this.rand(-0.3, 0.3), gravity: 0.42,
        });
      }
    },

    // ---------- 捏碎 ----------
    launchCrush() {
      this.triggerSqueeze();
      const words = ["啊—", "碎!", "💥", "呃!", "嘎!"];
      for (let i = 0; i < 16; i++) {
        this.addParticle({
          type: "text", text: words[Math.floor(this.rand(0, words.length))],
          x: this.W() / 2 + this.rand(-120, 120), y: this.H() / 2 + this.rand(-80, 80),
          vx: this.rand(-4, 4), vy: this.rand(-7, -2), life: this.rand(45, 75), maxLife: 75,
          size: this.rand(22, 46), hue: this.rand(0, 30),
        });
      }
      for (let i = 0; i < 16; i++) {
        const a = this.rand(0, Math.PI * 2);
        const s = this.rand(3, 8);
        this.addParticle({
          type: "spark", x: this.W() / 2, y: this.H() / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: this.rand(25, 45), maxLife: 45, hue: this.rand(0, 30), size: this.rand(2, 5),
        });
      }
    },

    // ---------- 彩带 ----------
    launchConfetti() {
      const colors = ["#ff6b6b", "#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#06d6a0", "#ffd166", "#fff"];
      for (let i = 0; i < 80; i++) {
        this.later(() => {
          this.addParticle({
            type: "confetti", x: this.rand(0, this.W()), y: this.rand(-40, -10),
            vx: this.rand(-2, 2), vy: this.rand(2, 5), life: this.rand(180, 280), maxLife: 280,
            w: this.rand(6, 12), h: this.rand(14, 22), rot: this.rand(0, Math.PI * 2), vrot: this.rand(-0.25, 0.25),
            color: colors[Math.floor(this.rand(0, colors.length))], swing: this.rand(0, Math.PI * 2), gravity: 0.05,
          });
        }, i * 25);
      }
    },

    // ---------- 变色（切换主页背景）----------
    changeBgColor() {
      let next;
      do { next = Math.floor(this.rand(0, BG_PALETTES.length)); } while (next === this.bgIdx && BG_PALETTES.length > 1);
      this.bgIdx = next;
      theme.saveBgIdx(next);
      this.triggerEvent("changebg", { idx: next });
    },

    // ---------- 震屏 / 挤压 ----------
    triggerShake(intensity, duration) {
      this.setData({ fxShake: false });
      this.later(() => {
        this.setData({ fxShake: true });
        this.later(() => this.setData({ fxShake: false }), duration);
      }, 16);
    },
    triggerSqueeze() {
      this.setData({ fxSqueeze: false });
      this.later(() => {
        this.setData({ fxSqueeze: true });
        this.later(() => this.setData({ fxSqueeze: false }), 600);
      }, 16);
    },

    // ---------- 屏幕裂痕 ----------
    addCrack(cx, cy) {
      const shadowLines = [], brightLines = [], small = [];
      const branches = 14;
      for (let b = 0; b < branches; b++) {
        const baseAngle = (Math.PI * 2 * b) / branches + this.rand(-0.18, 0.18);
        let x = cx, y = cy;
        const segs = Math.floor(this.rand(5, 9));
        const pts = [[x, y]];
        for (let s = 0; s < segs; s++) {
          const len = this.rand(35, 90);
          const ang = baseAngle + this.rand(-0.4, 0.4);
          x += Math.cos(ang) * len; y += Math.sin(ang) * len;
          pts.push([x, y]);
          if (s > 0 && Math.random() < 0.5) {
            let bx = x, by = y;
            const bang = ang + this.rand(-1.1, 1.1);
            for (let k = 0; k < Math.floor(this.rand(2, 4)); k++) {
              bx += Math.cos(bang) * this.rand(12, 32);
              by += Math.sin(bang) * this.rand(12, 32);
              small.push([[x, y], [bx, by]]);
            }
          }
        }
        shadowLines.push(pts); brightLines.push(pts);
      }
      this.cracks.push({ cx: cx, cy: cy, shadowLines: shadowLines, brightLines: brightLines, small: small, life: 120, maxLife: 120 });
    },
    strokePoly(pts) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    },
    drawCrack(c) {
      const ctx = this.ctx;
      const alpha = Math.max(0, c.life / c.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 6;
      c.shadowLines.forEach((pts) => this.strokePoly(pts));
      ctx.lineWidth = 3;
      c.small.forEach((pair) => { ctx.beginPath(); ctx.moveTo(pair[0][0], pair[0][1]); ctx.lineTo(pair[1][0], pair[1][1]); ctx.stroke(); });
      ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 2;
      c.brightLines.forEach((pts) => this.strokePoly(pts));
      ctx.lineWidth = 1;
      c.small.forEach((pair) => { ctx.beginPath(); ctx.moveTo(pair[0][0], pair[0][1]); ctx.lineTo(pair[1][0], pair[1][1]); ctx.stroke(); });
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.beginPath(); ctx.arc(c.cx, c.cy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    // ---------- 主渲染循环 ----------
    loop() {
      if (!this.running) return;
      const ctx = this.ctx;
      const W = this.W(), H = this.H();
      ctx.clearRect(0, 0, W, H);

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
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
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size + this.rand(-0.5, 0.5), 0, Math.PI * 2); ctx.fill();
          if (p.life <= 0) { this.explodeFirework(p.x, p.y, p.hue); this.particles.splice(i, 1); }
        } else if (p.type === "star") {
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 6) p.trail.shift();
          p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.985; p.vy *= 0.985;
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
          p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.vx *= 0.98; p.vy *= 0.98;
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
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.font = p.size + "px serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(p.emoji, 0, 0);
          ctx.restore();
        } else if (p.type === "text") {
          p.x += p.vx; p.y += p.vy; p.vy += 0.05;
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
          ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.rot) * 0.3);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w * flip / 2, -p.h / 2, Math.max(0.5, p.w * flip), p.h);
          ctx.restore();
        }

        if (p.life <= 0 || p.y > H + 120 || p.y < -200 || p.x < -200 || p.x > W + 200) this.particles.splice(i, 1);
      }

      // 裂痕（随帧淡出）
      for (let i = this.cracks.length - 1; i >= 0; i--) {
        const c = this.cracks[i];
        c.life--;
        this.drawCrack(c);
        if (c.life <= 0) this.cracks.splice(i, 1);
      }

      this.canvas.requestAnimationFrame(this.loopBound);
    },

    // ---------- 动作派发（带防抖）----------
    fire(key, fn) {
      const now = Date.now();
      if (now - (this.lastFire[key] || 0) < this.COOLDOWN) return;
      this.lastFire[key] = now;
      fn();
    },
    doAction(e) {
      const key = e.currentTarget.dataset.key;
      if (key === "fw") this.fire("fw", () => { for (let i = 0; i < 5; i++) this.later(() => this.launchFirework(), i * 320); });
      else if (key === "punch") this.fire("punch", () => this.launchPunch());
      else if (key === "poop") this.fire("poop", () => this.launchPoop());
      else if (key === "crush") this.fire("crush", () => this.launchCrush());
      else if (key === "bg") this.fire("bg", () => this.changeBgColor());
      else if (key === "party") this.fire("party", () => { for (let i = 0; i < 3; i++) this.later(() => this.launchFirework(), i * 450); this.launchConfetti(); });
    },
  },
});
