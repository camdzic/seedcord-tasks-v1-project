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
