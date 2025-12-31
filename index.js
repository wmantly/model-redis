'use strict';
const table = require('./src/redis_model')
var client = null

async function setUpTable(obj){
	obj = obj || {};

	if(obj.redisClient){
		client = obj.redisClient;
	}else{
		const {createClient} = require('redis');
		client = createClient(obj.redisConf || {});
		await client.connect();
	}

	// test client connection

	return table(client, obj.prefix);
}

module.exports = {client, setUpTable};
