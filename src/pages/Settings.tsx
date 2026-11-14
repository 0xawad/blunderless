import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { getSetting } from '../srs/db';
import { getAccounts, setAccount, type GameSource } from '../games/store';
import { AccountForm } from '../components/AccountForm';
import { Callout, Switch } from '../components/ui';
import '../styles/pages/settings.css';
import { currentCounts, exportBackup, importBackup, resetAll } from '../srs/backup';
import { setTheme, useTheme, type Theme } from '../theme';
import { useToast } from '../components/Toast';
import { BOARD_THEMES, PIECE_SETS, setPrefs, usePrefs, type Prefs } from '../prefs';
import { Chess } from 'chess.js';
import { Board } from '../chess/Board';
import { playUci } from '../chess/game';
import { play, unlockAudio } from '../sound';
import { download, isPersisted, markBackedUp, protectStorage } from '../storage';
import { useLiveQuery } from 'dexie-react-hooks';

// A position with a capture, a check and a last move, so every board setting shows.
const PREVIEW_FEN = 'r1bqk2r/pppp1Bpp/2n2n2/2b1p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4';

/** A board you can play on (both sides), resetting after a few moves. */
function PreviewBoard() {
  const [game, setGame] = useState(() => ({ chess: new Chess(PREVIEW_FEN), last: ['c4', 'f7'] as [string, string], n: 0 }));
  const onMove = (from: string, to: string, promotion?: string) => {
    const c = new Chess(game.chess.fen());
    const m = playUci(c, from + to + (promotion ?? ''));
    if (!m) return;
    const reset = game.n >= 7 || c.isGameOver();
    setGame({ chess: reset ? new Chess(PREVIEW_FEN) : c, last: reset ? ['c4', 'f7'] : [m.from, m.to], n: reset ? 0 : game.n + 1 });
  };
  return <Board fen={game.chess.fen()} orientation="white" lastMove={game.last} interactive onMove={onMove} />;
}

