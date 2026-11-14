// Applies the saved theme and board look before first paint, so the page never
// flashes the wrong colours while the app bundle loads. A plain, render-blocking
// script in <head>: an inline one would need a CSP exception (script-src 'self').
// Mirrors src/theme.ts and src/prefs.ts, which take over once the app starts:
// change them together (src/prefs.test.ts checks the lists below).
(function () {
  var root = document.documentElement;

  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
      var color = theme === 'dark' ? '#141415' : '#f5f5f4';
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', color);
    }
  } catch (e) {
    /* storage blocked: follow the system */
  }

  var BOARDS = ['forest', 'walnut', 'slate', 'ocean', 'rose'];
  var PIECES = ['california', 'staunty', 'maestro', 'cardinal', 'chessnut', 'cburnett', 'merida', 'pirouetti', 'kiwen-suwi', 'firi'];
  var board = 'forest';
  var pieces = 'staunty';
  var scale = 1;
  try {
    var prefs = JSON.parse(localStorage.getItem('prefs') || '{}') || {};
    // Entries from before v2 are moved to the default board and pieces.
    if (prefs.v === 2) {
      if (BOARDS.indexOf(prefs.boardTheme) !== -1) board = prefs.boardTheme;
      if (PIECES.indexOf(prefs.pieces) !== -1) pieces = prefs.pieces;
    }
    if (typeof prefs.boardScale === 'number' && isFinite(prefs.boardScale)) scale = Math.min(1, Math.max(0.6, prefs.boardScale));
  } catch (e) {
    /* storage blocked or unreadable: defaults */
  }
  root.setAttribute('data-board', board);
  root.setAttribute('data-pieces', pieces);
  root.style.setProperty('--board-scale', String(scale));
})();
