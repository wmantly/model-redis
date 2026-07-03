'use strict';

const MockRedisClient = require('./helpers/mock-redis');
const setUpTable = require('../src/redis_model');

describe('findOrphans / pruneOrphans', () => {
    let client;
    let Table;
    let User;
    let Post;

    beforeEach(() => {
        client = new MockRedisClient();
        Table = setUpTable(client, 'test:');

        // Reset the shared registry from previous tests.
        Table.models = {};

        class TestUser extends Table {
            static _key = 'id';
            static _keyMap = {
                id: { type: 'string', isRequired: true },
                name: { type: 'string', isRequired: true },
            };
        }

        class TestPost extends Table {
            static _key = 'id';
            static _keyMap = {
                id: { type: 'string', isRequired: true },
                title: { type: 'string', isRequired: true },
                userId: { type: 'string', isRequired: true },
                user: { model: 'TestUser', rel: 'one', localKey: 'userId' },
            };
        }

        User = TestUser;
        Post = TestPost;

        User.register();
        Post.register();
    });

    afterEach(() => {
        client.flushall();
    });

    test('reports no orphans for a consistent dataset', async () => {
        await User.create({ id: 'user1', name: 'John' });
        await Post.create({ id: 'post1', title: 'Hi', userId: 'user1' });

        const report = await Table.findOrphans();

        expect(report.prefix).toBe('test:');
        expect(report.totals).toEqual({ leaked: 0, dangling: 0, brokenRelations: 0 });
        expect(report.models.TestUser.counts).toEqual({ members: 1, hashes: 1 });
        expect(report.models.TestPost.counts).toEqual({ members: 1, hashes: 1 });
    });

    test('detects a leaked hash (hash present, not in the index set)', async () => {
        await User.create({ id: 'user1', name: 'John' });
        // Drop the index entry but leave the hash behind.
        await client.SREM('test:TestUser', 'user1');

        const report = await Table.findOrphans();

        expect(report.models.TestUser.leaked).toEqual(['user1']);
        expect(report.models.TestUser.dangling).toEqual([]);
        expect(report.totals.leaked).toBe(1);
    });

    test('detects a dangling member (index set entry, no hash)', async () => {
        await User.create({ id: 'user1', name: 'John' });
        await client.SADD('test:TestUser', 'ghost');

        const report = await Table.findOrphans();

        expect(report.models.TestUser.dangling).toEqual(['ghost']);
        expect(report.models.TestUser.leaked).toEqual([]);
        expect(report.totals.dangling).toBe(1);
    });

    test('detects a broken rel:one foreign key', async () => {
        // Post references a user that does not exist.
        await Post.create({ id: 'post1', title: 'Orphaned', userId: 'nobody' });

        const report = await Table.findOrphans();

        expect(report.totals.brokenRelations).toBe(1);
        expect(report.models.TestPost.brokenRelations[0]).toEqual({
            id: 'post1',
            field: 'user',
            target: 'TestUser',
            fk: 'nobody',
        });
    });

    test('does not flag a valid rel:one foreign key', async () => {
        await User.create({ id: 'user1', name: 'John' });
        await Post.create({ id: 'post1', title: 'Good', userId: 'user1' });

        const report = await Table.findOrphans();

        expect(report.totals.brokenRelations).toBe(0);
    });

    test('discovers unregistered model families from the keyspace', async () => {
        // A model used but never register()-ed still writes the same key shapes.
        await client.SADD('test:Widget', 'w1');
        await client.HSET('test:Widget_w1', 'id', 'w1');
        // A leaked hash for the same unregistered family.
        await client.HSET('test:Widget_w2', 'id', 'w2');

        const report = await Table.findOrphans();

        expect(report.models.Widget).toBeDefined();
        expect(report.models.Widget.registered).toBe(false);
        expect(report.models.Widget.counts).toEqual({ members: 1, hashes: 2 });
        expect(report.models.Widget.leaked).toEqual(['w2']);
    });

    test('reports prefixed keys that belong to no model family', async () => {
        await User.create({ id: 'user1', name: 'John' });
        // A stray key that matches no <Model>_<id> shape.
        await client.HSET('test:looseKey', 'foo', 'bar');

        const report = await Table.findOrphans();

        expect(report.unclassified).toContain('test:looseKey');
    });

    test('pruneOrphans removes dangling members but keeps leaked hashes', async () => {
        await User.create({ id: 'user1', name: 'John' });
        await client.SADD('test:TestUser', 'ghost'); // dangling
        await User.create({ id: 'user2', name: 'Jane' });
        await client.SREM('test:TestUser', 'user2');  // leaked hash

        const result = await Table.pruneOrphans();
        expect(result.removedDangling).toBe(1);

        // Dangling member is gone; leaked hash is untouched.
        const after = await Table.findOrphans();
        expect(after.models.TestUser.dangling).toEqual([]);
        expect(after.models.TestUser.leaked).toEqual(['user2']);
        expect(await client.HGETALL('test:TestUser_user2')).toEqual({ id: 'user2', name: 'Jane' });
    });

    test('pruneOrphans accepts a precomputed report', async () => {
        await client.SADD('test:TestUser', 'ghost');

        const report = await Table.findOrphans();
        const result = await Table.pruneOrphans(report);

        expect(result.removedDangling).toBe(1);
        expect(await client.SMEMBERS('test:TestUser')).not.toContain('ghost');
    });
});
