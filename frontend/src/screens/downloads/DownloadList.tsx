import type { Download } from "@/lib/downloads";
import { DownloadRow } from "@/screens/downloads/DownloadRow";
import type { DownloadSelection } from "@/screens/downloads/use-download-selection";

type Props = {
  rows: readonly Download[];
  isDense: boolean;
  selection: DownloadSelection;
};

export function DownloadList({ rows, isDense, selection }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((download) => (
        <DownloadRow key={download.id} download={download} isDense={isDense} selection={selection} />
      ))}
    </ul>
  );
}
