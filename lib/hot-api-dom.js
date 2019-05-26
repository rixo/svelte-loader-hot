import { createProxy } from 'svelte-dev-helper';

import initHotApi from './hot-api';

export const applyHMR = initHotApi(createProxy);
