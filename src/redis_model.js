'use strict';

const objValidate = require('./object_validate');

class QueryHelper{
    history = []
    constructor(origin){
        this.origin = origin
        this.history.push(origin.constructor.name);
    }

    static isNotCycle(modelName, queryHelper){
        if(!(queryHelper instanceof this)){
            return true;  // No queryHelper, can't detect cycles
        }
        if(queryHelper.history.includes(modelName)){
            return false;  // Cycle detected - return false to skip
        }
        queryHelper.history.push(modelName);
        return true;  // No cycle detected - return true to continue
    }
}

function setUpTable(client, prefix='', connectionPromise=null){

    function redisPrefix(key){
        return `${prefix}${key}`;
    }

    // Helper function to await connection if promise exists
    async function ensureClientReady(){
        if(connectionPromise){
            await connectionPromise;
        }
    }

    class Table{
        static errors = {
            ObjectValidateError: objValidate.ObjectValidateError,
            EntryNameUsed: ()=>{
                let error = new Error('EntryNameUsed');
                error.name = 'EntryNameUsed';
                error.message = `${this.prototype.constructor.name}:${data[this._key]} already exists`;
                error.keys = [{
                    key: this._key,
                    message: `${this.prototype.constructor.name}:${data[this._key]} already exists`
                }]
                error.status = 409;

                return error;
            }
        }

        static redisClient = client;

        // Default record lifetime, in seconds, for every entry of this model.
        // 0 (or falsy) means no expiry. Can be overridden per operation via a
        // {ttl} option on create()/update() or the instance expire() helper.
        static _ttl = 0;

        // Resolve the effective TTL (seconds) for an operation. A per-call
        // options.ttl wins over the model default. The typeof guard tolerates a
        // non-object second argument (e.g. create(data, true)) so positional
        // callers do not crash or accidentally set a TTL.
        static _resolveTTL(options){
            let ttl = options && typeof options === 'object' ? options.ttl : undefined;
            return ttl !== undefined ? ttl : this._ttl;
        }

        static models = {}
        static register = function(Model){
            Model = Model || this;
            this.models[Model.name] = Model;
        }

        constructor(data){
            for(let key in data){
                this[key] = data[key];
            }
        }

        static async get(index, queryHelper){
            try{
                // Ensure client is connected before proceeding
                await ensureClientReady();

                if(typeof index === 'object'){
                    index = index[this._key];
                }

                let result = await client.HGETALL(
                    redisPrefix(`${this.prototype.constructor.name}_${index}`)
                );

                if(!result || !Object.keys(result).length){
                    let error = new Error('EntryNotFound');
                    error.name = 'EntryNotFound';
                    error.message = `${this.prototype.constructor.name}:${index} does not exists`;
                    error.status = 404;
                    throw error;
                }

                // Redis always returns strings, use the keyMap schema to turn them
                // back to native values.
                result = objValidate.parseFromString(this._keyMap, result);

                let instance = new this(result);
                await instance.buildRelations(queryHelper);

                return instance;
            }catch(error){
                throw error;
            }
        }

        async buildRelations(queryHelper){
            // Create QueryHelper if not provided
            if(!queryHelper){
                queryHelper = new QueryHelper(this);
            }

            for(let [key, options] of Object.entries(this.constructor._keyMap)){
                if(options.model){
                    let remoteModel = this.constructor.models[options.model]
                    try{
                        if(!QueryHelper.isNotCycle(remoteModel.name, queryHelper)) continue;
                        if(options.rel === 'one'){
                            this[key] = await remoteModel.get(this[key] || this[options.localKey || this.constructor._key] , queryHelper)
                        }
                        if(options.rel === 'many'){
                            this[key] = await remoteModel.listDetail({
                                [options.remoteKey]: this[options.localKey || this.constructor._key],
                            }, queryHelper)

                        }
                    }catch(error){
                        // Silently ignore relation loading errors (record may not exist)
                    }
                }
            }
        }

        static async exists(index){
            // Ensure client is connected before proceeding
            await ensureClientReady();

            if(typeof index === 'object'){
                index = index[this._key];
            }

            // "Exists" means the record is actually retrievable, i.e. its hash
            // is present. With TTL enabled the hash can expire while the id
            // lingers in the index SET; treat that as not-existing and SREM the
            // dangling member so the index self-heals.
            const hashExists = Boolean(await client.EXISTS(
                redisPrefix(`${this.prototype.constructor.name}_${index}`)
            ));

            if(!hashExists){
                await client.SREM(redisPrefix(this.prototype.constructor.name), index);
            }

            return hashExists;
        }

        static async list(){
            // return a list of all the index keys for this table.
            try{
                // Ensure client is connected before proceeding
                await ensureClientReady();

                return await client.SMEMBERS(
                    redisPrefix(this.prototype.constructor.name)
                );

            }catch(error){
                throw error;
            }
        }

        static async listDetail(options, queryHelper){

            // Return a list of the entries as instances.
            let out = [];

            for(let entry of await this.list()){
                let instance;
                try{
                    instance = await this.get(entry, arguments[arguments.length - 1]);
                }catch(error){
                    // A TTL-expired hash leaves its id in the index SET. Drop the
                    // dangling member and skip it rather than aborting the whole
                    // listing over one missing entry.
                    if(error && error.name === 'EntryNotFound'){
                        await client.SREM(redisPrefix(this.prototype.constructor.name), entry);
                        continue;
                    }
                    throw error;
                }
                if(!options) out.push(instance);
                let matchCount = 0;
                for(let option in options){
                    if(instance[option] === options[option] && ++matchCount === Object.keys(options).length){
                        out.push(instance);
                        break;
                    }
                }
            }

            return out;
        }

        static findall(...args){
            return this.listDetail(...args);
        }

        // Scan every key matching a pattern, following the SCAN cursor to the
        // end. Returns a plain array of key names.
        static async _scanKeys(match){
            await ensureClientReady();

            const keys = [];
            // redis v5+ requires the SCAN cursor as a string; '0' both starts
            // and terminates the iteration.
            let cursor = '0';
            do{
                const reply = await client.SCAN(cursor, {MATCH: match, COUNT: 1000});
                // node-redis returns {cursor, keys}; tolerate the raw array form.
                cursor = String(reply.cursor !== undefined ? reply.cursor : reply[0]);
                const batch = reply.keys !== undefined ? reply.keys : reply[1];
                for(const key of batch) keys.push(key);
            }while(cursor !== '0');

            return keys;
        }

        // For a registered model, verify every rel:'one' foreign key resolves
        // to a live member of the target model's index set.
        static async _relationOrphans(name, model, backedIds){
            const out = [];
            const keyMap = model._keyMap || {};
            const relFields = Object.entries(keyMap)
                .filter(([, opt]) => opt && opt.model && opt.rel === 'one');
            if(!relFields.length) return out;

            for(const id of backedIds){
                const hash = await client.HGETALL(redisPrefix(`${name}_${id}`));
                for(const [field, opt] of relFields){
                    // The FK is stored at localKey (or the model's own _key),
                    // matching how buildRelations resolves the relation.
                    const fkField = opt.localKey || model._key;
                    const fk = hash[field] || hash[fkField];
                    if(!fk) continue;

                    const target = this.models[opt.model];
                    if(!target) continue; // target model not registered, cannot verify

                    const isMember = await client.SISMEMBER(redisPrefix(target.name), fk);
                    if(!isMember) out.push({id, field, target: opt.model, fk});
                }
            }

            return out;
        }

        /**
         * Find orphaned data across every model, derived purely from the
         * model-redis storage contract:
         *   <prefix><Model>       - SET of index values (source of truth)
         *   <prefix><Model>_<id>  - HASH of that entry's fields
         *
         * Model families are discovered from the keyspace (not just the
         * registry), so unregistered-but-used models are still reconciled.
         * Registered models additionally get their rel:'one' foreign keys
         * validated.
         *
         * Returns {prefix, models, unclassified, totals} where each model has
         *   leaked          - hashes whose id is absent from the set (invisible
         *                      to list()/listDetail())
         *   dangling        - set members with no backing hash (get() 404s)
         *   brokenRelations - rel:'one' FKs pointing at a missing target
         */
        static async findOrphans(){
            await ensureClientReady();

            const allKeys = await this._scanKeys(redisPrefix('*'));

            // Discover index-set names: a key of the form <prefix><Name> where
            // Name has no underscore (model class names never contain one).
            // Union with the registry so empty-but-registered models still show.
            const names = new Set(Object.keys(this.models));
            for(const key of allKeys){
                const rest = key.slice(prefix.length);
                if(rest.length && !rest.includes('_')){
                    if((await client.TYPE(key)) === 'set') names.add(rest);
                }
            }

            // Longest name first so a hash is attributed to the most specific
            // model prefix. The trailing underscore guard prevents ambiguity.
            const ordered = [...names].sort((a, b) => b.length - a.length);

            const family = {};
            for(const name of ordered) family[name] = {members: new Set(), hashes: new Set()};

            const unclassified = [];
            for(const key of allKeys){
                const rest = key.slice(prefix.length);
                if(family[rest] !== undefined) continue; // the index set itself
                const owner = ordered.find(name => rest.startsWith(`${name}_`));
                if(owner) family[owner].hashes.add(rest.slice(owner.length + 1));
                else unclassified.push(key);
            }

            for(const name of ordered){
                const members = await client.SMEMBERS(redisPrefix(name));
                for(const member of members) family[name].members.add(member);
            }

            const models = {};
            const totals = {leaked: 0, dangling: 0, brokenRelations: 0};
            for(const name of ordered){
                const {members, hashes} = family[name];
                const leaked = [...hashes].filter(id => !members.has(id));
                const dangling = [...members].filter(id => !hashes.has(id));
                const backed = [...members].filter(id => hashes.has(id));

                const registered = this.models[name];
                const brokenRelations = registered
                    ? await this._relationOrphans(name, registered, backed)
                    : [];

                models[name] = {
                    registered: Boolean(registered),
                    counts: {members: members.size, hashes: hashes.size},
                    leaked,
                    dangling,
                    brokenRelations,
                };
                totals.leaked += leaked.length;
                totals.dangling += dangling.length;
                totals.brokenRelations += brokenRelations.length;
            }

            return {prefix, models, unclassified, totals};
        }

        /**
         * Remove the unambiguously-safe orphans only: dangling set members
         * point at nothing, so SREM cannot lose data. Leaked hashes and broken
         * relations still contain data and are left for manual review.
         * Pass a report from findOrphans() to reuse it, or omit to compute one.
         */
        static async pruneOrphans(report){
            report = report || await this.findOrphans();

            let removedDangling = 0;
            for(const [name, info] of Object.entries(report.models)){
                for(const id of info.dangling){
                    await client.SREM(redisPrefix(name), id);
                    removedDangling++;
                }
            }

            return {removedDangling};
        }

        static async create(data, options){
            // Add a entry to this redis table.
            try{
                // Ensure client is connected before proceeding
                await ensureClientReady();

                // Validate the passed data by the keyMap schema.
                data = objValidate.processKeys(this._keyMap, data);

                // Do not allow the caller to overwrite an existing index key,
                if(data[this._key] && await this.exists(data)){
                    let error = new Error('EntryNameUsed');
                    error.name = 'EntryNameUsed';
                    error.message = `${this.prototype.constructor.name}:${data[this._key]} already exists`;
                    error.keys = [{
                        key: this._key,
                        message: `${this.prototype.constructor.name}:${data[this._key]} already exists`
                    }]
                    error.status = 409;

                    throw error;
                }

                // Add the key to the members for this redis table
                await client.SADD(
                    redisPrefix(this.prototype.constructor.name),
                    data[this._key]
                );

                // Add the values for this entry.
                for(let key of Object.keys(data)){
                    if(data[key] === undefined) continue;
                    await client.HSET(
                        redisPrefix(`${this.prototype.constructor.name}_${data[this._key]}`),
                        key,
                        objValidate.parseToString(data[key])
                    );
                }

                // Apply expiry to the record hash if this model/operation has a
                // TTL. Only the hash carries the TTL; the index SET member is
                // reaped lazily on read once the hash is gone.
                let ttl = this._resolveTTL(options);
                if(ttl > 0){
                    await client.EXPIRE(
                        redisPrefix(`${this.prototype.constructor.name}_${data[this._key]}`),
                        ttl
                    );
                }

                // return the created redis entry as entry instance.
                return await this.get(data[this._key]);
            } catch(error){
                throw error;
            }
        }

        async update(data, options){
            // Update an existing entry.
            try{
                // Ensure client is connected before proceeding
                await ensureClientReady();

                // Validate the passed data, ignoring required fields.
                data = objValidate.processKeys(this.constructor._keyMap, data, true);

                // Capture the remaining lifetime before any RENAME, which in
                // Redis drops the TTL. Field-level HSET below preserves the TTL,
                // so we only need to re-apply it when the primary key changes.
                const pttl = await client.PTTL(
                    redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`)
                );

                // Whether the primary key is changing. Captured now because the
                // field loop below reassigns this[_key] to the new value.
                const renamed = Boolean(data[this.constructor._key]
                    && data[this.constructor._key] !== this[this.constructor._key]);

                // Check to see if entry name changed.
                if(renamed){
                    // Remove the index key from the tables members list.

                    if(data[this.constructor._key] && await this.constructor.exists(data)){
                        let error = new Error('EntryNameUsed');
                        error.name = 'EntryNameUsed';
                        error.message = `${this.constructor.name}:${data[this.constructor._key]} already exists`;
                        error.keys = [{
                            key: this.constructor._key,
                            message: `${this.constructor.name}:${data[this.constructor._key]} already exists`
                        }]
                        error.status = 409;

                        throw error;
                    }

                    await client.SREM(
                        redisPrefix(this.constructor.name),
                        this[this.constructor._key]
                    );

                    // Add the key to the members for this redis table
                    await client.SADD(
                        redisPrefix(this.constructor.name),
                        data[this.constructor._key]
                    );

                    await client.RENAME(
                        redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`),
                        redisPrefix(`${this.constructor.name}_${data[this.constructor._key]}`),
                    );

                }
                // Update what ever fields that where passed.

                // Loop over the data fields and apply them to redis
                for(let key of Object.keys(data)){
                    this[key] = data[key];
                    await client.HSET(
                        redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`),
                        key, objValidate.parseToString(data[key])
                    );
                }

                // TTL handling: an explicit {ttl} resets the lifetime; otherwise
                // keep it as-is. HSET already preserves the TTL for the in-place
                // case, but RENAME cleared it, so carry the captured remaining
                // lifetime across when the primary key changed.
                let hashKey = redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`);
                let optTTL = options && typeof options === 'object' ? options.ttl : undefined;
                if(optTTL !== undefined){
                    if(optTTL > 0){
                        await client.EXPIRE(hashKey, optTTL);
                    }else{
                        await client.PERSIST(hashKey);
                    }
                }else if(renamed && pttl > 0){
                    await client.PEXPIRE(hashKey, pttl);
                }

                return this;

            } catch(error){
                // Pass any error to the calling function
                throw error;
            }
        }

        async remove(data){
            // Remove an entry from this table.

            try{
                // Ensure client is connected before proceeding
                await ensureClientReady();

                // Remove the index key from the tables members list.
                await client.SREM(
                    redisPrefix(this.constructor.name),
                    this[this.constructor._key]
                );

                // Remove the entries hash values.
                let count = await client.DEL(
                    redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`)
                );

                // Return the number of removed values to the caller.
                return this;

            } catch(error) {
                throw error;
            }
        };

        // Set this entry's record hash to expire after `seconds`. Returns this.
        async expire(seconds){
            await ensureClientReady();
            await client.EXPIRE(
                redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`),
                seconds
            );
            return this;
        }

        // Remove any expiry from this entry's record hash. Returns this.
        async persist(){
            await ensureClientReady();
            await client.PERSIST(
                redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`)
            );
            return this;
        }

        // Remaining lifetime of this entry's record hash, in seconds.
        // Mirrors Redis TTL: -1 = no expiry, -2 = key missing.
        async ttl(){
            await ensureClientReady();
            return await client.TTL(
                redisPrefix(`${this.constructor.name}_${this[this.constructor._key]}`)
            );
        }

        toJSON(){
            let result = {};
            for (const [key, value] of Object.entries(this)) {
                if(this.constructor._keyMap[key] && this.constructor._keyMap[key].isPrivate) continue;
                result[key] = value;
            }

            return result

            // return JSON.stringify(result);
        }

        toString(){
            return this[this.constructor._key];
        }

    }

    return Table;
}

module.exports = setUpTable;
