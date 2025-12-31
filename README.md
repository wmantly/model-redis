# Model Redis

Simple ORM model for Redis in Node.js. The only external dependency is `redis`.
This provides a simple ORM interface, with schema, for Redis. This is not meant
for large data sets and is geared more for small, internal infrastructure based
projects that do not require complex data models.

## Features

- 📋 Schema-based validation with type checking
- 🔑 Primary key and indexed field support
- 🔗 Model relationships (one-to-one, one-to-many)
- 🔄 Automatic type conversion (Redis strings ↔ native types)
- 🛡️ Field privacy control (exclude sensitive data from JSON)
- 🧪 Fully tested with 84%+ code coverage
- 🏷️ Key prefixing support

## Installation

```bash
npm install model-redis
```

## Getting Started

`setUpTable([object])` - *Async Function* to bind the Redis connection
to the ORM table. It takes an optional connected redis client object
or configuration for the Redis module. This will return a `Table` class we
can use later for our models.

It is recommended you place this in a utility or lib file within your project
and require it when needed.

The simplest way to use this is to pass nothing to the `setUpTable` function.
This will create a connected client to Redis using the default settings:

```javascript
'use strict';

const {setUpTable} = require('model-redis');

const Table = await setUpTable();

module.exports = Table;
```

You can also pass your own configuration options to the Redis client. See the
redis [client configuration guide](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md)
for available options:

```javascript
'use strict';

const {setUpTable} = require('model-redis');

const conf = {
    socket: {
        host: '10.10.10.10',
        port: 7676
    },
    username: 'admin',
    password: 'hunter42'
};

const Table = await setUpTable({redisConf: conf});

module.exports = Table;
```

It can also take a Redis client object, if you would like to have more control
or use a custom version of Redis:

```javascript
'use strict';

const {setUpTable} = require('model-redis');
const {createClient} = require('redis');

const client = createClient();
await client.connect();

const Table = await setUpTable({redisClient: client});

module.exports = Table;
```

### Prefix Key

At some point, the Redis package removed the option to prefix a string to the
keys. This functionality has been added back with this package:

```javascript
'use strict';

const {setUpTable} = require('model-redis');

const Table = await setUpTable({
    prefix: 'auth_app:'
});

module.exports = Table;
```

Once we have our table object, we can start building using the ORM!

## ORM API

The Table class implements static and bound functions to perform normal ORM
operations. For the rest of these examples, we will implement a simple user
backend. This will show some usage and extensibility:

```javascript
const Table = require('../utils/redis_model'); // Path to where the 'model-redis' module is loaded and configured
const bcrypt = require('bcrypt'); // We will use this for passwords later
const saltRounds = 10;

class User extends Table {
    static _key = 'username';
    static _keyMap = {
        'created_by': {isRequired: true, type: 'string', min: 3, max: 500},
        'created_on': {default: function(){return Date.now()}, type: 'number'},
        'updated_by': {default: "__NONE__", type: 'string'},
        'updated_on': {default: function(){return Date.now()}, type: 'number', always: true},
        'username': {isRequired: true, type: 'string', min: 3, max: 500},
        'password': {isRequired: true, type: 'string', min: 3, max: 500, isPrivate: true},
        'email': {isRequired: true, type: 'string'}
    };

    static async create(data) {
        try {
            data['password'] = await bcrypt.hash(data['password'], saltRounds);
            return await super.create(data);
        } catch(error) {
            throw error;
        }
    }

    async setPassword(newPassword) {
        try {
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
            return this.update({password: hashedPassword});
        } catch(error) {
            throw error;
        }
    }

    static async login(data) {
        try {
            let user = await User.get(data.username);
            let auth = await bcrypt.compare(data.password, user.password);

            if(auth) {
                return user;
            } else {
                throw new Error("LoginFailed");
            }
        } catch(error) {
            throw new Error("LoginFailed");
        }
    }
}

module.exports = {User};
```

### Table Schema

The table schema is a required aspect of using this module. The schema is defined
with `_key` and `_keyMap`:

* `static _key` *string* is required and is basically the primary key for this
    table. It MUST match one of the keys in the `_keyMap` schema

* `static _keyMap` *object* is required and defines the allowed schema for the
    table. Validation will be enforced based on what is defined in the schema.

The `_keyMap` schema is an object where the key is the name of the field and the
value is an object with the options for that field:

```javascript
'username': {isRequired: true, type: 'string', min: 3, max: 500}
```

#### Field Options:

* `type` *string* - The native type this field will be checked for. Valid types are:
    * `string`
    * `number`
    * `boolean`
    * `object`

