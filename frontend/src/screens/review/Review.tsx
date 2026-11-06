import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n } from "@/i18n/use-i18n";

import { InlineAlert } from "./InlineAlert";
import { Queue } from "./Queue";
import { fetchPending, PENDING_KEY } from "./review-api";

export function Review() {
  const { t, errorText } = useI18n();
  const pending = useQuery({ queryKey: PENDING_KEY, queryFn: fetchPending });
  const [notice, setNotice] = useState("");
  const releases = pending.data;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      {/* Always mounted, or a screen reader would not announce what lands in it. */}
      <p role="status" className="text-sm font-medium empty:hidden">
        {notice}
      </p>
      {pending.isError && (
        <InlineAlert actionLabel={t("common.refresh")} onAction={() => void pending.refetch()}>
          {errorText(pending.error)}
        </InlineAlert>
      )}
      {pending.isPending && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {releases?.length === 0 && (
        <div className="py-12 text-center">
          <p className="font-medium">{t("review.empty_title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("review.empty_body")}</p>
        </div>
      )}
      {releases && releases.length > 0 && <Queue releases={releases} onNotice={setNotice} />}
    </div>
  );
}
