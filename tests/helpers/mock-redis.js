'use strict';

/**
 * Simple in-memory Redis mock for testing
 * Implements only the methods needed by model-redis
 */
class MockRedisClient {
    constructor() {
        this.data = new Map();
        this.sets = new Map();
        // key -> absolute expiry timestamp (mock-clock ms)
        this.expires = new Map();
        // Deterministic clock offset so tests can fast-forward without waiting.
        this._offset = 0;
    }

    // Current mock time. Tests move it forward with advanceTime().
    now() {
        return Date.now() + this._offset;
    }

    // Advance the mock clock, triggering lazy expiry on subsequent access.
    advanceTime(ms) {
        this._offset += ms;
    }

    // Lazily drop a key whose TTL has elapsed. Returns true if it was reaped.
    _reap(key) {
        if (this.expires.has(key) && this.now() >= this.expires.get(key)) {
            this.data.delete(key);
            this.sets.delete(key);
            this.expires.delete(key);
            return true;
        }
        return false;
    }

    _hasKey(key) {
        this._reap(key);
        return this.data.has(key) || this.sets.has(key);
    }

    async HSET(key, field, value) {
        this._reap(key);
        if (!this.data.has(key)) {
            this.data.set(key, new Map());
        }
        this.data.get(key).set(field, value);
        return 1;
    }

    async HGETALL(key) {
        this._reap(key);
        if (!this.data.has(key)) {
            return {};
        }
        const hash = this.data.get(key);
        const result = {};
        for (const [field, value] of hash.entries()) {
            result[field] = value;
        }
        return result;
    }

    async SADD(key, ...members) {
        if (!this.sets.has(key)) {
            this.sets.set(key, new Set());
        }
        const set = this.sets.get(key);
        members.forEach(member => set.add(member));
        return members.length;
    }

    async SREM(key, ...members) {
        if (!this.sets.has(key)) {
            return 0;
        }
        const set = this.sets.get(key);
        let removed = 0;
        members.forEach(member => {
            if (set.delete(member)) removed++;
        });
        return removed;
    }

    async SMEMBERS(key) {
        if (!this.sets.has(key)) {
            return [];
        }
        return Array.from(this.sets.get(key));
    }

    async SISMEMBER(key, member) {
        if (!this.sets.has(key)) {
            return 0;
        }
        return this.sets.get(key).has(member) ? 1 : 0;
    }

    async DEL(...keys) {
        let deleted = 0;
        keys.forEach(key => {
            if (this.data.delete(key)) deleted++;
            if (this.sets.delete(key)) deleted++;
            this.expires.delete(key);
        });
        return deleted;
    }

    async RENAME(oldKey, newKey) {
        if (this.data.has(oldKey)) {
            this.data.set(newKey, this.data.get(oldKey));
            this.data.delete(oldKey);
        }
        if (this.sets.has(oldKey)) {
            this.sets.set(newKey, this.sets.get(oldKey));
            this.sets.delete(oldKey);
        }
        // Redis moves the TTL with the key on RENAME.
        if (this.expires.has(oldKey)) {
            this.expires.set(newKey, this.expires.get(oldKey));
            this.expires.delete(oldKey);
        }
        return 'OK';
    }

    async EXPIRE(key, seconds) {
        if (!this._hasKey(key)) return 0;
        this.expires.set(key, this.now() + seconds * 1000);
        return 1;
    }

    async PEXPIRE(key, ms) {
        if (!this._hasKey(key)) return 0;
        this.expires.set(key, this.now() + ms);
        return 1;
    }

    async PERSIST(key) {
        if (this._hasKey(key) && this.expires.has(key)) {
            this.expires.delete(key);
            return 1;
        }
        return 0;
    }

    async TTL(key) {
        if (!this._hasKey(key)) return -2;
        if (!this.expires.has(key)) return -1;
        return Math.ceil((this.expires.get(key) - this.now()) / 1000);
    }

    async PTTL(key) {
        if (!this._hasKey(key)) return -2;
        if (!this.expires.has(key)) return -1;
        return this.expires.get(key) - this.now();
    }

    async EXISTS(...keys) {
        let count = 0;
        keys.forEach(key => {
            if (this._hasKey(key)) count++;
        });
        return count;
    }

    async TYPE(key) {
        this._reap(key);
        if (this.sets.has(key)) return 'set';
        if (this.data.has(key)) return 'hash';
        return 'none';
    }

    async SCAN(cursor, options = {}) {
        const match = options.MATCH;
        // Translate a redis glob (only '*' is used by model-redis) to a regex.
        const test = match
            ? new RegExp('^' + match.split('*')
                .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('.*') + '$')
            : null;

        const keys = new Set([...this.data.keys(), ...this.sets.keys()]);
        const matched = [...keys]
            .filter(key => !this._reap(key))
            .filter(key => !test || test.test(key));

        // Return everything in a single page; a '0' cursor ends the scan.
        return { cursor: 0, keys: matched };
    }

    flushall() {
        this.data.clear();
        this.sets.clear();
        this.expires.clear();
        this._offset = 0;
    }
}

module.exports = MockRedisClient;
