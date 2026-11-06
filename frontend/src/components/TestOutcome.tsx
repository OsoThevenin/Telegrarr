import type { UseMutationResult } from "@tanstack/react-query";

import { StatusLine } from "@/components/StatusLine";
import { useI18n } from "@/i18n/use-i18n";
import type { TestResult } from "@/lib/settings";

type Props = {
  test: UseMutationResult<TestResult, unknown, void>;
};

/** A test's result; a failure usually arrives inside a 200 with `ok: false`. */
export function TestOutcome({ test }: Props) {
  const { t, msg, errorText } = useI18n();

  if (test.isPending) return <StatusLine tone="neutral">{t("common.testing")}</StatusLine>;
  if (test.isError) return <StatusLine tone="error">{errorText(test.error)}</StatusLine>;
  if (!test.data) return null;

  return <StatusLine tone={test.data.ok ? "success" : "error"}>{msg(test.data.detail)}</StatusLine>;
}
