import { useEffect, useRef, useState, type FormEvent } from 'react';
import { copy } from '../copy';
import { USERNAME_RE } from '../chesscom';
import { getSetting, setSetting } from '../srs/db';
import { exportBackup, importBackup, resetAll } from '../srs/backup';
import { applyTheme, readTheme, type Theme } from '../theme';
import { useToast } from '../components/Toast';
import { BOARD_THEMES, setPrefs, usePrefs } from '../prefs';
import { play, unlockAudio } from '../sound';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Settings() {
  const toast = useToast();
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const prefs = usePrefs();
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
        <div className="setting-row">
          <div>
            <strong>{copy.settings.board}</strong>
            <div className="muted">{copy.settings.boardHint}</div>
          </div>
          <div className="board-themes" role="radiogroup" aria-label="Board colours">
            {BOARD_THEMES.map((b) => (
              <button
                key={b.id}
                role="radio"
                aria-checked={prefs.boardTheme === b.id}
                className={`board-theme ${prefs.boardTheme === b.id ? 'on' : ''}`}
                onClick={() => setPrefs({ boardTheme: b.id })}
              >
                <span
                  className="swatch"
                  style={{ backgroundImage: `conic-gradient(${b.light} 25%, ${b.dark} 0 50%, ${b.light} 0 75%, ${b.dark} 0)` }}
                />
                <span>{b.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>{copy.settings.animation}</strong>
            <div className="muted">{copy.settings.animationHint}</div>
          </div>
          <div className="segmented" style={{ margin: 0 }} role="radiogroup" aria-label="Piece animation">
            {(['off', 'normal', 'slow'] as const).map((a) => (
              <button key={a} role="radio" aria-checked={prefs.animation === a} className={prefs.animation === a ? 'on' : ''} onClick={() => setPrefs({ animation: a })}>
                {copy.settings.animations[a]}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>{copy.settings.sound}</strong>
            <div className="muted">{copy.settings.soundHint}</div>
          </div>
          <div className="segmented" style={{ margin: 0 }} role="radiogroup" aria-label="Sound">
            <button role="radio" aria-checked={prefs.sound} className={prefs.sound ? 'on' : ''} onClick={() => { setPrefs({ sound: true }); unlockAudio(); play('move'); }}>On</button>
            <button role="radio" aria-checked={!prefs.sound} className={!prefs.sound ? 'on' : ''} onClick={() => setPrefs({ sound: false })}>Off</button>
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
