import { usePrefs } from '../prefs';

const ROLE: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };

/**
 * A move in algebraic notation, with the piece letter drawn as a small icon
 * from your piece set ("figurine" notation) when that preference is on.
 */
export function San({ san, color }: { san: string; color: 'w' | 'b' }) {
  const { figurines } = usePrefs();
  if (!figurines) return <>{san}</>;
  const side = color === 'w' ? 'white' : 'black';
  const lead = ROLE[san[0]];
  const promo = /=([QRBN])/.exec(san);
  const body = (lead ? san.slice(1) : san).replace(/=[QRBN]/, '=');
  return (
    <span className="san">
      {lead && (
        <span className="fig cg-wrap" aria-hidden>
          <piece className={`${side} ${lead}`} />
        </span>
      )}
      {lead && <span className="sr-only">{san[0]}</span>}
      {body}
      {promo && (
        <>
          <span className="fig cg-wrap" aria-hidden>
            <piece className={`${side} ${ROLE[promo[1]]}`} />
          </span>
          <span className="sr-only">{promo[1]}</span>
        </>
      )}
    </span>
  );
}
