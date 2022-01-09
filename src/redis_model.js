'use strict';

const objValidate = require('./object_validate');


function setUpTable(client){

	class Table{
		static _indexed = [];

		constructor(data){
			for(let key in data){
				this[key] = data[key];
			}
		}

		static async get(index){
			try{

				if(typeof index === 'object'){
					index = index[this._key]
				}

				let result = await client.HGETALL(`${this.prototype.constructor.name}_${index}`);

				if(Object.keys(result).length === 0){
					let error = new Error('EntryNotFound');
					error.name = 'EntryNotFound';
					error.message = `${this.prototype.constructor.name}:${index} does not exists`;
					error.status = 404;
					throw error;
				}

				// Redis always returns strings, use the keyMap schema to turn them
				// back to native values.
				result = objValidate.parseFromString(this._keyMap, result);

				return new this.prototype.constructor(result)

			}catch(error){
				throw error;
			}

		}

		static async exists(data){
			try{
				await this.get(data);

				return true
			}catch(error){
				return false;
			}
		}

		static async list(index_key, value){
			// return a list of all the index keys for this table.
			try{

				if(index_key && !this._indexed.includes(index_key)) return [];

				if(index_key && this._indexed.includes(index_key)){
					return await client.SMEMBERS(`${this.prototype.constructor.name}_${index_key}_${value}`);
				}

				return await client.SMEMBERS(this.prototype.constructor.name);

			}catch(error){
				throw error;
			}
		}

		static async listDetail(index_key, value){
			// Return a list of the entries as instances.
			let out = [];

			for(let entry of await this.list(index_key, value)){
				out.push(await this.get(entry));
			}

			return out;
		}

		static async add(data){
			// Add a entry to this redis table.
			try{
				// Validate the passed data by the keyMap schema.

				data = objValidate.processKeys(this._keyMap, data);

				// Do not allow the caller to overwrite an existing index key,
				if(data[this._key] && await this.exists(data)){
					let error = new Error('EntryNameUsed');
					error.name = 'EntryNameUsed';
					error.message = `${this.prototype.constructor.name}:${data[this._key]} already exists`;
					error.status = 409;

					throw error;
				}

				// Add the key to the members for this redis table
				await client.SADD(this.prototype.constructor.name, String(data[this._key]));

				// Create index keys lists
				for(let index of this._indexed){
					if(data[index]) await client.SADD(
						`${this.prototype.constructor.name}_${index}_${data[index]}`,
						String(data[this._key]
					));
				}

				// Add the values for this entry.
				for(let key of Object.keys(data)){
					await client.HSET(`${this.prototype.constructor.name}_${data[this._key]}`, key, objValidate.parseToString(data[key]));
				}

				// return the created redis entry as entry instance.
				return await this.get(data[this._key]);
			} catch(error){
				throw error;
			}
		}

		async update(data, key){
			// Update an existing entry.
			try{
				// Check to see if entry name changed.
				if(data[this.constructor._key] && data[this.constructor._key] !== this[this.constructor._key]){

					// Merge the current data into with the updated data 
					let newData = Object.assign({}, this, data);

					// Remove the updated failed so it doesnt keep it
					delete newData.updated;

					// Create a new record for the updated entry. If that succeeds,
					// delete the old recored
					if(await this.add(newData)) await this.remove();

				}else{
					// Update what ever fields that where passed.

					// Validate the passed data, ignoring required fields.
					data = objValidate.processKeys(this.constructor._keyMap, data, true);
					
					// Update the index keys
					for(let index of this.constructor._indexed){
						if(data[index]){
							await client.SREM(
								`${this.constructor.name}_${index}_${this[index]}`,
								String(this[this.constructor._key])
							);

							await client.SADD(
								`${this.constructor.name}_${index}_${data[index]}`,
								String(data[this.constructor._key] || this[this.constructor._key])
							);
						}

					}
					// Loop over the data fields and apply them to redis
					for(let key of Object.keys(data)){
						this[key] = data[key];
						await client.HSET(`${this.constructor.name}_${this[this.constructor._key]}`, key, data[key]);
					}
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
				// Remove the index key from the tables members list.

				await client.SREM(this.constructor.name, this[this.constructor._key]);

				for(let index of this.constructor._indexed){
					await client.SREM(`${this.constructor.name}_${index}_${data[value]}`, data[this.constructor._key]);
				}

				// Remove the entries hash values.
				let count = await client.DEL(`${this.constructor.name}_${this[this.constructor._key]}`);

				// Return the number of removed values to the caller.
				return count;

			} catch(error) {
				throw error;
			}
		};

	}
}

module.exports = setUpTable;
