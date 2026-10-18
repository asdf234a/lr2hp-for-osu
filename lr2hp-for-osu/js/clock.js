// Estimates the current song position between tosu updates.
// tosu's `beatmap.time.live` can be up to one poll old when it arrives, never
// newer, so the freshest-looking sample (largest live - now * rate) wins.

export class SongClock {
    constructor() {
        this.valid = false;
        this.offset = 0;
        this.rate = 1;
        this.paused = false;
        this.pausedAt = 0;
        this.lastSample = 0;
    }

    reset() {
        this.valid = false;
    }

    sample(live, now, rate = 1, paused = false) {
        if (rate !== this.rate) this.valid = false;
        this.rate = rate;
        if (paused) {
            this.paused = true;
            this.pausedAt = live;
            this.valid = false;
            return;
        }
        this.paused = false;
        const s = live - now * rate;
        if (!this.valid || s > this.offset || s < this.offset - 250) {
            this.offset = s;
            this.valid = true;
        } else {
            // Slow decay so audio drift can't pin the estimate too far ahead
            const dt = Math.max(0, now - this.lastSample);
            this.offset -= dt * 0.002;
        }
        this.lastSample = now;
    }

    now(now) {
        if (this.paused) return this.pausedAt;
        return now * this.rate + this.offset;
    }
}
