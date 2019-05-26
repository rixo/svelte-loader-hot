const { makeLoader } = require('./lib/loader');
const hotApi = require.resolve('./lib/hot-api-dom.js');

module.exports = makeLoader({
	hotApi,
});
