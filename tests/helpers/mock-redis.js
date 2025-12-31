'use strict';

/**
 * Simple in-memory Redis mock for testing
 * Implements only the methods needed by model-redis
 */
class MockRedisClient {
    constructor() {
        this.data = new Map();
        this.sets = new Map();
    }

    async HSET(key, field, value) {
        if (!this.data.has(key)) {
            this.data.set(key, new Map());
        }
        this.data.get(key).set(field, value);
        return 1;
    }

    async HGETALL(key) {
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
        return 'OK';
    }

    flushall() {
        this.data.clear();
        this.sets.clear();
    }
}

module.exports = MockRedisClient;
