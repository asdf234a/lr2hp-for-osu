// One play: turns osu!'s cumulative hit counters and stray key presses into LR2 judgements.

import { GaugeSet, computeTotal, PG, GR, GD, BD, PR, MS } from './gauge.js';

// osu!mania -> LR2: 320 PG, 300 GR, 200/100 GD, 50 BD, miss POOR
export function hitsToCounts(hits = {}) {
    const n = (k) => Number(hits[k]) || 0;
    return [n('geki'), n('300'), n('katu') + n('100'), n('50'), n('0')];
}

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'AA', 'AAA'];

// BMS rank from a score rate: AAA from 8/9, AA from 7/9 ... E from 2/9
export function rankIndex(rate) {
    return Math.min(7, Math.max(0, Math.floor(rate * 9 + 1e-9) - 1));
}

// How far apart (ms) an early-press MISS and the POOR it turns into may be seen
const CONVERT_WINDOW = 500;

export class PlaySession {
    constructor({ notes, totalMode = 'standard', totalValue = 300, start = 'exhard', bottom = 'easy' }) {
        this.totalMode = totalMode;
        this.totalValue = totalValue;
        this.start = start;
        this.bottom = bottom;
        this.raw = [0, 0, 0, 0, 0]; // osu!'s counters as LR2 judges
        this.converted = 0; // osu! early-press MISSes counted as BAD instead of POOR
        this.emptyPoor = 0;
        this.history = []; // { judge, at }
        this.poors = []; // POORs that may still turn out to be early-press MISSes: { index, at }
        this.credits = []; // early-press MISSes whose POOR hasn't arrived yet: times
        // BMS combo: PG/GR/GD keep it, BD/POOR break it, empty POOR leaves it alone
        this.combo = 0;
        this.maxCombo = 0;
        // FAST/SLOW per judge (PG..MS); POOR uses earlyMisses instead
        this.fast = [0, 0, 0, 0, 0, 0];
        this.slow = [0, 0, 0, 0, 0, 0];
        this.earlyMisses = 0; // early-press MISSes kept as POOR
        this.setNotes(notes);
    }

    // Judge counts after early-press MISSes became BADs
    get counts() {
        const [pg, gr, gd, bd, pr] = this.raw;
        return [pg, gr, gd, bd + this.converted, pr - this.converted];
    }

    // Rebuilds the gauges for a new note count and replays everything so far
    setNotes(notes) {
        this.notes = Math.max(1, Math.round(notes) || 1);
        this.total = computeTotal(this.notes, this.totalMode, this.totalValue);
        this.rebuildGauges();
    }

    rebuildGauges() {
        this.gauges = new GaugeSet({ notes: this.notes, total: this.total, start: this.start, bottom: this.bottom });
        for (const h of this.history) this.gauges.update(h.judge);
    }

    setRange(start, bottom) {
        this.start = start;
        this.bottom = bottom;
        this.gauges.setRange(start, bottom);
    }

    judge(judge, at = 0) {
        if (judge === PR && this.takeCredit(at)) {
            judge = BD;
            this.converted++;
            this.fast[BD]++;
        }
        this.history.push({ judge, at });
        if (judge === PR) this.poors.push({ index: this.history.length - 1, at });
        this.gauges.update(judge);
        if (judge === PG || judge === GR || judge === GD) {
            this.combo++;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
        } else if (judge === BD || judge === PR) {
            this.combo = 0;
        }
    }

    takeCredit(at) {
        this.credits = this.credits.filter((t) => at - t <= CONVERT_WINDOW);
        const i = this.credits.findIndex((t) => Math.abs(at - t) <= CONVERT_WINDOW);
        if (i < 0) return false;
        this.credits.splice(i, 1);
        return true;
    }

    // A press that osu! scored as an early MISS. LR2 would call it a BAD (it's
    // inside LR2's 200 ms BAD window), so with `asBad` its POOR becomes a BAD.
    earlyMiss(at = 0, asBad = true) {
        if (!asBad) {
            this.earlyMisses++;
            return;
        }
        let best = -1;
        for (let i = 0; i < this.poors.length; i++) {
            const d = Math.abs(this.poors[i].at - at);
            if (d <= CONVERT_WINDOW && (best < 0 || d < Math.abs(this.poors[best].at - at))) best = i;
        }
        if (best < 0) {
            // osu!'s MISS counter hasn't caught up yet
            this.credits.push(at);
            return;
        }
        const [p] = this.poors.splice(best, 1);
        this.history[p.index].judge = BD;
        this.converted++;
        this.fast[BD]++;
        this.rebuildGauges();
    }

    // Applies whatever the counters gained since the last call. Returns false when
    // they went down, which means osu! started the play over.
    applyHits(hits, at = 0) {
        const next = hitsToCounts(hits);
        const delta = next.map((v, i) => v - this.raw[i]);
        if (delta.some((d) => d < 0)) return false;
        this.raw = next;
        this.poors = this.poors.filter((p) => at - p.at <= CONVERT_WINDOW);
        // Several judgements can land in one update; their real order is unknown,
        // so spread them round-robin instead of applying one kind in a block.
        const judges = [PG, GR, GD, BD, PR];
        let left = delta.reduce((a, b) => a + b, 0);
        while (left > 0) {
            for (let i = 0; i < judges.length; i++) {
                if (delta[i] > 0) {
                    delta[i]--;
                    left--;
                    this.judge(judges[i], at);
                }
            }
        }
        return true;
    }

    addEmptyPoor(fast = false, at = 0) {
        this.emptyPoor++;
        (fast ? this.fast : this.slow)[MS]++;
        this.judge(MS, at);
    }

    // FAST/SLOW from osu!'s timing offsets (negative = early), bucketed by hit window
    addHitOffsets(offsets, w) {
        for (const o of offsets) {
            const a = Math.abs(o);
            const judge = a <= w.perfect ? PG : a <= w.great ? GR : a <= w.ok ? GD : a <= w.meh ? BD : -1;
            if (judge < 0 || o === 0) continue;
            (o < 0 ? this.fast : this.slow)[judge]++;
        }
    }

    get judged() {
        return this.raw.reduce((a, b) => a + b, 0);
    }

    get exScore() {
        return this.raw[PG] * 2 + this.raw[GR];
    }

    // EX score over the notes judged so far (0..1)
    get rate() {
        const judged = this.judged;
        return judged ? this.exScore / (judged * 2) : 0;
    }

    get comboBreaks() {
        const c = this.counts;
        return c[BD] + c[PR];
    }

    // POOR split: early-press MISSes kept as POOR are FAST, notes left to pass are SLOW
    poorFastSlow() {
        const pr = this.counts[PR];
        const fast = Math.min(this.earlyMisses, pr);
        return [fast, pr - fast];
    }
}
