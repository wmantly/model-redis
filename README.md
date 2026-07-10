# Model Redis

Simple ORM model for Redis in Node.js. The only external dependency is `redis`.
This provides a simple ORM interface, with schema, for Redis. This is not meant
for large data sets and is geared more for small, internal infrastructure based
projects that do not require complex data models.

## Features

- 📦 **CommonJS & ESM compatible** - Works seamlessly with both module systems
- 📋 Schema-based validation with type checking
- 🔑 Primary key and indexed field support
- 🔗 Model relationships (one-to-one, one-to-many)
- 🔄 Automatic type conversion (Redis strings ↔ native types)
- 🛡️ Field privacy control (exclude sensitive data from JSON)
- 🧹 Orphan detection and safe pruning across all models
- ⏳ TTL / expiration — per-record or per-model automatic expiry
- 🧪 Fully tested with 93%+ code coverage
- 🏷️ Key prefixing support

## Installation

```bash
npm install model-redis
```

## Getting Started

`setUpTable([object])` - Function to bind the Redis connection
to the ORM table. It takes an optional connected redis client object
or configuration for the Redis module. This will return a `Table` class we
can use later for our models.

The function returns synchronously, making it compatible with both CommonJS and ESM.
Redis connection happens in the background, and operations automatically await the connection.

It is recommended you place this in a utility or lib file within your project
and require it when needed.

### CommonJS Usage

The simplest way to use this in CommonJS is to pass nothing to the `setUpTable` function.
This will create a connected client to Redis using the default settings:

```javascript
'use strict';

const {setUpTable} = require('model-redis');

const Table = setUpTable();

module.exports = Table;
```

### ESM Usage

