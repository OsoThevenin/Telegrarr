import type { Download } from "@/lib/downloads";
import { DownloadRow } from "@/screens/downloads/DownloadRow";

type Props = {
  rows: readonly Download[];
  isDense: boolean;
};

export function DownloadList({ rows, isDense }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((download) => (
        <DownloadRow key={download.id} download={download} isDense={isDense} />
      ))}
    </ul>
  );
}
