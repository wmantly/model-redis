'use strict';

const MockRedisClient = require('./helpers/mock-redis');
const setUpTable = require('../src/redis_model');

describe('ttl', () => {
    let client;
    let Table;

    beforeEach(() => {
        client = new MockRedisClient();
        Table = setUpTable(client, 'test:');
    });

    afterEach(() => {
        client.flushall();
    });

    // Model with a static per-model default TTL.
    function makeExpiringModel(seconds){
        class Session extends Table {
            static _key = 'id';
            static _ttl = seconds;
            static _keyMap = {
                id: { type: 'string', isRequired: true },
                data: { type: 'string' }
            };
        }
        return Session;
    }

    // Model with no default TTL.
    function makePlainModel(){
        class Thing extends Table {
            static _key = 'id';
            static _keyMap = {
                id: { type: 'string', isRequired: true },
                data: { type: 'string' }
            };
        }
        return Thing;
    }

    describe('static _ttl', () => {
        test('create sets expiry from the model default', async () => {
            const Session = makeExpiringModel(100);
            const s = await Session.create({ id: 'a', data: 'x' });

            const ttl = await s.ttl();
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(100);
        });

        test('no _ttl means no expiry', async () => {
            const Thing = makePlainModel();
            const t = await Thing.create({ id: 'a', data: 'x' });

            expect(await t.ttl()).toBe(-1);
        });
    });

    describe('per-call ttl', () => {
        test('create(data, {ttl}) overrides the static default', async () => {
            const Session = makeExpiringModel(100);
            const s = await Session.create({ id: 'a', data: 'x' }, { ttl: 5 });

            const ttl = await s.ttl();
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(5);
        });

        test('create(data, {ttl}) sets expiry on a model with no default', async () => {
            const Thing = makePlainModel();
            const t = await Thing.create({ id: 'a', data: 'x' }, { ttl: 10 });

            const ttl = await t.ttl();
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(10);
        });

        test('create(data, true) positional non-object does not throw or set ttl', async () => {
            const Thing = makePlainModel();
            // Regression guard: the proxy calls create({...}, true) positionally.
            const t = await Thing.create({ id: 'a', data: 'x' }, true);

            expect(t.id).toBe('a');
            expect(await t.ttl()).toBe(-1);
        });
    });

    describe('expiry and self-healing', () => {
        test('get() throws EntryNotFound after expiry', async () => {
            const Session = makeExpiringModel(10);
            await Session.create({ id: 'a', data: 'x' });

            client.advanceTime(11 * 1000);

            await expect(Session.get('a')).rejects.toMatchObject({ name: 'EntryNotFound' });
        });

        test('exists() returns false and heals the dangling member after expiry', async () => {
            const Session = makeExpiringModel(10);
            await Session.create({ id: 'a', data: 'x' });

            client.advanceTime(11 * 1000);

            expect(await Session.exists('a')).toBe(false);
            // The dangling index member should have been SREM'd by exists().
            expect(await Session.list()).not.toContain('a');
        });

        test('listDetail() skips expired entries and prunes the index', async () => {
            const Session = makeExpiringModel(10);
            await Session.create({ id: 'keep', data: 'x' }, { ttl: 1000 });
            await Session.create({ id: 'gone', data: 'y' }, { ttl: 5 });

            client.advanceTime(6 * 1000);

            const list = await Session.listDetail();
            expect(list.map(e => e.id)).toEqual(['keep']);
            // The expired member was pruned during the listing.
            expect(await Session.list()).not.toContain('gone');
        });

        test('re-create of an expired key succeeds', async () => {
            const Session = makeExpiringModel(10);
            await Session.create({ id: 'a', data: 'first' });

            client.advanceTime(11 * 1000);

            const again = await Session.create({ id: 'a', data: 'second' });
            expect(again.data).toBe('second');
        });
    });

    describe('update ttl behavior', () => {
        test('preserves remaining TTL when no {ttl} is passed', async () => {
            const Session = makeExpiringModel(100);
            const s = await Session.create({ id: 'a', data: 'x' });

            await s.update({ data: 'y' });

            const ttl = await s.ttl();
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(100);
        });

        test('update(data, {ttl}) resets the lifetime', async () => {
            const Session = makeExpiringModel(5);
            const s = await Session.create({ id: 'a', data: 'x' });

            await s.update({ data: 'y' }, { ttl: 500 });

            const ttl = await s.ttl();
            expect(ttl).toBeGreaterThan(100);
            expect(ttl).toBeLessThanOrEqual(500);
        });

        test('update(data, {ttl: 0}) clears the expiry', async () => {
            const Session = makeExpiringModel(100);
            const s = await Session.create({ id: 'a', data: 'x' });

            await s.update({ data: 'y' }, { ttl: 0 });

            expect(await s.ttl()).toBe(-1);
        });

        test('primary-key rename carries the remaining TTL across', async () => {
            const Session = makeExpiringModel(100);
            const s = await Session.create({ id: 'a', data: 'x' });

            await s.update({ id: 'b' });

            const renamed = await Session.get('b');
            const ttl = await renamed.ttl();
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(100);
        });

        test('rename on a no-TTL model leaves it without expiry', async () => {
            const Thing = makePlainModel();
            const t = await Thing.create({ id: 'a', data: 'x' });

            await t.update({ id: 'b' });

            const renamed = await Thing.get('b');
            expect(await renamed.ttl()).toBe(-1);
        });
    });

    describe('instance helpers', () => {
        test('expire() sets a lifetime and returns this', async () => {
            const Thing = makePlainModel();
            const t = await Thing.create({ id: 'a', data: 'x' });

            const ret = await t.expire(50);
            expect(ret).toBe(t);

            const ttl = await t.ttl();
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(50);
        });

        test('persist() removes the expiry and returns this', async () => {
            const Session = makeExpiringModel(100);
            const s = await Session.create({ id: 'a', data: 'x' });

            const ret = await s.persist();
            expect(ret).toBe(s);
            expect(await s.ttl()).toBe(-1);
        });

        test('ttl() returns -2 for a missing/expired record', async () => {
            const Session = makeExpiringModel(10);
            const s = await Session.create({ id: 'a', data: 'x' });

            client.advanceTime(11 * 1000);

            expect(await s.ttl()).toBe(-2);
        });
    });
});
