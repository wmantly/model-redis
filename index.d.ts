/**
 * Type definitions for model-redis.
 */

/**
 * Supported field types stored as Redis strings and converted back on read.
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'object';

/**
 * Relationship kind for a schema field that links to another model.
 */
export type RelationType = 'one' | 'many';

/**
 * Options for a single field in a model's `_keyMap` schema.
 */
export interface FieldOptions {
    /** Native type the field will be validated against and restored to. */
    type?: FieldType;
    /** Whether the field must be present when creating a new entry. */
    isRequired?: boolean;
    /** Static value or function that returns the default for this field. */
    default?: any | (() => any);
    /** When true, the default is applied on every update (e.g. timestamps). */
    always?: boolean;
    /** Minimum string length or numeric value. */
    min?: number;
    /** Maximum string length or numeric value. */
    max?: number;
    /** When true, the field is omitted from `toJSON()` output. */
    isPrivate?: boolean;
    /** Target model name for a relationship field. */
    model?: string;
    /** Relationship kind: 'one' or 'many'. */
    rel?: RelationType;
    /** Local field used to resolve a relationship (defaults to the model `_key`). */
    localKey?: string;
    /** Remote field a 'many' relationship filters on. */
    remoteKey?: string;
}

/**
 * Full schema for a model.
 */
export type KeyMap = Record<string, FieldOptions>;

/**
 * Options passed to `setUpTable()`.
 */
export interface SetUpTableOptions {
    /** An already-connected Redis client to use instead of creating one. */
    redisClient?: any;
    /** Redis client configuration passed to `redis.createClient()`. */
    redisConf?: object;
    /** Prefix prepended to every Redis key. */
    prefix?: string;
}

/**
 * Validation error thrown by `processKeys()`.
 */
export class ObjectValidateError extends Error {
    constructor(message?: any);
    name: 'ObjectValidateError';
    /** Validation errors, one per failing field. */
    message: any;
    /** Suggested HTTP status code (422). */
    status: number;
}

/**
 * Internal helper that tracks models already loaded in a relation walk so
 * circular relationships do not recurse forever.
 */
export class QueryHelper {
    constructor(origin: Table);
    /** Model names already visited in this relation walk. */
    history: string[];
    /**
     * Returns false when `modelName` has already been visited by `queryHelper`,
     * otherwise records the visit and returns true.
     */
    static isNotCycle(modelName: string, queryHelper: QueryHelper | any): boolean;
}

/**
 * Counts returned inside each model's orphan report.
 */
export interface OrphanModelCounts {
    members: number;
    hashes: number;
}

/**
 * Per-model orphan information returned by `findOrphans()`.
 */
export interface OrphanModelReport {
    /** Whether this model was registered with `register()`. */
    registered: boolean;
    /** Number of index set members and backing hashes. */
    counts: OrphanModelCounts;
    /** Hash ids not present in the model's index set. */
    leaked: string[];
    /** Index set members with no backing hash. */
    dangling: string[];
    /** rel:'one' foreign keys pointing at a missing target. */
    brokenRelations: Array<{
        id: string;
        field: string;
        target: string;
        fk: string;
    }>;
}

/**
 * Full report returned by `Table.findOrphans()`.
 */
export interface OrphanReport {
    /** Key prefix used for the scan. */
    prefix: string;
    /** Orphan data grouped by discovered model name. */
    models: Record<string, OrphanModelReport>;
    /** Keys matching the prefix that could not be attributed to a model family. */
    unclassified: string[];
    /** Aggregated orphan counts across all models. */
    totals: {
        leaked: number;
        dangling: number;
        brokenRelations: number;
    };
}

/**
 * Base Table class returned by `setUpTable()`. Extend this class to define
 * application models.
 */
export class Table {
    /** Model fields are stored as instance properties after create/update. */
    [key: string]: any;

    /** Primary key field name; must match a key in `_keyMap`. */
    static _key: string;
    /** Schema that defines valid fields and their options. */
    static _keyMap: KeyMap;
    /** Default record lifetime in seconds; 0 means no expiry. */
    static _ttl: number;

    /** Shared registry of models registered with `register()`. */
    static models: Record<string, typeof Table>;
    /** The Redis client bound to this Table. */
    static redisClient: any;
    /** Custom error constructors exposed by the Table class. */
    static errors: {
        ObjectValidateError: typeof ObjectValidateError;
        EntryNameUsed: () => Error;
    };

    /**
     * Register a model in the global registry so relationships can resolve it.
     * When called without an argument the model registers itself.
     */
    static register(Model?: typeof Table): void;

    /**
     * Create and return a new entry after validating `data` against `_keyMap`.
     * Pass `{ttl: <seconds>}` as `options` to override the model default.
     */
    static create<T extends typeof Table>(
        this: T,
        data: object,
        options?: { ttl?: number }
    ): Promise<InstanceType<T>>;

    /**
     * Return an instance for the given primary key. Throws `EntryNotFound` when
     * the record does not exist.
     */
    static get<T extends typeof Table>(
        this: T,
        index: string | object,
        queryHelper?: QueryHelper
    ): Promise<InstanceType<T>>;

    /** Return true when the primary key exists, false otherwise. */
    static exists(index: string | object): Promise<boolean>;

    /** Return an array of all primary keys in the table. */
    static list(): Promise<string[]>;

    /**
     * Return all entries as Table instances, optionally filtered by `options`.
     */
    static listDetail<T extends typeof Table>(
        this: T,
        options?: object,
        queryHelper?: QueryHelper
    ): Promise<InstanceType<T>[]>;

    /** Alias for `listDetail()`. */
    static findall<T extends typeof Table>(
        this: T,
        options?: object,
        queryHelper?: QueryHelper
    ): Promise<InstanceType<T>[]>;

    /** Scan the keyspace and report orphaned data across every model. */
    static findOrphans(): Promise<OrphanReport>;

    /**
     * Remove dangling index set members. Accepts a precomputed `OrphanReport`,
     * or computes a fresh report when omitted.
     */
    static pruneOrphans(report?: OrphanReport): Promise<{ removedDangling: number }>;

    constructor(data: object);

    /** Load relationships for this instance, guarding against cycles. */
    buildRelations(queryHelper?: QueryHelper): Promise<void>;

    /**
     * Update the instance with `data` and return the updated instance.
     * Pass `{ttl: <seconds>}` to reset expiry, or `{ttl: 0}` to clear it.
     */
    update(data: object, options?: { ttl?: number }): Promise<this>;

    /** Delete this entry from Redis and return the instance. */
    remove(): Promise<this>;

    /** Set this entry to expire after `seconds`. Returns the instance. */
    expire(seconds: number): Promise<this>;

    /** Remove any expiry from this entry. Returns the instance. */
    persist(): Promise<this>;

    /** Remaining lifetime in seconds. Redis semantics: -1 = none, -2 = gone. */
    ttl(): Promise<number>;

    /** Return a plain object representation; private fields are excluded. */
    toJSON(): object;

    /** Return the primary key value as a string. */
    toString(): string;
}

/**
 * Create and configure a Table class bound to Redis.
 *
 * Without options, a default Redis client is created and connected in the
 * background. Operations on the returned class automatically await the
 * connection.
 */
export declare function setUpTable(options?: SetUpTableOptions): typeof Table;

/**
 * The last Redis client created or supplied to `setUpTable()`.
 * This is `null` before `setUpTable()` is called.
 */
export declare var client: any | null;
