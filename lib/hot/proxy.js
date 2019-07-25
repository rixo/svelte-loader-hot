import DomAdapter from './proxy-adapter-dom';

const handledMethods = ['constructor', '$destroy'];
const forwardedMethods = ['$set', '$on'];

const noop = () => {};

const warn = (...args) => console.warn('[HMR][Svelte]', ...args);

const captureState = cmp => {
	// sanity check: propper behaviour here is to crash noisily so that
	// user knows that they're looking at something broken
	if (!cmp) {
		throw new Error('Missing component');
	}
	if (!cmp.$$) {
		throw new Error('Invalid component');
	}
	const {
		$$: { callbacks, bound, ctx: props },
	} = cmp;
	return { props, callbacks, bound };
};

const restoreState = (cmp, restore) => {
	if (!restore) {
		return;
	}
	const { callbacks, bound } = restore;
	if (callbacks) {
		cmp.$$.callbacks = callbacks;
	}
	if (bound) {
		cmp.$$.bound = bound;
	}
	// props, props.$$slots are restored at component creation (works
	// better -- well, at all actually)
};

const posixify = file => file.replace(/[/\\]/g, '/');

const getBaseName = id =>
	id
		.split('/')
		.pop()
		.split('.')
		.shift();

const capitalize = str => str[0].toUpperCase() + str.slice(1);

const getFriendlyName = id => capitalize(getBaseName(posixify(id)));

const getDebugName = id => `<${getFriendlyName(id)}>`;

const relayCalls = (getTarget, names, dest = {}) => {
	for (const key of names) {
		dest[key] = function(...args) {
			const target = getTarget();
			if (!target) {
				return;
			}
			return target[key] && target[key].call(this, ...args);
		};
	}
	return dest;
};

const copyComponentMethods = (proxy, cmp, debugName) => {
	//proxy custom methods
	const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(cmp));
	methods.forEach(method => {
		if (
			!handledMethods.includes(method) &&
      !forwardedMethods.includes(method)
		) {
			proxy[method] = function() {
				if (cmp[method]) {
					return cmp[method].apply(this, arguments);
				} else {
					// we can end up here when calling a method added by a previous
					// version of the component, then removed (but still called
					// somewhere else in the code)
					//
					// TODO we should possibly consider removing all the methods that
					//   have been added by a previous version of the component. This
					//   would be better memory-wise. Not so much so complexity-wise,
					//   though. And for now, we can't survive most runtime errors, so
					//   we will be reloaded often...
					//
					throw new Error(
						`Called to undefined method on ${debugName}: ${method}`
					);
				}
			};
		}
	});
};

// TODO clean this extremely ad-hoc, coupled, & fragile code
// TODO native: this must respect Page/Frame interface... or need tolerance from SN
const createErrorProxy = (adapter, err, target, anchor) => {
	const cmp = {
		$destroy: noop,
		$set: noop,
		$$: {
			fragment: {
				c: noop, // create
				l: noop, // claim
				h: noop, // hydrate
				m: (target, anchor) => {
					cmp.$destroy = adapter.renderError(err, target, anchor);
				}, // mount
				p: noop, // update
				i: noop, // intro
				o: noop, // outro
				d: noop, // destroy
			},
			ctx: {},
			// state
			props: [],
			update: noop,
			not_equal: noop,
			bound: {},
			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_render: [],
			after_render: [],
			context: {},
			// everything else
			callbacks: [],
			dirty: noop,
		},
	};
	if (target) {
		cmp.$destroy = adapter.renderError(err, target, anchor);
	}
	return cmp;
};

