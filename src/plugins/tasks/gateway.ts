import { Task as BaseTask } from './Task';

import type { Core } from '@seedcord/gateway';

export * from '.';

export abstract class Task<TData = void> extends BaseTask<TData, Core> {}
