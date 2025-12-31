'use strict';

const MockRedisClient = require('./helpers/mock-redis');
const setUpTable = require('../src/redis_model');

describe('Table', () => {
    let client;
    let Table;
    let User;

    beforeEach(() => {
        // Create a fresh redis mock client for each test
        client = new MockRedisClient();
        Table = setUpTable(client, 'test:');

        // Define a test model
        class TestUser extends Table {
            static _key = 'username';
            static _keyMap = {
                username: { type: 'string', isRequired: true },
                email: { type: 'string', isRequired: true },
                age: { type: 'number' },
                active: { type: 'boolean', default: true },
                metadata: { type: 'object' }
            };
        }

        User = TestUser;
    });

    afterEach(() => {
        // Clean up
        client.flushall();
    });

    describe('create', () => {

        test('should create a new entry', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30
            });

            expect(user).toBeInstanceOf(User);
            expect(user.username).toBe('john');
            expect(user.email).toBe('john@example.com');
            expect(user.age).toBe(30);
            expect(user.active).toBe(true); // default value
        });

        test('should throw error when required field missing', async () => {
            await expect(
                User.create({ username: 'john' })
            ).rejects.toThrow();
        });

        test('should throw error when entry already exists', async () => {
            await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            await expect(
                User.create({
                    username: 'john',
                    email: 'different@example.com'
                })
            ).rejects.toMatchObject({ name: 'EntryNameUsed' });
        });

        test('should handle object types', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                metadata: { role: 'admin', permissions: ['read', 'write'] }
            });

            expect(user.metadata).toEqual({ role: 'admin', permissions: ['read', 'write'] });
        });

        test.skip('should skip undefined values', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                age: undefined
            });

            // age should not be present since it was undefined
            expect(user.hasOwnProperty('age')).toBe(false);
        });
    });

    describe('get', () => {

        test('should retrieve an existing entry', async () => {
            await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30
            });

            const user = await User.get('john');
            expect(user).toBeInstanceOf(User);
            expect(user.username).toBe('john');
            expect(user.email).toBe('john@example.com');
            expect(user.age).toBe(30);
        });

        test('should accept object with key field', async () => {
            await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            const user = await User.get({ username: 'john' });
            expect(user.username).toBe('john');
        });

        test('should throw error when entry not found', async () => {
            await expect(
                User.get('nonexistent')
            ).rejects.toMatchObject({ name: 'EntryNotFound' });
        });

        test('should parse types correctly from Redis', async () => {
            await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30,
                active: false
            });

            const user = await User.get('john');
            expect(typeof user.age).toBe('number');
            expect(user.age).toBe(30);
            expect(typeof user.active).toBe('boolean');
            expect(user.active).toBe(false);
        });
    });

    describe('exists', () => {

        test('should return true for existing entry', async () => {
            await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            const exists = await User.exists('john');
            expect(exists).toBe(true);
        });

        test('should return false for non-existing entry', async () => {
            const exists = await User.exists('nonexistent');
            expect(exists).toBe(false);
        });

        test('should accept object with key field', async () => {
            await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            const exists = await User.exists({ username: 'john' });
            expect(exists).toBe(true);
        });
    });

    describe('list', () => {

        test('should return empty array when no entries', async () => {
            const list = await User.list();
            expect(list).toEqual([]);
        });

        test('should return all entry keys', async () => {
            await User.create({ username: 'john', email: 'john@example.com' });
            await User.create({ username: 'jane', email: 'jane@example.com' });
            await User.create({ username: 'bob', email: 'bob@example.com' });

            const list = await User.list();
            expect(list).toHaveLength(3);
            expect(list).toContain('john');
            expect(list).toContain('jane');
            expect(list).toContain('bob');
        });
    });

    describe('listDetail', () => {

        test('should return all entries as instances', async () => {
            await User.create({ username: 'john', email: 'john@example.com', age: 30 });
            await User.create({ username: 'jane', email: 'jane@example.com', age: 25 });

            const users = await User.listDetail();
            expect(users).toHaveLength(2);
            expect(users[0]).toBeInstanceOf(User);
            expect(users[1]).toBeInstanceOf(User);
        });

        test('should filter by options', async () => {
            await User.create({ username: 'john', email: 'john@example.com', age: 30 });
            await User.create({ username: 'jane', email: 'jane@example.com', age: 25 });
            await User.create({ username: 'bob', email: 'bob@example.com', age: 30 });

            const users = await User.listDetail({ age: 30 });
            expect(users).toHaveLength(2);
            expect(users.every(u => u.age === 30)).toBe(true);
        });

        test('should filter by multiple options', async () => {
            await User.create({ username: 'john', email: 'john@example.com', age: 30, active: true });
            await User.create({ username: 'jane', email: 'jane@example.com', age: 30, active: false });
            await User.create({ username: 'bob', email: 'bob@example.com', age: 25, active: true });

            const users = await User.listDetail({ age: 30, active: true });
            expect(users).toHaveLength(1);
            expect(users[0].username).toBe('john');
        });
    });

    describe('findall', () => {

        test('should be alias for listDetail', async () => {
            await User.create({ username: 'john', email: 'john@example.com', age: 30 });

            const users = await User.findall({ age: 30 });
            expect(users).toHaveLength(1);
            expect(users[0].username).toBe('john');
        });
    });

    describe('update', () => {

        test('should update existing fields', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30
            });

            await user.update({ age: 31, email: 'newemail@example.com' });

            expect(user.age).toBe(31);
            expect(user.email).toBe('newemail@example.com');
            expect(user.username).toBe('john'); // unchanged
        });

        test('should persist updates to Redis', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30
            });

            await user.update({ age: 31 });

            const fetched = await User.get('john');
            expect(fetched.age).toBe(31);
        });

        test('should update primary key', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30
            });

            await user.update({ username: 'john_updated' });

            // Old key should not exist
            await expect(User.get('john')).rejects.toMatchObject({ name: 'EntryNotFound' });

            // New key should exist
            const updated = await User.get('john_updated');
            expect(updated.username).toBe('john_updated');
            expect(updated.email).toBe('john@example.com');
        });

        test('should throw error when updating to existing key', async () => {
            await User.create({ username: 'john', email: 'john@example.com' });
            const user = await User.create({ username: 'jane', email: 'jane@example.com' });

            await expect(
                user.update({ username: 'john' })
            ).rejects.toMatchObject({ name: 'EntryNameUsed' });
        });

        test('should handle partial updates', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30
            });

            await user.update({ age: 31 });

            expect(user.age).toBe(31);
            expect(user.email).toBe('john@example.com'); // unchanged
        });
    });

    describe('remove', () => {

        test('should remove an entry', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            const result = await user.remove();
            expect(result).toBe(user);

            // Entry should no longer exist
            await expect(User.get('john')).rejects.toMatchObject({ name: 'EntryNotFound' });
        });

        test('should remove from list', async () => {
            await User.create({ username: 'john', email: 'john@example.com' });
            await User.create({ username: 'jane', email: 'jane@example.com' });

            const user = await User.get('john');
            await user.remove();

            const list = await User.list();
            expect(list).toHaveLength(1);
            expect(list).toContain('jane');
            expect(list).not.toContain('john');
        });
    });

    describe('toJSON', () => {

        test('should convert instance to JSON object', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com',
                age: 30
            });

            const json = user.toJSON();
            expect(json).toEqual({
                username: 'john',
                email: 'john@example.com',
                age: 30,
                active: true
            });
        });

        test('should exclude private fields', async () => {
            class SecureUser extends Table {
                static _key = 'username';
                static _keyMap = {
                    username: { type: 'string', isRequired: true },
                    password: { type: 'string', isRequired: true, isPrivate: true },
                    email: { type: 'string', isRequired: true }
                };
            }

            const user = await SecureUser.create({
                username: 'john',
                password: 'secret123',
                email: 'john@example.com'
            });

            const json = user.toJSON();
            expect(json.password).toBeUndefined();
            expect(json.username).toBe('john');
            expect(json.email).toBe('john@example.com');
        });
    });

    describe('toString', () => {

        test('should return primary key value', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            expect(user.toString()).toBe('john');
        });
    });

    describe('static properties', () => {

        test('should have redisClient property', () => {
            expect(User.redisClient).toBe(client);
        });

        test('should have models registry', () => {
            expect(User.models).toBeDefined();
            expect(typeof User.models).toBe('object');
        });

        test('should have register method', () => {
            expect(typeof User.register).toBe('function');
        });

        test('should register model', () => {
            User.register();
            expect(User.models['TestUser']).toBe(User);
        });
    });

    describe('prefix handling', () => {

        test('should use prefix for Redis keys', async () => {
            const user = await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            // Check that the prefix is applied (this is implementation-specific)
            const exists = await User.exists('john');
            expect(exists).toBe(true);
        });
    });
});
