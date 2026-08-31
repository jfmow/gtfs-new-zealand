import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ALERT_CAUSE_GROUPS, type AlertCause } from "@/lib/alert-causes";

/** Raw GTFS causes -> the group picker's toggle state - a group reads "on" only once every cause it covers is selected. */
export function groupKeysFor(causes: AlertCause[]): string[] {
    return ALERT_CAUSE_GROUPS.filter((g) => g.causes.every((c) => causes.includes(c))).map((g) => g.key);
}

/** Selected group keys -> the raw GTFS causes to actually save - the backend only ever filters on raw causes, grouping is purely a picker concern (see lib/alert-causes.ts). */
function causesForGroupKeys(keys: string[]): AlertCause[] {
    return ALERT_CAUSE_GROUPS.filter((g) => keys.includes(g.key)).flatMap((g) => g.causes);
}

/** Alert-type picker shared by StopNotifications and RouteNotifications - groups the dozen raw GTFS causes into a handful of buckets (see lib/alert-causes.ts) instead of one toggle per raw cause. */
export function CauseGroupPicker({
    causes,
    onChange,
    disabled,
}: {
    causes: AlertCause[];
    onChange: (causes: AlertCause[]) => void;
    disabled?: boolean;
}) {
    return (
        <ToggleGroup
            type="multiple"
            value={groupKeysFor(causes)}
            onValueChange={(keys) => onChange(causesForGroupKeys(keys))}
            className="flex flex-wrap justify-start gap-1.5"
        >
            {ALERT_CAUSE_GROUPS.map((group) => {
                const Icon = group.icon;
                return (
                    <ToggleGroupItem
                        key={group.key}
                        value={group.key}
                        disabled={disabled}
                        className="h-8 gap-1.5 rounded-full border px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                        <Icon className="h-3 w-3" />
                        {group.label}
                    </ToggleGroupItem>
                );
            })}
        </ToggleGroup>
    );
}
