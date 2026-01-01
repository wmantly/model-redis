'use strict';
const table = require('./src/redis_model')
var client = null

function setUpTable(obj){
	obj = obj || {};

	let connectionPromise;

	if(obj.redisClient){
		client = obj.redisClient;
		// If a client is provided, assume it's already connected or will be connected externally
		connectionPromise = Promise.resolve(client);
	}else{
		const {createClient} = require('redis');
		client = createClient(obj.redisConf || {});
		// Connect in background and store the promise
		connectionPromise = client.connect().then(() => client);
	}

	// Return Table class immediately with connection promise injected
	return table(client, obj.prefix, connectionPromise);
}

module.exports = {client, setUpTable};
