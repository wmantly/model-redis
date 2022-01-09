'use strict';
const table = require('./src/redis_model')
var client = null

function setUpTable(obj){
	obj = obj || {};

	if(obj.redisClient){
		client = obj.redisClient;
	}else{
		const {createClient} = require('redis');
		client = createClient(obj.redisConf || {});
		client.connect();
	}

	// test client connection
	
	return table(client);
}

module.exports = {client, setUpTable};
