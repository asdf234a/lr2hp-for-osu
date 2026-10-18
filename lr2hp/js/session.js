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

export class PlaySession {
    constructor({ notes, totalMode = 'standard', totalValue = 300, start = 'exhard', bottom = 'easy' }) {
        this.totalMode = totalMode;
        this.totalValue = totalValue;
        this.start = start;
        this.bottom = bottom;
        this.counts = [0, 0, 0, 0, 0];
        this.emptyPoor = 0;
        this.history = [];
        // BMS combo: PG/GR/GD keep it, BD/POOR break it, empty POOR leaves it alone
        this.combo = 0;
        this.maxCombo = 0;
        // FAST/SLOW per judge (PG..MS); POOR uses earlyMisses instead
        this.fast = [0, 0, 0, 0, 0, 0];
        this.slow = [0, 0, 0, 0, 0, 0];
        this.earlyMisses = 0;
        this.setNotes(notes);
    }

    // Rebuilds the gauges for a new note count and replays everything so far
    setNotes(notes) {
        this.notes = Math.max(1, Math.round(notes) || 1);
        this.total = computeTotal(this.notes, this.totalMode, this.totalValue);
        this.gauges = new GaugeSet({ notes: this.notes, total: this.total, start: this.start, bottom: this.bottom });
        for (const judge of this.history) this.gauges.update(judge);
    }

    setRange(start, bottom) {
        this.start = start;
        this.bottom = bottom;
        this.gauges.setRange(start, bottom);
    }

    judge(judge) {
        this.history.push(judge);
        this.gauges.update(judge);
        if (judge === PG || judge === GR || judge === GD) {
            this.combo++;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
        } else if (judge === BD || judge === PR) {
            this.combo = 0;
        }
    }

    // Applies whatever the counters gained since the last call. Returns false when
    // they went down, which means osu! started the play over.
    applyHits(hits) {
        const next = hitsToCounts(hits);
        const delta = next.map((v, i) => v - this.counts[i]);
        if (delta.some((d) => d < 0)) return false;
        this.counts = next;
        // Several judgements can land in one update; their real order is unknown,
        // so spread them round-robin instead of applying one kind in a block.
        const judges = [PG, GR, GD, BD, PR];
        let left = delta.reduce((a, b) => a + b, 0);
        while (left > 0) {
            for (let i = 0; i < judges.length; i++) {
                if (delta[i] > 0) {
                    delta[i]--;
                    left--;
                    this.judge(judges[i]);
                }
            }
        }
        return true;
    }

    addEmptyPoor(fast = false) {
        this.emptyPoor++;
        (fast ? this.fast : this.slow)[MS]++;
        this.judge(MS);
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
        return this.counts.reduce((a, b) => a + b, 0);
    }

    get exScore() {
        return this.counts[PG] * 2 + this.counts[GR];
    }

    // EX score over the notes judged so far (0..1)
    get rate() {
        const judged = this.judged;
        return judged ? this.exScore / (judged * 2) : 0;
    }

    get comboBreaks() {
        return this.counts[BD] + this.counts[PR];
    }

    // POOR split: early misses are FAST, notes left to pass are SLOW
    poorFastSlow() {
        const fast = Math.min(this.earlyMisses, this.counts[PR]);
        return [fast, this.counts[PR] - fast];
    }
}
