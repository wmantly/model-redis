# Model Redis

Simple ORM model for redis in NodsJS. The only external dependence is `redis`.
This provides a simple ORM interface, with schema, for redis. This is not meant 
for large data sets and is geared more for small, internal infrastructure based
projects that do not require complex data model.


## Getting started

`setUpTable([object])` -- *Function* to bind the redis connection
	object to the ORM table. It takes an optional connected redis client object
	or configuration for the redis module. This will return a `Table` class we
	can use later for our model.

It is recommend you place this in a utility or lib file with in your project
and require it when needed.

The simplest way to use this is to pass nothing to the `setUpTable` function.
this will create a connected client to redis using the default settings:

```javascript
'use strict';

const {setUpTable} = require('model-redis')

const Table = setUpTable();

module.exports = Table;
```

You can also pass your own configuration options to the redis client. See the
redis [client configuration guide](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md)
for available options:

```javascript
'use strict';

const {setUpTable} = require('model-redis')

const conf = {
	socket: {
		host: '10.10.10.10'
		port: 7676
	},
	username: admin,
	password: hunter42
}

const Table = setUpTable({redisConf: conf});

module.exports = Table;
```

It can also take a Redis client object, if you would like to have more control
or use a custom version on redis.

```javascript
'use strict';

const {setUpTable} = require('model-redis')

const {createClient} = require('redis');
const client = createClient();
client.connect();

const Table = setUpTable({redisClient: client});

module.exports = Table;

```

Once we have have our table object, we can start building using the ORM!

## ORM API

The Table class implements static and bound functions to perform normal ORM
operations. For the rest of these examples, we will implement a simple user
backing. This will show some usage and extenabilty:

``` javascript
const Table = require('../utils/redis_model'); // Path to where the 'model-redis module is loaded and configured'
const {Token, InviteToken} = require('./token');
const bcrypt = require('bcrypt'); // We will use this for passwords later
const saltRounds = 10;

class User extends Table{
	static _key = 'username';
	static _keyMap = {
		'created_by': {isRequired: true, type: 'string', min: 3, max: 500},
		'created_on': {default: function(){return (new Date).getTime()}},
		'updated_by': {default:"__NONE__", type: 'string',},
		'updated_on': {default: function(){return (new Date).getTime()}, always: true},
		'username': {isRequired: true, type: 'string', min: 3, max: 500},
		'password': {isRequired: true, type: 'string', min: 3, max: 500},
	};

	static async add(data) {
		try{
			data['password'] = await bcrypt.hash(data['password'], saltRounds);

			return await super.add(data);
		}catch(error){
			throw error;
		}
	}

	async setPassword(data){
		try{
			data['password'] = await bcrypt.hash(data['password'], saltRounds);

			return this.update(data);
		}catch(error){
			throw error;
		}
	}

	static async login(data){
		try{
			let user = await User.get(data);
			let auth = await bcrypt.compare(data.password, user.password);

			if(auth){
				return user;
			}else{
				throw new Error("LogginFailed");
			}
		}catch(error){
			throw new Error("LogginFailed")
		}
	};
}

module.exports = {User};

```

### Table schema

The table schema a required aspect of using this module. The schema is defined
with `_key`, `_indexed` and `_keyMap`

* `static _key` *string* is required and is basically the primary key for this
	table. It MUST match one of the keys in the `_keyMap` schema

* `static _indexed` *array* is optional list of keys to be indexed. Indexed keys
can be searched by with the `list()` and `listDetial()` methods.

* `static _keyMap` *object* is required and defines the allowed schema for the
table. Validation will be enforced based on what is defined in the schema.

The `_keyMap` schema is an object where the key is the name of the field and the
value is an object with the options for that field:
```javascript
'username': {isRequired: true, type: 'string', min: 3, max: 500}

```

#### Field options:

* `type` *string* Required The native type this field will be checked for, valid
	types are:
	
	* `string`
	* `number` 
	* `boolean`
	* `object`

* `isRequired` *boolean* If this is set to true, this must be set when a new
	entry is created. This has no effect on updates.
* `default` *field type or function* if nothing is passed, this will be used be
	used. If a function is placed here, it will be called and its return value
	used.
* `always` *boolean* If this is set, the `default` is set, then its value will
	always be used when calling update. This is useful for setting an updated on
	field or access count.
* `min` *number* Used with *string* or *number* type to define the lower limit
* `max` *number* Used with *string* or *number* type to define the max limit 

Once we have defined a `_keyMap` schema, the table can be used.

#### Methods

Static methods are used to query data and create new entries.

* `await add(data)`  Creates and returns a new entry. The passed data object
	will be validated and a validation error(complete will all the key errors)
	will be thrown if validation fails. Any key passed in the data object that 
	is not in the `_keyMap` schema will be dropped.

* `await list([index_field, [index value]])` Returns a list of the primary keys in
	 the table. If you pass `index_field` and `index_value`, only those matching
	 will be returned.

* `await listDetial([index_field, [index value]])` same as `list`, but will
	return a list of Table instances.

* `await get(pk)` returns a Table instance for the passed object. If none is,
	found a not found error is thrown

* `await exists(pk)` Returns `true` or `false` if the passed PK exists.

Instances of a Table have the following methods:

* `await update(data)` updates the current instance with the newly passed data
	and returns a new instance with the updated data. Data validation is also.

* `await remove()` Deletes the current Table instance and returns the delete
count, this should be 1.

All of these methods are extendable so proper business logic can be implemented.
