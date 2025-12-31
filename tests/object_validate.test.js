'use strict';

const {
    processKeys,
    parseFromString,
    parseToString,
    ObjectValidateError
} = require('../src/object_validate');

describe('object_validate', () => {

    describe('processKeys', () => {

        test('should validate required fields', () => {
            const schema = {
                name: { type: 'string', isRequired: true }
            };

            expect(() => {
                processKeys(schema, {});
            }).toThrow(ObjectValidateError);
        });

        test('should pass with required fields present', () => {
            const schema = {
                name: { type: 'string', isRequired: true }
            };

            const result = processKeys(schema, { name: 'John' });
            expect(result).toEqual({ name: 'John' });
        });

        test('should validate type checking', () => {
            const schema = {
                age: { type: 'number' }
            };

            expect(() => {
                processKeys(schema, { age: 'not a number' });
            }).toThrow(ObjectValidateError);
        });

        test('should apply default values', () => {
            const schema = {
                active: { type: 'boolean', default: true }
            };

            const result = processKeys(schema, {});
            expect(result.active).toBe(true);
        });

        test('should apply default function values', () => {
            const schema = {
                created: { type: 'number', default: () => Date.now() }
            };

            const result = processKeys(schema, {});
            expect(typeof result.created).toBe('number');
            expect(result.created).toBeGreaterThan(0);
        });

        test('should validate string min length', () => {
            const schema = {
                name: { type: 'string', min: 3 }
            };

            expect(() => {
                processKeys(schema, { name: 'ab' });
            }).toThrow(ObjectValidateError);
        });

        test('should validate string max length', () => {
            const schema = {
                name: { type: 'string', max: 5 }
            };

            expect(() => {
                processKeys(schema, { name: 'toolong' });
            }).toThrow(ObjectValidateError);
        });

        test('should validate number min value', () => {
            const schema = {
                age: { type: 'number', min: 18 }
            };

            expect(() => {
                processKeys(schema, { age: 17 });
            }).toThrow(ObjectValidateError);
        });

        test('should validate number max value', () => {
            const schema = {
                age: { type: 'number', max: 100 }
            };

            expect(() => {
                processKeys(schema, { age: 101 });
            }).toThrow(ObjectValidateError);
        });

        test('should handle partial updates', () => {
            const schema = {
                name: { type: 'string', isRequired: true },
                age: { type: 'number' }
            };

            // In partial mode, missing required fields are allowed
            const result = processKeys(schema, { age: 25 }, true);
            expect(result).toEqual({ age: 25 });
        });

        test('should always process fields with always flag', () => {
            const schema = {
                updated: { type: 'number', always: true, default: () => Date.now() }
            };

            // Even in partial mode, 'always' fields are processed
            const result = processKeys(schema, {}, true);
            expect(result.updated).toBeDefined();
        });

        test('should throw ObjectValidateError with proper structure', () => {
            const schema = {
                name: { type: 'string', isRequired: true },
                age: { type: 'number', isRequired: true }
            };

            try {
                processKeys(schema, {});
            } catch (error) {
                expect(error.name).toBe('ObjectValidateError');
                expect(error.status).toBe(422);
                expect(Array.isArray(error.message)).toBe(true);
                expect(error.message.length).toBe(2);
            }
        });
    });

    describe('parseFromString', () => {

        test('should parse string to number', () => {
            const schema = {
                age: { type: 'number' }
            };

            const result = parseFromString(schema, { age: '25' });
            expect(result.age).toBe(25);
            expect(typeof result.age).toBe('number');
        });

        test('should parse string to boolean (true)', () => {
            const schema = {
                active: { type: 'boolean' }
            };

            const result = parseFromString(schema, { active: 'true' });
            expect(result.active).toBe(true);
        });

        test('should parse string to boolean (false)', () => {
            const schema = {
                active: { type: 'boolean' }
            };

            const result = parseFromString(schema, { active: 'false' });
            expect(result.active).toBe(false);
        });

        test('should parse string to object', () => {
            const schema = {
                metadata: { type: 'object' }
            };

            const result = parseFromString(schema, { metadata: '{"key":"value"}' });
            expect(result.metadata).toEqual({ key: 'value' });
        });

        test('should keep string as string', () => {
            const schema = {
                name: { type: 'string' }
            };

            const result = parseFromString(schema, { name: 'John' });
            expect(result.name).toBe('John');
        });

        test('should handle fields without type in schema', () => {
            const schema = {
                name: { type: 'string' }
            };

            const result = parseFromString(schema, { name: 'John', extra: 'field' });
            expect(result.extra).toBe('field');
        });
    });

    describe('parseToString', () => {

        test('should convert number to string', () => {
            const result = parseToString(42);
            expect(result).toBe('42');
            expect(typeof result).toBe('string');
        });

        test('should convert boolean to string', () => {
            expect(parseToString(true)).toBe('true');
            expect(parseToString(false)).toBe('false');
        });

        test('should convert object to JSON string', () => {
            const obj = { key: 'value', num: 42 };
            const result = parseToString(obj);
            expect(result).toBe('{"key":"value","num":42}');
        });

        test('should convert array to JSON string', () => {
            const arr = [1, 2, 3];
            const result = parseToString(arr);
            expect(result).toBe('[1,2,3]');
        });

        test('should keep string as string', () => {
            const result = parseToString('hello');
            expect(result).toBe('hello');
        });

        test('should handle null', () => {
            const result = parseToString(null);
            expect(result).toBe('null');
        });

        test('should handle undefined', () => {
            const result = parseToString(undefined);
            expect(result).toBe('undefined');
        });
    });

    describe('ObjectValidateError', () => {

        test('should create error with proper properties', () => {
            const errors = [{ key: 'name', message: 'name is required' }];
            const error = new ObjectValidateError(errors);

            expect(error.name).toBe('ObjectValidateError');
            expect(error.message).toEqual(errors);
            expect(error.status).toBe(422);
        });

        test('should be instance of Error', () => {
            const error = new ObjectValidateError([]);
            expect(error instanceof Error).toBe(true);
        });
    });
});