// everything in the constructor!
//
// so we don't polute the component class with new members
//
// specificity & conformance with Svelte component constructor is achieved
// in the "component level" (as opposed "instance level") createRecord
//
class ProxyComponent {
	constructor(
		{
			Adapter,
			id,
			debugName,
			current, // { component, hotOptions: { noPreserveState, ... } }
			register,
			unregister,
			reportError,
		},
		options // { target, anchor, ... }
	) {
		let cmp;
		let disposed = false;
		let restore;

		// it's better to restore props from the very beginning -- for example
		// slots (yup, stored in props as $$slots) are broken if not present at
		// component creation and later restored with $set
		const restoreProps = restore => {
			return restore && restore.props && { props: restore.props };
		};

		const doCreateComponent = (target, anchor) => {
			const { component } = current;
			const opts = Object.assign(
				{},
				options,
				{ target, anchor },
				restoreProps(restore)
			);
			cmp = new component(opts);

			this.$$ = cmp.$$;

			const local = cmp;
			cmp.$$.on_destroy.push(() => {
				if (local === cmp) {
					afterDetach();
				}
			});

			const m = cmp.$$.fragment.m;
			cmp.$$.fragment.m = (...args) => {
				const result = m(...args);
				afterMount(...args);
				return result;
			};

			copyComponentMethods(this, cmp);
			restoreState(cmp, restore);
		};

		const createComponent = (target, anchor) => {
			try {
				doCreateComponent(target, anchor);
				return true;
			} catch (err) {
				setError(err, target, anchor);
			}
			return false;
		};

		const destroyComponent = () => {
			// destroyComponent is tolerant (don't crash on no cmp) because it
			// is possible that reload/rerender is called after a previous
			// createComponent has failed (hence we have a proxy, but no cmp)
			if (cmp) {
				const target = cmp;
				cmp = null;
				target.$destroy();
			}
		};

		const refreshComponent = (target, anchor, conservativeDestroy) => {
			if (conservativeDestroy) {
				const prevCmp = cmp;
				restore = captureState(cmp);
				const created = createComponent(target, anchor);
				if (created) {
					prevCmp.$destroy();
					return true;
				} else {
					cmp = prevCmp;
					return false;
				}
			} else {
				restore = captureState(cmp);
				destroyComponent();
				const created = createComponent(target, anchor);
				return created;
			}
		};

		const setError = (err, target, anchor) => {
			if (!err) {
				adapter.rerender();
				return;
			}
			// notify HMR runtime client (if it's here to catch the event)
			reportError(err);
			// log
			warn('Failed to recreate component instance\n', err);
			// create a noop comp to trap Svelte's calls
			destroyComponent();
			cmp = createErrorProxy(adapter, err, target, anchor);
		};

		const instance = {
			hotOptions: current.hotOptions,
			proxy: this,
			id,
			debugName,
			refreshComponent,
		};

		if (current.hotOptions.noPreserveState) {
			instance.captureState = noop;
			instance.restoreState = noop;
		}

		const adapter = new Adapter(instance);

		const { afterMount, rerender } = adapter;

		// $destroy is not called when a child component is disposed, so we
		// need to hook from fragment.
		const afterDetach = () => {
			// NOTE do NOT call $destroy on the cmp from here; the cmp is already
			//   dead, this would not work
			if (!disposed) {
				disposed = true;
				adapter.dispose();
				unregister();
			}
		};

		// ---- register proxy instance ----

		register(rerender);

		// ---- augmented methods ----

		this.$destroy = () => {
			destroyComponent();
			afterDetach();
		};

		// ---- forwarded methods ----

		const getComponent = () => cmp;

		relayCalls(getComponent, forwardedMethods, this);

		// ---- create & mount target component instance ---

		{
			const { component } = current;
			const { target, anchor } = options;
			// copy statics before doing anything because a static prop/method
			// could be used somewhere in the create/render call
			copyStatics(component, this);

			const created = createComponent(target, anchor);
			// Svelte 3 creates and mount components from their constructor if
			// options.target is present.
			//
			// This means that at this point, the component's `fragment.c` and,
			// most notably, `fragment.m` will already have been called _from inside
			// createComponent_. That is: before we have a chance to hook on it.
			//
			// Proxy's constructor
			//   -> createComponent
			//     -> component constructor
			//       -> component.$$.fragment.c(...) (or l, if hydrate:true)
			//       -> component.$$.fragment.m(...)
			//
			//   -> you are here <-
			//
			// I've tried to move the responsibility for mounting the component here,
			// by setting `$$inline` option to prevent Svelte from doing it itself.
			// `$$inline` is normally used for child components, and their lifecycle
			// is managed by their parent. But that didn't go too well.
			//
			// We want the proxied component to be mounted on the DOM anyway, so it's
			// easier to let Svelte do its things and manually execute our `afterMount`
			// hook ourself (will need to do the same for `c` and `l` hooks, if we
			// come to need them here).
			//
			if (target && created) {
				afterMount(target, anchor);
			}
		}
	}
}

const copyStatics = (component, proxy) => {
	//forward static properties and methods
	for (let key in component) {
		proxy[key] = component[key];
	}
};

/*
creates a proxy object that
decorates the original component with trackers
and ensures resolution to the
latest version of the component
*/
export const initProxy = (Adapter = DomAdapter) =>
	function createProxy(id, component, hotOptions) {
		const debugName = getDebugName(id);
		const instances = [];

		let lastErrors = [];
		const reportError = err => {
			lastErrors.push(err);
		};
		const resetErrors = () => {
			lastErrors = [];
		};

		// current object will be updated, proxy instances will keep a ref
		const current = {
			component,
			hotOptions,
		};

		const name = `Proxy${debugName}`;

		// this trics gives the dynamic name Proxy<Component> to the concrete
		// proxy class... unfortunately, this doesn't shows in dev tools, but
		// it stills allow to inspect cmp.constructor.name to confirm an instance
		// is a proxy
		const proxy = {
			[name]: class extends ProxyComponent {
				constructor(options) {
					super(
						{
							Adapter,
							id,
							debugName,
							current,
							register: rerender => {
								instances.push(rerender);
							},
							unregister: () => {
								const i = instances.indexOf(this);
								instances.splice(i, 1);
							},
							reportError,
						},
						options
					);
				}
			},
		}[name];

		const reload = ({ component, hotOptions }) => {
			// update current references
			Object.assign(current, { component, hotOptions });
			// TODO delete props/methods previously added and of which value has
			// not changed since
			copyStatics(component, proxy);
			resetErrors();
			instances.forEach(rerender => rerender());
			if (!lastErrors) {
				warn('Failed to recreate components', ...lastErrors);
				return false;
			}
			return true;
		};

		return { id, proxy, reload };
	};
