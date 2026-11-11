// Connect a Chess.com or Lichess account: pick the site, type the name, we check it exists.
import { useId, useState, type FormEvent } from 'react';
import { copy } from '../copy';
import { checkAccount, setAccount, validUsername, type GameSource } from '../games/store';
import { Segmented } from './ui';

const SITES: readonly { value: GameSource; label: string }[] = [
  { value: 'chesscom', label: copy.importer.sites.chesscom },
  { value: 'lichess', label: copy.importer.sites.lichess },
];

type Problem = 'invalid' | 'not-found' | 'unreachable';

/**
 * Saves the account on success and calls onSaved. An unknown or unreachable
 * name is never saved silently: the user is told and can choose to keep it.
 */
export function AccountForm({
  onSaved,
  fixedSource,
  initial = '',
  submitLabel = copy.today.account.check,
}: {
  onSaved?: (source: GameSource, username: string) => void;
  /** Lock the form to one site (Settings shows one row per site). */
  fixedSource?: GameSource;
  initial?: string;
  submitLabel?: string;
}) {
  const [source, setSource] = useState<GameSource>(fixedSource ?? 'chesscom');
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const id = useId();
  const site = copy.importer.sites[source];

  const save = async (u: string) => {
    await setAccount(source, u);
    setProblem(null);
    onSaved?.(source, u);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const u = name.trim();
    if (!u || busy) return;
    if (!validUsername(source, u)) return setProblem('invalid');
    setBusy(true);
    try {
      const res = navigator.onLine === false ? 'unreachable' : await checkAccount(source, u);
      if (res === 'ok') await save(u);
      else setProblem(res === 'invalid' ? 'invalid' : res === 'not-found' ? 'not-found' : 'unreachable');
    } catch {
      setProblem('unreachable');
    } finally {
      setBusy(false);
    }
  };

  const message =
    problem === 'invalid' ? copy.today.account.invalid(site) : problem === 'not-found' ? copy.today.account.notFound(site) : problem === 'unreachable' ? copy.today.account.unreachable(site) : null;

  return (
    <form className="acct" onSubmit={submit} noValidate>
      {!fixedSource && (
        <Segmented
          label={copy.today.account.site}
          value={source}
          onChange={(v) => {
            setSource(v);
            setProblem(null);
          }}
          options={SITES}
        />
      )}
      <label htmlFor={id}>{copy.today.account.label(site)}</label>
      <div className="acct-row">
        <input
          id={id}
          type="text"
          value={name}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
          aria-invalid={problem === 'invalid' || problem === 'not-found' || undefined}
          aria-describedby={message ? `${id}-msg` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
          {busy && <span className="spinner" aria-hidden />}
          {busy ? copy.today.account.checking : submitLabel}
        </button>
      </div>
      {message && (
        <p id={`${id}-msg`} className="field-error" role="alert">
          {message}{' '}
          {problem !== 'invalid' && (
            <button type="button" className="linklike" onClick={() => void save(name.trim())}>
              {copy.today.account.useAnyway}
            </button>
          )}
        </p>
      )}
    </form>
  );
}
