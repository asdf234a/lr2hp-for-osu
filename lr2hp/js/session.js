// One play: turns osu!'s cumulative hit counters and stray key presses into LR2 judgements.

import { GaugeSet, computeTotal, PG, GR, GD, BD, PR, MS } from './gauge.js';

// osu!mania -> LR2: 320 PG, 300 GR, 200/100 GD, 50 BD, miss POOR
export function hitsToCounts(hits = {}) {
    const n = (k) => Number(hits[k]) || 0;
    return [n('geki'), n('300'), n('katu') + n('100'), n('50'), n('0')];
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

    addEmptyPoor() {
        this.emptyPoor++;
        this.judge(MS);
    }

    get judged() {
        return this.counts.reduce((a, b) => a + b, 0);
    }
}
