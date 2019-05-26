// Native needs its own entry point because its proxy requires NativeScript
// modules that are not available in non-native project.
//
// This also gives us the opportunity to better customize default loader
// configuration for native projects.
// 
const { makeLoader } = require('./lib/loader');
const hotApi = require.resolve('./lib/hot-api-native.js');

module.exports = makeLoader({
	hotApi,
});
