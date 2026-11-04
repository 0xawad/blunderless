import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { copy } from '../copy';
import { setSetting } from '../srs/db';
import { USERNAME_RE, chessComPlayerExists } from '../chesscom';

export function Welcome() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  const finish = async (username?: string) => {
    if (username) await setSetting('username', username);
    await setSetting('onboarded', true);
    navigate('/', { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const u = name.trim();
    if (!u) return finish();
    if (!USERNAME_RE.test(u)) return setNote(copy.welcome.invalid);
    setBusy(true);
    const exists = await chessComPlayerExists(u);
    setBusy(false);
    if (exists === false) {
      setNote(copy.welcome.notFound);
      setTimeout(() => finish(u), 1400);
      return;
    }
    finish(u);
  };

  return (
    <section className="card welcome">
      <div className="welcome-piece" aria-hidden>♞</div>
      <h1>{copy.welcome.title}</h1>
      <p className="lead">{copy.welcome.body}</p>
      <form onSubmit={submit}>
        <label htmlFor="u">{copy.welcome.usernameLabel}</label>
        <input
          id="u"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNote(undefined);
          }}
          autoComplete="off"
          spellCheck={false}
          maxLength={25}
          placeholder="e.g. hikaru (we wish)"
        />
        <p className="hint">{note ?? copy.welcome.usernameHint}</p>
        <div className="row">
          <button className="btn primary lg" disabled={busy}>{copy.welcome.cta}</button>
          <button type="button" className="btn ghost" onClick={() => finish()}>{copy.welcome.skip}</button>
        </div>
      </form>
    </section>
  );
}
