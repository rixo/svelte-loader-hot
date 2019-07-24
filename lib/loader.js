const { basename, extname, relative } = require('path');
const { getOptions } = require('loader-utils');
const VirtualModules = require('./virtual');

const { version } = require('svelte/package.json');
const major_version = +version[0];
const { compile, preprocess } =
	major_version >= 3 ? require('svelte/compiler') : require('svelte');

const pluginOptions = {
	externalDependencies: true,
	hotReload: true,
	hotOptions: true,
	preprocess: true,
	emitCss: true,

	// legacy
	shared: true,
	style: true,
	script: true,
	markup: true,
};

function posixify(file) {
	return file.replace(/[/\\]/g, '/');
}

function sanitize(input) {
	return basename(input)
		.replace(extname(input), '')
		.replace(/[^a-zA-Z_$0-9]+/g, '_')
		.replace(/^_/, '')
		.replace(/_$/, '')
		.replace(/^(\d)/, '_$1');
}

function capitalize(str) {
	return str[0].toUpperCase() + str.slice(1);
}

function normalize(compiled) {
	// svelte.compile signature changed in 1.60 — this avoids
	// future deprecation warnings while preserving backwards
	// compatibility
	const js = compiled.js || { code: compiled.code, map: compiled.map };

	const css =
		compiled.css && typeof compiled.css === 'object'
			? compiled.css
			: { code: compiled.css, map: compiled.cssMap };

	return {
		js,
		css,
		ast: compiled.ast,
		warnings: compiled.warnings || compiled.stats.warnings || [],
	};
}

const warned = {};
function deprecatePreprocessOptions(options) {
	const preprocessOptions = {}
	;['markup', 'style', 'script'].forEach(kind => {
		if (options[kind]) {
			if (!warned[kind]) {
				console.warn(
					`[svelte-loader] DEPRECATION: options.${kind} is now options.preprocess.${kind}`
				);
				warned[kind] = true;
			}
			preprocessOptions[kind] = options[kind];
		}
	});

	options.preprocess = options.preprocess || preprocessOptions;
}

const virtualModuleInstances = new Map();

const quote = JSON.stringify;

module.exports.makeLoader = ({ hotApi }) => {
	function makeHot(id, code, hotOptions = {}) {
		const options = JSON.stringify(hotOptions);
		const replacement = `
			if (module.hot) {
				const { applyHMR } = require('${posixify(hotApi)}');
				$2 = applyHMR(${options}, ${quote(id)}, module.hot, $2);
			}
			export default $2;
		`;
		return code.replace(/(export default ([^;]*));/, replacement);
	}

	return function(source, map) {
		if (this._compiler && !virtualModuleInstances.has(this._compiler)) {
			virtualModuleInstances.set(
				this._compiler,
				new VirtualModules(this._compiler)
			);
		}

		const virtualModules = virtualModuleInstances.get(this._compiler);

		this.cacheable();

		const options = Object.assign({}, this.options, getOptions(this));
		const callback = this.async();

		const isServer =
			this.target === 'node' || (options.generate && options.generate == 'ssr');
		const isProduction = this.minimize || process.env.NODE_ENV === 'production';

		const compileOptions = {
			filename: this.resourcePath,
			format: options.format || (major_version >= 3 ? 'esm' : 'es'),
		};

		const handleWarning = warning => this.emitWarning(new Error(warning));

		if (major_version >= 3) {
			// TODO anything?
		} else {
			compileOptions.shared = options.shared || 'svelte/shared.js';
			compileOptions.name = capitalize(sanitize(compileOptions.filename));
			compileOptions.onwarn = options.onwarn || handleWarning;
		}

		for (const option in options) {
			if (!pluginOptions[option]) compileOptions[option] = options[option];
		}

		if (options.emitCss) compileOptions.css = false;

		deprecatePreprocessOptions(options);
		options.preprocess.filename = compileOptions.filename;

		const id = relative(process.cwd(), compileOptions.filename);

		preprocess(source, options.preprocess)
			.then(processed => {
				if (processed.dependencies && this.addDependency) {
					for (let dependency of processed.dependencies) {
						this.addDependency(dependency);
					}
				}

				let { js, css, warnings } = normalize(
					compile(processed.toString(), compileOptions)
				);

				if (major_version >= 3) {
					warnings.forEach(
						options.onwarn
							? warning => options.onwarn(warning, handleWarning)
							: handleWarning
					);
				}

				if (options.hotReload && !isProduction && !isServer) {
					const hotOptions = Object.assign({}, options.hotOptions);
					js.code = makeHot(id, js.code, hotOptions);
				}

				if (options.emitCss && css.code) {
					const cssFilepath = compileOptions.filename.replace(
						/\.[^/.]+$/,
						`.svelte.css`
					);

					css.code += '\n/*# sourceMappingURL=' + css.map.toUrl() + '*/';
					js.code = js.code + `\nimport '${posixify(cssFilepath)}';\n`;

					if (virtualModules) {
						virtualModules.writeModule(cssFilepath, css.code);
					}
				}

				callback(null, js.code, js.map);
			})
			.catch(err => {
				const optimistic =
					options.hotReload &&
					options.hotOptions &&
					options.hotOptions.optimistic &&
					!isProduction;
				const errorCmpFilename = __dirname + '/ErrorComponent.svelte';
				if (optimistic && compileOptions.filename !== errorCmpFilename) {
					const formattedError = new Error(
						`${err.name} in ${id}\n${err.toString()}`
					);
					this.emitWarning(formattedError);
					this.addDependency(errorCmpFilename);
					const fs = require('fs');
					let source = fs.readFileSync(errorCmpFilename, 'utf8');
					const errData = { filename: id, message: err.toString() };
					const errorString = JSON.stringify(errData)
						.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;')
						.replace(/`/g, '\\`')
						.replace(/\\/g, '\\\\');
					source = source.replace("'%hmr_error%'", '`' + errorString + '`');
					source = compile(
						source,
						Object.assign({}, compileOptions, {
							filename: errorCmpFilename,
							css: true,
						})
					);
					callback(null, makeHot(id, source.js.code, {}));
				} else {
					// wrap error to provide correct
					// context when logging to console
					let msg =  `${err.name}: ${err.toString()}`;
					// details for file not found error are in error props
					if (err.code === 'ENOENT') {
						msg += ` (${err.path})`;
					}
					callback(new Error(msg));
				}
			});
	};
};
