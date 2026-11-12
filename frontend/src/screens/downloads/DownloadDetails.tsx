import { Fragment } from "react";

import type { Download } from "@/lib/downloads";
import { cn } from "@/lib/utils";
import { useDownloadDetails } from "@/screens/downloads/use-download-details";

type Props = {
  download: Download;
  className?: string;
};

/** The details line: it may wrap between phrases, never inside one ("falten 5 min 16 s" stays whole). */
export function DownloadDetails({ download, className }: Props) {
  const segments = useDownloadDetails(download);

  return (
    <p className={cn("text-sm text-muted-foreground tabular-nums", className)}>
      {segments.map(({ text, title }, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          <span className="whitespace-nowrap" title={title}>
            {text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
