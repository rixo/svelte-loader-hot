import { createProxy } from 'svelte-dev-helper/native';

import initHotApi from './hot-api';

export const applyHMR = initHotApi(createProxy);
