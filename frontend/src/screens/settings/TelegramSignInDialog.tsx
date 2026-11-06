import { useState, type FormEvent } from "react";

import { useMutation } from "@tanstack/react-query";

import { StatusLine } from "@/components/StatusLine";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/use-i18n";
import { telegramPost, useRefreshTelegram } from "@/screens/settings/telegram-api";

type Step = "phone" | "code" | "password" | "done";
type InputStep = Exclude<Step, "done">;

type StepCopy = {
  labelKey: string;
  introKey: string;
  submitKey: string;
  pendingKey: string;
  type: "tel" | "text" | "password";
};

const STEPS: Record<InputStep, StepCopy> = {
  phone: {
    labelKey: "tgw.phone",
    introKey: "tgw.phone_intro",
    submitKey: "tgw.send_code",
    pendingKey: "tgw.sending_code",
    type: "tel",
  },
  code: {
    labelKey: "tgw.code",
    introKey: "tgw.code_intro",
    submitKey: "tgw.verify",
    pendingKey: "tgw.verifying",
    type: "text",
  },
  password: {
    labelKey: "tgw.password",
    introKey: "tgw.password_intro",
    submitKey: "tgw.continue",
    pendingKey: "tgw.signing_in",
    type: "password",
  },
};

async function nextStep(step: InputStep, value: string): Promise<Step> {
  switch (step) {
    case "phone":
      await telegramPost("/api/telegram/auth/send_code", { phone: value });
      return "code";
    case "code": {
      const result = await telegramPost<{ need_password?: boolean }>("/api/telegram/auth/sign_in", { code: value });
      return result.need_password ? "password" : "done";
    }
    case "password":
      await telegramPost("/api/telegram/auth/password", { password: value });
      return "done";
    default:
      return step satisfies never;
  }
}

type Props = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

/** Signs in by phone, code and two-step password once the API credentials are saved. */
export function TelegramSignInDialog({ isOpen, onOpenChange }: Props) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <SignInSteps onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function SignInSteps({ onClose }: { onClose: () => void }) {
  const { t, errorText } = useI18n();
  const refresh = useRefreshTelegram();
  const [step, setStep] = useState<Step>("phone");
  const [value, setValue] = useState("");

  const advance = useMutation({
    mutationFn: ({ from, input }: { from: InputStep; input: string }) => nextStep(from, input),
    onSuccess: async (next) => {
      if (next === "done") await refresh();
      setStep(next);
      setValue("");
    },
  });

  if (step === "done") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("tgw.done_title")}</DialogTitle>
          <DialogDescription>{t("tgw.done_body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t("tgw.done")}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const copy = STEPS[step];

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (step !== "done") advance.mutate({ from: step, input: value.trim() });
  }

  function handleOtherNumber() {
    advance.reset();
    setValue("");
    setStep("phone");
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{t("banner.connect_telegram")}</DialogTitle>
        <DialogDescription>{t(copy.introKey)}</DialogDescription>
      </DialogHeader>
      <TextField
        key={step}
        label={t(copy.labelKey)}
        type={copy.type}
        autoComplete="off"
        autoFocus
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {advance.isError && <StatusLine tone="error">{errorText(advance.error)}</StatusLine>}
      <DialogFooter>
        {step === "code" && (
          <Button type="button" variant="ghost" onClick={handleOtherNumber} disabled={advance.isPending}>
            {t("tgw.other_number")}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose} disabled={advance.isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={advance.isPending}>
          {t(advance.isPending ? copy.pendingKey : copy.submitKey)}
        </Button>
      </DialogFooter>
    </form>
  );
}
