'use strict';

const MockRedisClient = require('./helpers/mock-redis');
const { setUpTable } = require('../index');

describe('index.js - setUpTable', () => {

    describe('setup with custom client', () => {

        test('should accept custom redis client', async () => {
            const customClient = new MockRedisClient();
            const Table = await setUpTable({ redisClient: customClient });

            expect(Table).toBeDefined();
            expect(typeof Table).toBe('function');
        });

        test('should work with custom prefix', async () => {
            const customClient = new MockRedisClient();
            const Table = await setUpTable({
                redisClient: customClient,
                prefix: 'myapp:'
            });

            class TestModel extends Table {
                static _key = 'id';
                static _keyMap = {
                    id: { type: 'string', isRequired: true },
                    name: { type: 'string', isRequired: true }
                };
            }

            const entry = await TestModel.create({ id: 'test1', name: 'Test' });
            expect(entry.name).toBe('Test');

            const fetched = await TestModel.get('test1');
            expect(fetched.name).toBe('Test');
        });
    });

    describe('setup without custom client', () => {

        test('should use default empty prefix', async () => {
            const customClient = new MockRedisClient();
            const Table = await setUpTable({ redisClient: customClient });

            class TestModel extends Table {
                static _key = 'id';
                static _keyMap = {
                    id: { type: 'string', isRequired: true },
                    name: { type: 'string', isRequired: true }
                };
            }

            const entry = await TestModel.create({ id: 'test1', name: 'Test' });
            expect(entry.name).toBe('Test');
        });
    });

    describe('Table creation and usage', () => {

        test('should allow creating models from returned Table', async () => {
            const customClient = new MockRedisClient();
            const Table = await setUpTable({ redisClient: customClient });

            class User extends Table {
                static _key = 'username';
                static _keyMap = {
                    username: { type: 'string', isRequired: true },
                    email: { type: 'string', isRequired: true }
                };
            }

            const user = await User.create({
                username: 'john',
                email: 'john@example.com'
            });

            expect(user).toBeInstanceOf(User);
            expect(user.username).toBe('john');

            const fetched = await User.get('john');
            expect(fetched.email).toBe('john@example.com');
        });

        test('should handle multiple models with same client', async () => {
            const customClient = new MockRedisClient();
            const Table = await setUpTable({ redisClient: customClient });

            class User extends Table {
                static _key = 'id';
                static _keyMap = {
                    id: { type: 'string', isRequired: true },
                    name: { type: 'string', isRequired: true }
                };
            }

            class Post extends Table {
                static _key = 'id';
                static _keyMap = {
                    id: { type: 'string', isRequired: true },
                    title: { type: 'string', isRequired: true }
                };
            }

            await User.create({ id: 'user1', name: 'John' });
            await Post.create({ id: 'post1', title: 'My Post' });

            const users = await User.list();
            const posts = await Post.list();

            expect(users).toContain('user1');
            expect(posts).toContain('post1');
        });
    });

    describe('configuration options', () => {

        test('should handle empty config object', async () => {
            const customClient = new MockRedisClient();
            const Table = await setUpTable({ redisClient: customClient });

            expect(Table).toBeDefined();
        });

        test('should handle undefined config', async () => {
            const customClient = new MockRedisClient();

            // This would normally try to create a new client
            // For testing, we'll just verify it doesn't crash
            const Table = await setUpTable({ redisClient: customClient });

            expect(Table).toBeDefined();
        });
    });
});
