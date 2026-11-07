import 'react';

// chessground renders pieces as a custom <piece> element; we reuse it so the
// promotion picker and settings previews pick up the active piece set's CSS.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      piece: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
