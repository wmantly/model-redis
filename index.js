'use strict';
const setUpTable = require('./src/redis_model')
var client = null

function main(redis){

	if(typeof redis === 'function'){
		client = redis;
	}else{
		const {createClient} = require('redis');
		client = createClient(redis || {});
		client.connect();
	}

	// test client connection
	
	return setUpTable(client);
}

module.exports = { client , main};
