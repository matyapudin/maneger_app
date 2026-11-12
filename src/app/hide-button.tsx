import { hideAction } from "@/app/actions";
import type { HiddenKind } from "@/lib/db";

export const smallButtonClass =
  "rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/[.05] dark:border-white/20 dark:hover:bg-white/[.08]";

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
