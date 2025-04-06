import { useRouter } from "next/router";
import { useEffect, useState } from "react";

type ParamType = "string" | "number" | "boolean";

type ParamDefinition<T extends ParamType = ParamType> = {
    default: T extends "string"
    ? string
    : T extends "number"
    ? number
    : T extends "boolean"
    ? boolean
    : never;
    type: T;
    keys?: string[];  // Array of possible keys for the parameter
};

type ParamSchema = Record<string, ParamDefinition>;

type ParsedValue<T extends ParamType> = T extends "string"
    ? string
    : T extends "number"
    ? number
    : T extends "boolean"
    ? boolean
    : never;

type ParamResult<T extends ParamType> = {
    value: ParsedValue<T>;
    found: boolean;
    set: (newValue: ParsedValue<T>) => void;
};

type QueryParamsResult<S extends ParamSchema> = {
    [K in keyof S]: ParamResult<S[K]["type"]>;
};

// === Parser helpers ===

function parseValue<T extends ParamType>(
    raw: string | null,
    def: ParamDefinition<T>
): ParsedValue<T> {
    if (raw === null) return def.default;

    switch (def.type) {
        case "number":
            const num = parseFloat(raw);
            return isNaN(num) ? def.default : (num as ParsedValue<T>);
        case "boolean":
            return (raw === "true" || raw === "1") as ParsedValue<T>;
        case "string":
        default:
            return raw as ParsedValue<T>;
    }
}

// === Hook ===

/**
 * useQueryParams
 * 
 * A type-safe hook for accessing query parameters with default values and parsing.
 * Supports multiple keys for a single parameter (e.g., ?selected_stop, ?s, ?ss).
 * 
 * @param schema An object defining expected query parameters, their types, default values, and multiple possible keys.
 * @returns An object where each key corresponds to a query param with `{ value, found }`.
 * 
 * @example
 * const { page, debug } = useQueryParams({
 *   page: { type: "number", default: 1, keys: ["page"] },
 *   debug: { type: "boolean", default: false, keys: ["debug", "d"] },
 * });
 * 
 * console.log(page.value);  // 1 or parsed number from ?page=
 * console.log(debug.found); // true if ?debug= or ?d= is present
 */
export function useQueryParams<S extends ParamSchema>(
    schema: S
): QueryParamsResult<S> {
    const router = useRouter();

    const [params, setParams] = useState<QueryParamsResult<S>>(() => {
        const result = {} as QueryParamsResult<S>;

        for (const key in schema) {
            const def = schema[key];
            result[key] = {
                value: def.default as ParsedValue<typeof def["type"]>,
                found: false,
                set: () => { } // will be replaced later
            };
        }

        return result;
    });

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const result = {} as QueryParamsResult<S>;

        for (const key in schema) {
            const def = schema[key];
            let found = false;
            let value: string | null = null;

            const allKeys = [key, ...(def.keys || [])];

            for (const paramKey of allKeys) {
                const raw = urlParams.get(paramKey);
                if (raw !== null) {
                    value = raw;
                    found = true;
                    break;
                }
            }

            const parsedValue = parseValue(value, def);

            result[key] = {
                value: parsedValue as ParsedValue<typeof def["type"]>,
                found,
                set: (newValue: ParsedValue<typeof def["type"]>) => {
                    const newParams = new URLSearchParams(window.location.search);
                    const mainKey = def.keys?.[0] || key;

                    // Update value
                    newParams.set(mainKey, String(newValue));

                    // Use shallow routing to update the URL
                    router.replace(
                        {
                            pathname: router.pathname,
                            query: Object.fromEntries(newParams.entries()),
                        },
                        undefined,
                        { shallow: true }
                    );
                },
            };
        }

        setParams(result);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router.query, ...Object.keys(schema)]);

    return params;
}