* `isRequired` *boolean* - If set to true, this must be set when a new
    entry is created. This has no effect on updates.

* `default` *value or function* - If nothing is passed, this will be used.
    If a function is placed here, it will be called and its return value used.

* `always` *boolean* - If this is set and `default` is set, then its value will
    always be used when calling update. This is useful for setting an "updated_on"
    field or access count.

* `min` *number* - Used with *string* or *number* type to define the lower limit

* `max` *number* - Used with *string* or *number* type to define the max limit

* `isPrivate` *boolean* - If set to true, this field will be excluded from `toJSON()` output.
    Useful for passwords or sensitive data.

* `model` *string* - For relationships, specify the model name to link to

* `rel` *string* - Relationship type: `'one'` or `'many'`

* `localKey` *string* - For relationships, the local field to use (defaults to `_key`)

* `remoteKey` *string* - For relationships, the remote field to match against

Once we have defined a `_keyMap` schema, the table can be used.

## Methods

### Static Methods

Static methods are used to query data and create new entries.

* `await create(data)` - Creates and returns a new entry. The passed data object
    will be validated and a validation error (complete with all the key errors)
    will be thrown if validation fails. Any key passed in the data object that
    is not in the `_keyMap` schema will be dropped.

* `await list()` - Returns a list of the primary keys in the table.

* `await listDetail([options], [queryHelper])` - Returns a list of Table instances.
    Can optionally filter by passing an options object: `{age: 30, active: true}`

* `await findall([options])` - Alias for `listDetail()`

* `await get(pk, [queryHelper])` - Returns a Table instance for the passed primary key.
    If none is found, a not found error is thrown.

* `await exists(pk)` - Returns `true` or `false` if the passed PK exists.

* `register([Model])` - Registers a model in the global registry for relationships.

### Instance Methods

Instances of a Table have the following methods:

* `await update(data)` - Updates the current instance with the newly passed data
    and returns the updated instance. Data validation is also enforced.

* `await remove()` - Deletes the current Table instance and returns itself.

* `toJSON()` - Returns a plain JavaScript object representation of the instance.
    Fields marked with `isPrivate: true` are excluded.

* `toString()` - Returns the primary key value as a string.

All of these methods are extensible so proper business logic can be implemented.

## Relationships

Model Redis supports relationships between models through the model registry system:

```javascript
const Table = await setUpTable();

// Define User model
class User extends Table {
    static _key = 'id';
    static _keyMap = {
        id: {type: 'string', isRequired: true},
        name: {type: 'string', isRequired: true},
        posts: {model: 'Post', rel: 'many', remoteKey: 'userId', localKey: 'id'}
    };
}

// Define Post model
class Post extends Table {
    static _key = 'id';
    static _keyMap = {
        id: {type: 'string', isRequired: true},
        title: {type: 'string', isRequired: true},
        userId: {type: 'string', isRequired: true},
        user: {model: 'User', rel: 'one', localKey: 'userId'}
    };
}

// Register models
User.register();
Post.register();

// Now relationships will be loaded automatically
const user = await User.get('user1');
console.log(user.posts); // Array of Post instances

const post = await Post.get('post1');
console.log(post.user); // User instance
```

### Cycle Detection

The QueryHelper class automatically prevents infinite loops in circular relationships:

```javascript
// User has many Posts, Post belongs to User
// When loading a User, it loads Posts
// Each Post tries to load its User (circular)
// QueryHelper detects this and prevents infinite recursion
const user = await User.get('user1');
// user.posts will be loaded, but user.posts[0].user won't recurse
```

## Error Handling

The module provides custom error types:

* `ObjectValidateError` - Thrown when validation fails, includes array of field errors
* `EntryNotFound` - Thrown when trying to get a non-existent entry
* `EntryNameUsed` - Thrown when trying to create an entry with an existing primary key

```javascript
try {
    await User.create({username: 'john'}); // Missing required 'email'
} catch(error) {
    if(error.name === 'ObjectValidateError') {
        console.log(error.message); // Array of validation errors
        console.log(error.status); // 422
    }
}
```

## Testing

The project includes a comprehensive test suite:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Coverage

- **84.88%** overall coverage
- **67 tests** (66 passing, 1 skipped)
- Tests for validation, CRUD operations, filtering, and serialization

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Generate coverage report
npm run test:coverage
```

## License

MIT

## Contributing

Issues and pull requests are welcome! Please see the [issues page](https://github.com/wmantly/model-redis/issues) for current bugs and feature requests.

## Known Issues

- [Issue #3](https://github.com/wmantly/model-redis/issues/3) - Memory leak in relationship test suite (does not affect production usage)
