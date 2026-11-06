import type { Notice } from "@/screens/channels/channel-actions";

type Props = {
  notice: Notice | null;
};

/** Stand-in until #62's toasts. Both regions stay mounted so screen readers announce changes. */
export function NoticeLine({ notice }: Props) {
  return (
    <div className="text-sm">
      <div role="status">{notice?.tone === "ok" && <p className="pb-2 text-muted-foreground">{notice.text}</p>}</div>
      <div role="alert">{notice?.tone === "error" && <p className="pb-2 text-destructive">{notice.text}</p>}</div>
    </div>
  );
}
