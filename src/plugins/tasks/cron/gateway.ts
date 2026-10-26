import { CronTask as BaseCronTask } from './CronTask';

import type { Core } from '@seedcord/gateway';

export * from '.';

export abstract class CronTask extends BaseCronTask<Core> {}
