import { parseDuration } from '@seedcord/utils';

// 2000-01-01 in ms. A smaller number is almost always a timestamp in seconds
const MIN_EPOCH_MS = 946_684_800_000;

export function isTimezone(timezone: string): boolean {
    try {
        return new Intl.DateTimeFormat(undefined, { timeZone: timezone }).resolvedOptions().timeZone.length > 0;
    } catch {
        return false;
    }
}

// swap for asError from @seedcord/utils/internal once this lives in the seedcord repo
export const toError = (thrown: unknown): Error => (Error.isError(thrown) ? thrown : new Error(String(thrown)));

// Plugin doesn't expose its attach key (= log channel), so find it on core
export function findAttachKey(core: object, plugin: object): string | undefined {
    for (const key of Object.keys(core)) {
        let value: unknown;

        try {
            value = Reflect.get(core, key);
        } catch {
            continue;
        }

        if (value === plugin) return key;

        if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
            for (const [leaf, nested] of Object.entries(value)) {
                if (nested === plugin) return `${key}.${leaf}`;
            }
        }
    }

    return undefined;
}

export function parseAt(at: Date | number): Date {
    if (typeof at === 'number' && at < MIN_EPOCH_MS) {
        throw new Error(`${at} looks like seconds. Pass milliseconds, like Date.now() + 60_000.`);
    }

    return new Date(at);
}

export function parseIn(duration: string): number {
    const ms = parseDuration(duration);

    if (ms === null) {
        throw new Error(
            `'${duration}' isn't a duration. Write a whole number above 0 and a unit (ms, s, m, h or d), like '90s' or '2h'.`
        );
    }

    return ms;
}
