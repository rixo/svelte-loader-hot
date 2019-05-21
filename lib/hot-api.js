import { Registry, configure as configureProxy, createProxy } from 'svelte-dev-helper';

const hotOptions = {
	noPreserveState: false,
};

let lastSuppliedOptions = null;

const deepEqual = (a, b) => {
	if (a === b) return true;
	if (!a || !b) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	const keyEqual = key => deepEqual(a[key], b[key]);
	return aKeys.every(keyEqual);
};

export function configure(options) {
	if (!deepEqual(lastSuppliedOptions, options)) {
		lastSuppliedOptions = options;
		Object.assign(hotOptions, options);
		configureProxy(hotOptions);
	}
}

export function register(id, component) {

	//store original component in registry
	Registry.set(id, {
		rollback: null,
		component,
		instances: []
	});

	//create the proxy itself
	const proxy = createProxy(id);

	//patch the registry record with proxy constructor
	const record = Registry.get(id);
	record.proxy = proxy;
	Registry.set(id, record);

	return proxy;
}

export function reload(id, component) {

	const record = Registry.get(id);

	//keep reference to previous version to enable rollback
	record.rollback = record.component;

	//replace component in registry with newly loaded component
	record.component = component;

	Registry.set(id, record);

	// this need to be done only once per HMR update (see Proxy for details)
	if (record.copyStatics) {
		record.copyStatics();
	}

	//re-render the proxy instances
	record.instances.filter(Boolean).forEach(function(instance) {
		instance._rerender();
	});

	//return the original proxy constructor that was `register()`-ed
	return record.proxy;
}

// One stop shop for HMR updates. Combines functionality of `configure`,
// `register`, and `reload`, based on current registry state.
//
// Additionaly does whatever it can to avoid crashing on runtime errors,
// and tries to decline HMR if that doesn't go well.
//
export function applyHMR(hotOptions, id, moduleHot, component) {
	// proceed (with caution) && accept/decline based on result
	try {
		let proxy;
		// resolve existing record
		const record = Registry.get(id);
		// register or reload
		if (record) {
			proxy = reload(id, component);
		} else {
			// first call => configure (option cannot change once running)
			configure(hotOptions);
			proxy = register(id, component);
		}
		// accept or decline
		if (proxy) {
			moduleHot.accept();
		} else {
			console.warn('Failed to apply HMR', id);
			moduleHot.decline();
		}
		return proxy;
	} catch (err) {
		moduleHot.decline();
		console.error('Failed to apply HMR on error', id, err);
	}
}