For ESM projects, you can still use `await` if preferred (though it's no longer required):

```javascript
import {setUpTable} from 'model-redis';

const Table = await setUpTable();

export default Table;
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

const Table = setUpTable({redisConf: conf});

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

const Table = setUpTable({redisClient: client});

module.exports = Table;
```

**Note:** When passing a custom client, ensure it's connected before passing it to `setUpTable`.

### Prefix Key

At some point, the Redis package removed the option to prefix a string to the
keys. This functionality has been added back with this package:

```javascript
'use strict';

const {setUpTable} = require('model-redis');

const Table = setUpTable({
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

* `static _ttl` *number* is optional and sets a default record lifetime, in
    seconds, for every entry of this model. `0` (the default, or any falsy value)
    means no expiry. The TTL is applied to the entry's record hash, so an expired
    entry becomes unretrievable via `get()` and is transparently pruned from the
    index on the next read (see [TTL / Expiration](#ttl--expiration)). It can be
    overridden per operation with a `{ttl}` option or the `expire()` instance
    helper.

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

* `await create(data, [options])` - Creates and returns a new entry. The passed
    data object will be validated and a validation error (complete with all the
    key errors) will be thrown if validation fails. Any key passed in the data
    object that is not in the `_keyMap` schema will be dropped. Pass
    `{ttl: <seconds>}` as `options` to set (or override the model's `_ttl`) the
    record lifetime for this entry.

* `await list()` - Returns a list of the primary keys in the table.

* `await listDetail([options], [queryHelper])` - Returns a list of Table instances.
    Can optionally filter by passing an options object: `{age: 30, active: true}`

* `await findall([options])` - Alias for `listDetail()`

* `await get(pk, [queryHelper])` - Returns a Table instance for the passed primary key.
    If none is found, a not found error is thrown.

* `await exists(pk)` - Returns `true` or `false` if the passed PK exists.

* `register([Model])` - Registers a model in the global registry for relationships.

* `await findOrphans()` - Scans the keyspace and returns a report of orphaned
    data across every model. See [Finding Orphans](#finding-orphans).

* `await pruneOrphans([report])` - Removes the unambiguously-safe orphans
    (dangling set members). Optionally accepts a report from `findOrphans()`.

### Instance Methods

Instances of a Table have the following methods:

* `await update(data, [options])` - Updates the current instance with the newly
    passed data and returns the updated instance. Data validation is also
    enforced. The remaining lifetime is preserved by default; pass
    `{ttl: <seconds>}` as `options` to reset the expiry, or `{ttl: 0}` to clear
    it. A primary-key rename carries the remaining lifetime across.

* `await remove()` - Deletes the current Table instance and returns itself.

* `await expire(seconds)` - Sets this entry's record hash to expire after
    `seconds`. Returns the instance.

* `await persist()` - Removes any expiry from this entry's record hash so it no
    longer expires. Returns the instance.

* `await ttl()` - Returns the remaining lifetime of this entry's record hash, in
    seconds. Mirrors Redis: `-1` means no expiry, `-2` means the record is gone.

* `toJSON()` - Returns a plain JavaScript object representation of the instance.
    Fields marked with `isPrivate: true` are excluded.

* `toString()` - Returns the primary key value as a string.

All of these methods are extensible so proper business logic can be implemented.

## Relationships

Model Redis supports relationships between models through the model registry system:

```javascript
const Table = setUpTable();

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

## Finding Orphans

Every model is stored as exactly two key shapes under the configured prefix:

```
<prefix><Model>          # a SET of index values (the source of truth)
<prefix><Model>_<id>     # a HASH of that entry's fields
```

Interrupted writes, external tooling, or app bugs can leave these two out of
sync. `findOrphans()` reconciles the whole keyspace against that contract and
reports three model-agnostic orphan classes:

* **leaked** – a `<Model>_<id>` hash whose id is **not** in the index set. The
    data exists but is invisible to `list()` / `listDetail()`.
* **dangling** – an index set member with **no** backing hash. `get()` throws a
    404 for it.
* **brokenRelations** – a `rel:'one'` foreign key pointing at an id that is
    absent from the target model's set.

Model families are discovered from the keyspace itself, so **models that were
used but never `register()`-ed are still checked** (they appear with
`registered: false`). Relation checks require a registered model with a
`_keyMap`.

```javascript
const report = await Table.findOrphans();

// {
//   prefix: 'auth_app:',
//   models: {
//     User: {
//       registered: true,
//       counts: { members: 120, hashes: 121 },
//       leaked: ['abc'],          // hash without a set entry
//       dangling: [],             // set entry without a hash
//       brokenRelations: []
//     },
//     Session: {                  // never register()-ed
//       registered: false,
//       counts: { members: 4, hashes: 4 },
//       leaked: [], dangling: [], brokenRelations: []
//     }
//   },
//   unclassified: ['auth_app:someStrayKey'],
//   totals: { leaked: 1, dangling: 0, brokenRelations: 0 }
// }
```

### Pruning

`pruneOrphans()` removes only the **dangling set members** — they reference
nothing, so `SREM` cannot lose data. Leaked hashes and broken relations still
contain data and are intentionally left for manual review.

```javascript
const report = await Table.findOrphans();
const { removedDangling } = await Table.pruneOrphans(report);
// call without an argument to compute a fresh report first:
// await Table.pruneOrphans();
```

Both methods are static and operate across the entire registry/keyspace, so
they can be called from any model: `User.findOrphans()` and
`Table.findOrphans()` are equivalent.

## TTL / Expiration

Entries can be given a lifetime after which they expire automatically. Set a
default for every entry of a model with `static _ttl` (seconds), or set/override
it per operation:

```javascript
class Session extends Table {
    static _key = 'id';
    static _ttl = 3600; // every session expires after an hour by default
    static _keyMap = {
        id: {type: 'string', isRequired: true},
        userId: {type: 'string', isRequired: true}
    };
}

// Uses the model default (3600s):
const s = await Session.create({id: 'a', userId: 'u1'});

// Override for a single entry:
const short = await Session.create({id: 'b', userId: 'u1'}, {ttl: 60});

// Inspect / change the lifetime later:
await s.ttl();        // -> remaining seconds (-1 = no expiry, -2 = gone)
await s.expire(120);  // reset to 120s
await s.persist();    // remove the expiry entirely
```

**How it works.** Each entry is stored as two Redis keys — a `<Model>` index SET
and a `<Model>_<id>` field HASH (see [Finding Orphans](#finding-orphans)). Redis
TTL is per-key, so the expiry is applied to the **hash**. This means a consumer
reading the hash directly (e.g. via `HGETALL`) sees an expired entry as simply
absent. Because only the hash expires, the id lingers in the index SET as a
**dangling** member until it is cleaned up.

That cleanup is automatic on read: `get()` throws `EntryNotFound` for an expired
entry, `exists()` returns `false` and removes the dangling member, and
`listDetail()` skips expired entries and prunes them from the index as it goes.
Re-creating an expired key succeeds normally. `pruneOrphans()` remains available
for batch cleanup of any dangling members that have not yet been touched by a
read.

`update()` preserves the remaining lifetime by default; pass `{ttl}` to reset it
(`{ttl: 0}` clears it). A primary-key rename carries the remaining lifetime
across to the new key.

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

- **93%+** overall coverage
- **93 tests** (92 passing, 1 skipped)
- Tests for validation, CRUD operations, filtering, serialization, TTL/expiration, and orphan detection

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
