import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import type { WhyNotGrabbedAnswer } from "@/screens/channels/catalog/catalog";
import { useWhyNotGrabbed } from "@/screens/channels/catalog/queries";

/** Radarr's rejections stay in its own words, and release titles are long and unbroken. */
function Answer({ answer: { message, releases } }: { answer: WhyNotGrabbedAnswer }) {
  const { msg } = useI18n();
  const rejected = releases.filter(({ rejections }) => rejections.length > 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p>{msg(message)}</p>
      {rejected.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rejected.map(({ title, rejections }) => (
            <li key={title} className="min-w-0">
              <p className="font-medium [overflow-wrap:anywhere]">{title}</p>
              <ul className="list-disc pl-4 text-muted-foreground">
                {rejections.map((rejection) => (
                  <li key={rejection}>{rejection}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Props = {
  channelId: number;
  tmdbId: number;
};

/** The button and, across the full width of the row below it, what Radarr answers. */
export function WhyNotGrabbed({ channelId, tmdbId }: Props) {
  const { t, errorText } = useI18n();
  const why = useWhyNotGrabbed(channelId, tmdbId);

  return (
    <>
      <Button size="sm" variant="outline" disabled={why.isPending} onClick={() => why.mutate()}>
        {why.isPending ? t("cat.radarr_checking") : t("cat.why.button")}
      </Button>
      <div aria-live="polite" className="basis-full empty:hidden">
        {why.data && <Answer answer={why.data} />}
      </div>
      {why.isError && (
        <p role="alert" className="basis-full text-destructive">
          {errorText(why.error)}
        </p>
      )}
    </>
  );
}
