'use strict';

const MockRedisClient = require('./helpers/mock-redis');
const setUpTable = require('../src/redis_model');

describe('Relationships and QueryHelper', () => {
    let client;
    let Table;
    let User;
    let Post;
    let Comment;

    beforeEach(() => {
        client = new MockRedisClient();
        Table = setUpTable(client, 'test:');

        // Clear the models registry from previous tests
        Table.models = {};

        // Define User model
        class TestUser extends Table {
            static _key = 'id';
            static _keyMap = {
                id: { type: 'string', isRequired: true },
                name: { type: 'string', isRequired: true },
                posts: { model: 'TestPost', rel: 'many', remoteKey: 'userId', localKey: 'id' }
            };
        }

        // Define Post model
        class TestPost extends Table {
            static _key = 'id';
            static _keyMap = {
                id: { type: 'string', isRequired: true },
                title: { type: 'string', isRequired: true },
                userId: { type: 'string', isRequired: true },
                user: { model: 'TestUser', rel: 'one', localKey: 'userId' },
                comments: { model: 'TestComment', rel: 'many', remoteKey: 'postId', localKey: 'id' }
            };
        }

        // Define Comment model
        class TestComment extends Table {
            static _key = 'id';
            static _keyMap = {
                id: { type: 'string', isRequired: true },
                text: { type: 'string', isRequired: true },
                postId: { type: 'string', isRequired: true },
                post: { model: 'TestPost', rel: 'one', localKey: 'postId' }
            };
        }

        User = TestUser;
        Post = TestPost;
        Comment = TestComment;

        // Register models
        User.register();
        Post.register();
        Comment.register();
    });

    afterEach(() => {
        client.flushall();
    });

    describe('one-to-one relationships', () => {

        test('should load related one-to-one model', async () => {
            const user = await User.create({
                id: 'user1',
                name: 'John Doe'
            });

            const post = await Post.create({
                id: 'post1',
                title: 'My First Post',
                userId: 'user1'
            });

            const fetchedPost = await Post.get('post1');
            expect(fetchedPost.user).toBeInstanceOf(User);
            expect(fetchedPost.user.name).toBe('John Doe');
        });

        test('should handle missing related record gracefully', async () => {
            const post = await Post.create({
                id: 'post1',
                title: 'Orphaned Post',
                userId: 'nonexistent'
            });

            const fetchedPost = await Post.get('post1');
            // Should not throw, relation just won't be populated
            expect(fetchedPost.title).toBe('Orphaned Post');
        });
    });

    describe('one-to-many relationships', () => {

        test('should load related one-to-many models', async () => {
            const user = await User.create({
                id: 'user1',
                name: 'John Doe'
            });

            await Post.create({
                id: 'post1',
                title: 'First Post',
                userId: 'user1'
            });

            await Post.create({
                id: 'post2',
                title: 'Second Post',
                userId: 'user1'
            });

            await Post.create({
                id: 'post3',
                title: 'Other User Post',
                userId: 'user2'
            });

            const fetchedUser = await User.get('user1');
            expect(Array.isArray(fetchedUser.posts)).toBe(true);
            expect(fetchedUser.posts).toHaveLength(2);
            expect(fetchedUser.posts.every(p => p instanceof Post)).toBe(true);
            expect(fetchedUser.posts.some(p => p.title === 'First Post')).toBe(true);
            expect(fetchedUser.posts.some(p => p.title === 'Second Post')).toBe(true);
        });

        test('should return empty array when no related records', async () => {
            const user = await User.create({
                id: 'user1',
                name: 'John Doe'
            });

            const fetchedUser = await User.get('user1');
            expect(Array.isArray(fetchedUser.posts)).toBe(true);
            expect(fetchedUser.posts).toHaveLength(0);
        });
    });

    describe('nested relationships', () => {

        test('should load nested relationships', async () => {
            // Create user
            await User.create({
                id: 'user1',
                name: 'John Doe'
            });

            // Create post
            await Post.create({
                id: 'post1',
                title: 'My Post',
                userId: 'user1'
            });

            // Create comments
            await Comment.create({
                id: 'comment1',
                text: 'Great post!',
                postId: 'post1'
            });

            await Comment.create({
                id: 'comment2',
                text: 'Nice work!',
                postId: 'post1'
            });

            const fetchedPost = await Post.get('post1');

            // Post should have user
            expect(fetchedPost.user).toBeInstanceOf(User);
            expect(fetchedPost.user.name).toBe('John Doe');

            // Post should have comments
            expect(Array.isArray(fetchedPost.comments)).toBe(true);
            expect(fetchedPost.comments).toHaveLength(2);
            expect(fetchedPost.comments.every(c => c instanceof Comment)).toBe(true);
        });
    });

    describe('cycle detection', () => {

        test('should prevent infinite loops in circular relationships', async () => {
            // Create user
            await User.create({
                id: 'user1',
                name: 'John Doe'
            });

            // Create post (which references user)
            await Post.create({
                id: 'post1',
                title: 'My Post',
                userId: 'user1'
            });

            // When we fetch user, it loads posts
            // Each post tries to load user (circular reference)
            // QueryHelper should detect this cycle and prevent infinite loop
            const fetchedUser = await User.get('user1');

            expect(fetchedUser.posts).toHaveLength(1);
            expect(fetchedUser.posts[0].title).toBe('My Post');

            // The user reference in the post should not be loaded again
            // (preventing the cycle)
        });

        test('should handle deep nested cycle detection', async () => {
            // Create user
            await User.create({
                id: 'user1',
                name: 'John Doe'
            });

            // Create post
            await Post.create({
                id: 'post1',
                title: 'My Post',
                userId: 'user1'
            });

            // Create comment
            await Comment.create({
                id: 'comment1',
                text: 'Great!',
                postId: 'post1'
            });

            // User -> Posts -> Comments -> Post (cycle here)
            const fetchedUser = await User.get('user1');

            expect(fetchedUser.posts).toHaveLength(1);
            expect(fetchedUser.posts[0].comments).toHaveLength(1);
            // Should not infinitely recurse
        });
    });

    describe('model registry', () => {

        test('should register models correctly', () => {
            expect(User.models['TestUser']).toBe(User);
            expect(User.models['TestPost']).toBe(Post);
            expect(User.models['TestComment']).toBe(Comment);
        });

        test('should share models registry across all Table subclasses', () => {
            expect(User.models).toBe(Post.models);
            expect(Post.models).toBe(Comment.models);
        });
    });

    describe('listDetail with relationships', () => {

        test('should load relationships for all items in listDetail', async () => {
            await User.create({ id: 'user1', name: 'John' });
            await User.create({ id: 'user2', name: 'Jane' });

            await Post.create({ id: 'post1', title: 'Post 1', userId: 'user1' });
            await Post.create({ id: 'post2', title: 'Post 2', userId: 'user2' });

            const posts = await Post.listDetail();

            expect(posts).toHaveLength(2);
            expect(posts[0].user).toBeInstanceOf(User);
            expect(posts[1].user).toBeInstanceOf(User);
        });

        test('should work with filtering and relationships', async () => {
            await User.create({ id: 'user1', name: 'John' });

            await Post.create({ id: 'post1', title: 'Post 1', userId: 'user1' });
            await Post.create({ id: 'post2', title: 'Post 2', userId: 'user1' });
            await Post.create({ id: 'post3', title: 'Post 3', userId: 'user2' });

            const posts = await Post.listDetail({ userId: 'user1' });

            expect(posts).toHaveLength(2);
            expect(posts[0].user).toBeInstanceOf(User);
            expect(posts[0].user.name).toBe('John');
        });
    });
});
