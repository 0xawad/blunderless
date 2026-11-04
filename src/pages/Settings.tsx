import { useEffect, useRef, useState, type FormEvent } from 'react';
import { copy } from '../copy';
import { USERNAME_RE } from '../chesscom';
import { getSetting, setSetting } from '../srs/db';
import { exportBackup, importBackup, resetAll } from '../srs/backup';
import { applyTheme, readTheme, type Theme } from '../theme';
import { useToast } from '../components/Toast';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Settings() {
  const toast = useToast();
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSetting<string>('username').then((u) => setName(u ?? ''));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const u = name.trim();
    if (u && !USERNAME_RE.test(u)) return toast(copy.welcome.invalid, 'bad');
    await setSetting('username', u || undefined);
    toast(copy.settings.saved, 'good');
  };

  const pickTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };

  const doExport = async () => {
    const url = URL.createObjectURL(await exportBackup());
    const a = document.createElement('a');
    a.href = url;
    a.download = `blunderless-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      toast(copy.settings.importOk(await importBackup(await f.text())), 'good');
    } catch {
      toast(copy.settings.importBad, 'bad');
    }
    if (file.current) file.current.value = '';
  };

  const doReset = async () => {
    if (window.prompt(copy.settings.resetConfirm) !== 'RESET') return;
    await resetAll();
    toast(copy.settings.resetDone);
  };

  return (
    <>
      <h1>{copy.settings.title}</h1>

      <section className="card">
        <h2>Account</h2>
        <form onSubmit={save}>
          <label htmlFor="u">{copy.welcome.usernameLabel}</label>
          <div className="row">
            <input id="u" value={name} onChange={(e) => setName(e.target.value)} maxLength={25} spellCheck={false} autoComplete="off" />
            <button className="btn primary">Save</button>
          </div>
          <p className="hint">{copy.welcome.usernameHint}</p>
        </form>
      </section>

      <section className="card">
        <h2>Appearance</h2>
        <div className="setting-row">
          <div>
            <strong>Theme</strong>
            <div className="muted">{copy.settings.themeHint}</div>
          </div>
          <div className="segmented" style={{ margin: 0 }} role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.value} role="radio" aria-checked={theme === t.value} className={theme === t.value ? 'on' : ''} onClick={() => pickTheme(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="muted">{copy.settings.storageNote}</p>
        <div className="row">
          <button className="btn ghost" onClick={doExport}>{copy.settings.export}</button>
          <button className="btn ghost" onClick={() => file.current?.click()}>{copy.settings.import}</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
          <button className="btn danger" onClick={doReset}>{copy.settings.reset}</button>
        </div>
      </section>

      <section className="card">
        <h2>About</h2>
        <p className="muted small">{copy.settings.about}</p>
      </section>
    </>
  );
}