type BoolPref = 'coordinates' | 'showDests' | 'highlightLast' | 'autoQueen' | 'figurines';
function Toggle({ k, prefs }: { k: BoolPref; prefs: Prefs }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{copy.settings.toggles[k][0]}</strong>
        <div className="muted">{copy.settings.toggles[k][1]}</div>
      </div>
      <div className="segmented" style={{ margin: 0 }} role="radiogroup" aria-label={copy.settings.toggles[k][0]}>
        <button role="radio" aria-checked={prefs[k]} className={prefs[k] ? 'on' : ''} onClick={() => setPrefs({ [k]: true })}>On</button>
        <button role="radio" aria-checked={!prefs[k]} className={!prefs[k] ? 'on' : ''} onClick={() => setPrefs({ [k]: false })}>Off</button>
      </div>
    </div>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Settings() {
  const toast = useToast();
  const { theme } = useTheme();
  const accounts = useLiveQuery(getAccounts, []);
  const [editing, setEditing] = useState<GameSource | null>(null);
  const [restore, setRestore] = useState<{ text: string; name: string; counts: Awaited<ReturnType<typeof currentCounts>> } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetText, setResetText] = useState('');
  const prefs = usePrefs();
  const file = useRef<HTMLInputElement>(null);

  const pickTheme = (t: Theme) => setTheme(t);

  const [persisted, setPersisted] = useState<boolean | undefined>();
  useEffect(() => {
    isPersisted().then(setPersisted);
  }, []);
  const lastBackup = useLiveQuery(() => getSetting<string>('lastBackup'), []);

  const doExport = async () => {
    download(await exportBackup(), `blunderless-${new Date().toISOString().slice(0, 10)}.json`);
    await markBackedUp();
  };

  // Choosing a file only stages it: nothing is replaced until the user confirms.
  const pickFile = async (f: File | undefined) => {
    if (file.current) file.current.value = '';
    if (!f) return;
    try {
      setRestore({ text: await f.text(), name: f.name, counts: await currentCounts() });
    } catch {
      toast(copy.settings.importBad, 'bad');
    }
  };

  const doRestore = async () => {
    if (!restore) return;
    try {
      toast(copy.settings.importOk(await importBackup(restore.text)), 'good');
    } catch (e) {
      toast(e instanceof SyntaxError ? copy.settings.importBad : copy.settings.importFailed(e instanceof Error ? e.message : ''), 'bad');
    }
    setRestore(null);
  };

  const doReset = async () => {
    if (resetText.trim().toUpperCase() !== 'RESET') return;
    await resetAll();
    setResetting(false);
    setResetText('');
    toast(copy.settings.resetDone);
  };

  return (
    <div className="st">
      <h1>{copy.settings.title}</h1>

      <section className="card">
        <h2>{copy.settings.accounts}</h2>
        <p className="muted small">{copy.settings.accountsHint}</p>
        {(['chesscom', 'lichess'] as GameSource[]).map((src) => {
          const site = copy.importer.sites[src];
          const name = accounts?.[src];
          return (
            <div className="setting-row" key={src}>
              {editing === src ? (
                <AccountForm
                  fixedSource={src}
                  initial={name ?? ''}
                  submitLabel={copy.today.account.save}
                  onSaved={() => {
                    setEditing(null);
                    toast(copy.settings.saved, 'good');
                  }}
                />
              ) : (
                <>
                  <div>
                    <strong>{site}</strong>
                    <div className="muted">{name ?? copy.today.account.none}</div>
                  </div>
                  <div className="cluster">
                    <button className="btn ghost small" onClick={() => setEditing(src)}>{name ? copy.settings.change : copy.today.account.check}</button>
                    {name && <button className="btn quiet small" onClick={() => void setAccount(src, undefined)}>{copy.today.account.remove}</button>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>

      <section className="card board-settings">
        <h2>{copy.settings.boardTitle}</h2>
        <div className="board-settings-grid">
          <div className="board-preview">
            <PreviewBoard />
            <p className="hint">{copy.settings.previewHint}</p>
          </div>
          <div>
            {(['coordinates', 'showDests', 'highlightLast', 'figurines', 'autoQueen'] as BoolPref[]).map((k) => (
              <Toggle key={k} k={k} prefs={prefs} />
            ))}
            <div className="setting-row">
              <div>
                <strong>{copy.settings.boardSize}</strong>
                <div className="muted">{copy.settings.boardSizeHint}</div>
              </div>
              <input
                type="range"
                min={60}
                max={100}
                step={5}
                value={Math.round(prefs.boardScale * 100)}
                onChange={(e) => setPrefs({ boardScale: Number(e.target.value) / 100 })}
                aria-label={copy.settings.boardSize}
              />
              <span className="mono small range-value">{Math.round(prefs.boardScale * 100)}%</span>
            </div>
          </div>
        </div>
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
            <strong>{copy.settings.pieces}</strong>
            <div className="muted">{copy.settings.piecesHint}</div>
          </div>
          <div className="piece-sets" role="radiogroup" aria-label="Piece set">
            {PIECE_SETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={prefs.pieces === p.id}
                className={`piece-set ${prefs.pieces === p.id ? 'on' : ''}`}
                onClick={() => setPrefs({ pieces: p.id })}
              >
                <span className="swatch cg-wrap" data-set={p.id}>
                  <piece className="white knight" style={p.id === 'cburnett' ? undefined : { backgroundImage: `url(/pieces/${p.id}/wN.svg)` }} />
                </span>
                <span>{p.label}</span>
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
        <div className="setting-row">
          <div>
            <strong>{copy.settings.volume}</strong>
            <div className="muted">{copy.settings.volumeHint}</div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(prefs.volume * 100)}
            disabled={!prefs.sound}
            aria-label={copy.settings.volume}
            onChange={(e) => setPrefs({ volume: Number(e.target.value) / 100 })}
            onPointerUp={() => play('move')}
            onKeyUp={() => play('move')}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>{copy.settings.haptics}</strong>
            <div className="muted">{copy.settings.hapticsHint}</div>
          </div>
          <Switch checked={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} label={copy.settings.haptics} />
        </div>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="muted">{copy.settings.storageNote}</p>
        <p className={`small ${persisted ? 'good-text' : 'warn-text'}`}>
          {persisted === undefined ? copy.settings.persistUnknown : persisted ? copy.settings.persistOn : copy.settings.persistOff}
          {persisted === false && (
            <>
              {' '}
              <button className="linklike" onClick={() => protectStorage().then(setPersisted)}>{copy.settings.persistAsk}</button>
            </>
          )}
        </p>
        <p className="muted small">{lastBackup ? copy.settings.lastBackup(new Date(lastBackup).toLocaleDateString()) : copy.settings.neverBackedUp}</p>
        <div className="row">
          <button className="btn ghost" onClick={doExport}>{copy.settings.export}</button>
          <button className="btn ghost" onClick={() => file.current?.click()}>{copy.settings.import}</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
          <button className="btn danger" onClick={() => setResetting(true)}>{copy.settings.reset}</button>
        </div>
      </section>

      {restore && (
        <Callout
          tone="warn"
          role="alert"
          actions={
            <>
              <button className="btn small ghost" onClick={doExport}>{copy.settings.backupFirst}</button>
              <button className="btn small danger-solid" onClick={doRestore}>{copy.settings.restoreNow}</button>
              <button className="btn small quiet" onClick={() => setRestore(null)}>{copy.settings.cancel}</button>
            </>
          }
        >
          <strong>{copy.settings.restoreTitle(restore.name)}</strong> {copy.settings.restoreBody(restore.counts.cards, restore.counts.puzzles, restore.counts.games)}
        </Callout>
      )}
      {resetting && (
        <Callout
          tone="bad"
          role="alert"
          actions={
            <>
              <input type="text" className="st-reset-input" value={resetText} onChange={(e) => setResetText(e.target.value)} aria-label={copy.settings.resetType} placeholder="RESET" autoFocus />
              <button className="btn small danger-solid" disabled={resetText.trim().toUpperCase() !== 'RESET'} onClick={doReset}>{copy.settings.reset}</button>
              <button className="btn small quiet" onClick={() => { setResetting(false); setResetText(''); }}>{copy.settings.cancel}</button>
            </>
          }
        >
          {copy.settings.resetConfirm}
        </Callout>
      )}

      <section className="card">
        <h2>About</h2>
        <p className="muted small">{copy.settings.about}</p>
      </section>
    </div>
  );
}
