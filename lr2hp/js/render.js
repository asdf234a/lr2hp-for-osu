// Canvas renderer that draws the gauge the way beatoraja's SkinGauge does,
// using the 8-node image layout from the simple-play skin.

const SEG_W = 12;
const SEG_H = 35;
const NUM_W = 26;
const NUM_H = 28;
const DOT_X = 286;
const DOT_W = 8;
const NUM_GAP = 8; // between the bar and the number
const NUM_BOX = 112; // "xxx.x": 3 digits, dot, 1 digit
const BAR_H = 36;

// beatoraja's 8-node mapping: node row 0 (n1..n4) is used by GROOVE and HARD,
// row 1 (e1..e4) by EASY and EX-HARD.
const SKIN_ROW = { groove: 0, hard: 0, easy: 1, exhard: 1 };

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${src}`));
        img.src = src;
    });
}

export class GaugeRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.parts = 50;
        this.length = 0; // bar length in px; 0 = 12 px per segment like the skin
        this.skin = null;
        this.anim = 0;
        this.animUntil = 0;
        // beatoraja defaults for a lua gauge: random animation, range 3, cycle 33ms
        this.animRange = 3;
        this.animCycle = 33;
    }

    async setSkin(name) {
        if (this.skinName === name && this.skin) return;
        const base = `skins/${encodeURIComponent(name)}/`;
        const [gauge, num] = await Promise.all([loadImage(base + 'gauge.png'), loadImage(base + 'num.png')]);
        this.skin = { gauge, num };
        this.skinName = name;
    }

    setLayout(parts, length = 0) {
        this.parts = Math.max(10, Math.min(200, Math.round(parts) || 50));
        this.length = Math.max(0, Math.round(length) || 0);
        this.canvas.width = this.barWidth + NUM_GAP + NUM_BOX;
        this.canvas.height = BAR_H;
    }

    get barWidth() {
        return this.length > 0 ? Math.max(this.parts, this.length) : this.parts * SEG_W;
    }

    get width() {
        return this.canvas.width;
    }

    // Source rect of node `slot` (0 lit/above border, 1 lit/below, 2 dark/above, 3 dark/below)
    segmentSource(type, slot) {
        const row = SKIN_ROW[type] ?? 0;
        const img = this.skin.gauge;
        const y = row * SEG_H;
        return [slot * SEG_W, y, SEG_W, Math.min(SEG_H, img.height - y)];
    }

    draw(gauge, now, { showNumber = true } = {}) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (!this.skin || !gauge) return;

        if (this.animUntil < now) {
            this.anim = Math.floor(Math.random() * (this.animRange + 1));
            this.animUntil = now + this.animCycle;
        }

        const { value, max, border, type } = gauge;
        const parts = this.parts;
        const lit = value > 0 ? Math.max(1, Math.floor(value * parts / max)) : 0;
        const segW = this.barWidth / parts;
        const y = 0;

        ctx.imageSmoothingEnabled = false;
        for (let i = 1; i <= parts; i++) {
            const below = i * max / parts < border ? 1 : 0;
            const on = i === lit || lit - this.anim > i;
            const [sx, sy, sw, sh] = this.segmentSource(type, (on ? 0 : 2) + below);
            // Whole-pixel edges so stretched segments don't leave seams
            const x0 = Math.round((i - 1) * segW);
            const x1 = Math.round(i * segW);
            ctx.drawImage(this.skin.gauge, sx, sy, sw, sh, x0, y, x1 - x0, BAR_H);
        }

        if (showNumber) this.drawNumber(value);
    }

    // "xxx.x" in the skin's digits, to the right of the bar and centred on it
    drawNumber(value) {
        const ctx = this.ctx;
        const num = this.skin.num;
        const v = Math.max(0, value);
        const intPart = Math.floor(v);
        const frac = Math.floor(v * 10) % 10;
        const x0 = this.barWidth + NUM_GAP;
        const y = (BAR_H - NUM_H) / 2;
        const digits = String(intPart).padStart(3, ' ');
        for (let i = 0; i < 3; i++) {
            if (digits[i] === ' ') continue;
            ctx.drawImage(num, Number(digits[i]) * NUM_W, 0, NUM_W, NUM_H, x0 + i * NUM_W, y, NUM_W, NUM_H);
        }
        ctx.drawImage(num, DOT_X, 0, DOT_W, NUM_H, x0 + 78, y, DOT_W, NUM_H);
        ctx.drawImage(num, frac * NUM_W, 0, NUM_W, NUM_H, x0 + 86, y, NUM_W, NUM_H);
    }
}
