import { hideAction } from "@/app/actions";
import type { HiddenKind } from "@/lib/db";

export const smallButtonClass = "btn btn-xs";

// A small button that hides an item, or everything matching a rule.
export function HideButton({
  kind,
  value,
  label,
  children,
}: {
  kind: HiddenKind;
  value: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <form action={hideAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="value" value={value} />
      <input type="hidden" name="label" value={label} />
      <button type="submit" className={smallButtonClass}>
        {children}
      </button>
    </form>
  );
}
