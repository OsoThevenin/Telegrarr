import { useState, useSyncExternalStore, type FormEvent } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { SelectField } from "@/components/SelectField";
import { StatusLine } from "@/components/StatusLine";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { goToLogin } from "@/lib/browser";
import { SETTINGS_KEY } from "@/lib/settings";
import { chooseTheme, currentTheme, subscribeToTheme, THEMES, type Theme } from "@/lib/theme";

// The backend's auth.MIN_PASSWORD_LEN, for the hint; the server enforces it.
const MIN_PASSWORD_LENGTH = 12;

type OpenDialog = "username" | "password" | null;

export function AccountTab({ username }: { username: string }) {
  const { t } = useI18n();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const [changedTo, setChangedTo] = useState<string | null>(null);

  function closeDialog(isOpen: boolean) {
    if (!isOpen) setOpenDialog(null);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("set.account")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="font-mono text-sm break-all">{username}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpenDialog("username")}>
              {t("set.change_username")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpenDialog("password")}>
              {t("set.change_password")}
            </Button>
          </div>
          {changedTo !== null && (
            <StatusLine tone="success">{t("set.username_changed", { username: changedTo })}</StatusLine>
          )}
        </CardContent>
      </Card>
      <AppearanceCard />
      <Dialog open={openDialog === "username"} onOpenChange={closeDialog}>
        <DialogContent showCloseButton={false}>
          <UsernameForm
            onCancel={() => setOpenDialog(null)}
            onChanged={(next) => {
              setChangedTo(next);
              setOpenDialog(null);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={openDialog === "password"} onOpenChange={closeDialog}>
        <DialogContent showCloseButton={false}>
          <PasswordForm onCancel={() => setOpenDialog(null)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AppearanceCard() {
  const { t } = useI18n();
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme);
  const themeLabels: Record<Theme, string> = {
    auto: t("set.theme.auto"),
    light: t("set.theme.light"),
    dark: t("set.theme.dark"),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("set.appearance")}</CardTitle>
      </CardHeader>
      <CardContent>
        <SelectField
          label={t("shell.theme")}
          value={theme}
          onChange={(event) => chooseTheme(event.target.value as Theme)}
        >
          {THEMES.map((option) => (
            <option key={option} value={option}>
              {themeLabels[option]}
            </option>
          ))}
        </SelectField>
      </CardContent>
    </Card>
  );
}

type DialogButtonsProps = {
  isPending: boolean;
  onCancel: () => void;
};

function DialogButtons({ isPending, onCancel }: DialogButtonsProps) {
  const { t } = useI18n();

  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" disabled={isPending}>
        {isPending ? t("common.saving") : t("common.save")}
      </Button>
    </DialogFooter>
  );
}

type UsernameFormProps = {
  onCancel: () => void;
  onChanged: (username: string) => void;
};

function UsernameForm({ onCancel, onChanged }: UsernameFormProps) {
  const { t, errorText } = useI18n();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [current, setCurrent] = useState("");

  const change = useMutation({
    mutationFn: () => api.post<{ username: string }>("/api/account/username", { current, username }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      onChanged(result.username);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    change.mutate();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{t("set.change_username")}</DialogTitle>
        <DialogDescription>{t("set.username_hint")}</DialogDescription>
      </DialogHeader>
      <TextField
        label={t("set.new_username")}
        autoComplete="username"
        required
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <TextField
        label={t("set.confirm_password")}
        hint={t("set.confirm_password_hint")}
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      {change.isError && <StatusLine tone="error">{errorText(change.error)}</StatusLine>}
      <DialogButtons isPending={change.isPending} onCancel={onCancel} />
    </form>
  );
}

function PasswordForm({ onCancel }: { onCancel: () => void }) {
  const { t, errorText } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeated, setRepeated] = useState("");
  const [isMismatch, setIsMismatch] = useState(false);

  const change = useMutation({
    mutationFn: () => api.post("/api/account/password", { current, new: next }),
    // The change ends every session, this one included, so the next step is the login page.
    onSuccess: goToLogin,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // A typo here would lock the only account out.
    const doesMatch = next === repeated;
    setIsMismatch(!doesMatch);
    if (doesMatch) change.mutate();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{t("set.change_password")}</DialogTitle>
        <DialogDescription>{t("set.password_relogin")}</DialogDescription>
      </DialogHeader>
      <TextField
        label={t("set.current_password")}
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <TextField
        label={t("set.new_password")}
        hint={t("set.new_password_hint", { min: MIN_PASSWORD_LENGTH })}
        type="password"
        autoComplete="new-password"
        required
        value={next}
        onChange={(event) => setNext(event.target.value)}
      />
      <TextField
        label={t("set.repeat_password")}
        type="password"
        autoComplete="new-password"
        required
        value={repeated}
        onChange={(event) => setRepeated(event.target.value)}
      />
      {isMismatch && <StatusLine tone="error">{t("set.password_mismatch")}</StatusLine>}
      {change.isError && <StatusLine tone="error">{errorText(change.error)}</StatusLine>}
      <DialogButtons isPending={change.isPending} onCancel={onCancel} />
    </form>
  );
}
