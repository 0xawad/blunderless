import { useEffect, useRef, useState, type FormEvent } from 'react';
import { copy } from '../copy';
import { USERNAME_RE } from '../chesscom';
import { getSetting, setSetting } from '../srs/db';
import { exportBackup, importBackup, resetAll } from '../srs/backup';
import { applyTheme, readTheme, type Theme } from '../theme';
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

  const [persisted, setPersisted] = useState<boolean | undefined>();
  useEffect(() => {
    isPersisted().then(setPersisted);
  }, []);
  const lastBackup = useLiveQuery(() => getSetting<string>('lastBackup'), []);

  const doExport = async () => {
    download(await exportBackup(), `blunderless-${new Date().toISOString().slice(0, 10)}.json`);
    await markBackedUp();
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
