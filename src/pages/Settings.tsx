import { useEffect, useRef, useState, type FormEvent } from 'react';
import { copy } from '../copy';
import { USERNAME_RE } from '../chesscom';
import { getSetting, setSetting } from '../srs/db';
import { exportBackup, importBackup, resetAll } from '../srs/backup';

export function Settings() {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string>();
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSetting<string>('username').then((u) => setName(u ?? ''));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const u = name.trim();
    if (u && !USERNAME_RE.test(u)) return setMsg(copy.welcome.invalid);
    await setSetting('username', u || undefined);
    setMsg(copy.settings.saved);
  };

  const doExport = async () => {
    const url = URL.createObjectURL(await exportBackup());
    const a = document.createElement('a');
    a.href = url;
    a.download = `blunderless-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      setMsg(copy.settings.importOk(await importBackup(await f.text())));
    } catch {
      setMsg(copy.settings.importBad);
    }
    if (file.current) file.current.value = '';
  };

  const doReset = async () => {
    if (window.prompt(copy.settings.resetConfirm) !== 'RESET') return;
    await resetAll();
    setMsg(copy.settings.resetDone);
  };

  return (
    <>
      <h1>{copy.settings.title}</h1>
      {msg && <div className="feedback info" role="status">{msg}</div>}

      <section className="card">
        <form onSubmit={save}>
          <label htmlFor="u">{copy.welcome.usernameLabel}</label>
          <div className="row">
            <input id="u" value={name} onChange={(e) => setName(e.target.value)} maxLength={25} spellCheck={false} />
            <button className="btn primary">Save</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="muted">{copy.settings.storageNote}</p>
        <div className="row">
          <button className="btn ghost" onClick={doExport}>{copy.settings.export}</button>
          <button className="btn ghost" onClick={() => file.current?.click()}>{copy.settings.import}</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => doImport(e.target.files?.[0])}
          />
          <button className="btn danger" onClick={doReset}>{copy.settings.reset}</button>
        </div>
      </section>
    </>
  );
}
