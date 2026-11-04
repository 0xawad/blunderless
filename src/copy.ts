// Every user-facing joke lives here. Edit freely; nothing else depends on the wording.

export const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export const copy = {
  brand: 'blunderless',
  tagline: 'Fewer blunders. Better openings. Some light roasting.',

  welcome: {
    title: 'Welcome back, chess enjoyer.',
    body: "Your pieces missed you. Your opponents missed you more. Let's fix that.",
    usernameLabel: 'Your Chess.com username',
    usernameHint: "We'll use it to pull your games and find your favourite ways to lose. Optional, for now.",
    invalid: "That doesn't look like a Chess.com username. Letters, numbers, - and _ only.",
    notFound: "Chess.com has never heard of them. Typo? Saved it anyway.",
    cta: "Let's go",
    skip: 'Skip, I live dangerously',
  },

  home: {
    greetings: [
      'Back for more?',
      'Ready to hang fewer pieces today?',
      'The board missed you.',
      "Today's goal: don't hang the queen. Stretch goal: openings.",
      'Opening prep: 0. Vibes: 100. We can work with that.',
    ],
    dueSome: (n: number) => `${n} line${n === 1 ? '' : 's'} waiting for you. They won't drill themselves.`,
    dueNone: "Nothing due. Learn a new line, or go play a game and come back with fresh trauma.",
    drillCta: 'Drill now',
    learnCta: 'Learn new lines',
    puzzlesCta: 'Fix my blunders',
    playCta: 'Play Stockfish',
    noGames: "No games imported yet. Let's find every blunder you've been hiding from yourself.",
    lastGame: (opp: string, result: string) =>
      result === 'win'
        ? `Last game: beat ${opp}. Was it skill or did they blunder harder?`
        : result === 'loss'
          ? `Last game: lost to ${opp}. Let's see where it went wrong.`
          : `Last game: drew with ${opp}. Thrilling.`,
  },

  drill: {
    title: 'Drill',
    yourMove: 'Your move.',
    theirMove: 'Opponent is thinking... (not really, they read the PGN)',
    correct: ['Yep.', 'Correct.', 'Book move. Look at you.', 'Clean.', 'Theory enjoyer.', 'Mhm.'],
    wrong: [
      'Bold. Wrong, but bold.',
      "That's a move. Not the move.",
      'Creative. Your coach just fainted.',
      'Nope. Try again.',
      'The engine is laughing. Quietly. Politely.',
    ],
    revealed: 'Here, have the answer. No shame. Okay, a little shame.',
    perfect: ['Flawless. Who even are you?', 'Zero mistakes. Frame it.', 'Perfect. Not bad for a "750".'],
    shaky: ['Got there. Shaky, but got there.', 'One wobble. Fine. We move.'],
    failed: [
      "That line owns you right now. It'll be back soon.",
      "Rough one. You'll see it again before you forget it.",
    ],
    emptyTitle: 'Nothing due.',
    emptyBody: 'Your memory is either great, or you have nothing in the queue yet.',
    practice: 'Practice some anyway',
    next: 'Next line',
    sessionDone: (n: number, perfect: number) =>
      `${n} line${n === 1 ? '' : 's'} done, ${perfect} perfect. ${
        perfect === n ? 'Suspiciously good.' : perfect === 0 ? 'Character building.' : 'Progress.'
      }`,
    hint: 'Hint',
  },

  learn: {
    addToDrill: 'Add to my drill queue',
    added: "In the queue. You'll see it again before you forget it.",
    drillNow: 'Drill it now',
    playOut: 'Play it out vs Stockfish',
    noComment: "No commentary on this one. Just vibes and good moves.",
    endOfLine: "End of the line. Literally. Now let's see if it stuck.",
    keys: 'Tip: use ← and → to step through moves.',
  },

  status: {
    new: 'New',
    learning: 'Learning',
    due: 'Due',
    known: 'Known',
  },

  settings: {
    title: 'Settings',
    saved: 'Saved.',
    export: 'Export progress',
    import: 'Import progress',
    importOk: (n: number) => `Imported ${n} lines and their puzzles. Games re-import from Chess.com.`,
    importBad: "That file isn't a blunderless backup. Nice try.",
    reset: 'Reset all progress',
    resetConfirm: 'This deletes every card and review on this device. Type RESET to confirm.',
    resetDone: 'Fresh start. Like your first game, minus the scholar\'s mate.',
    storageNote: 'Everything lives in this browser only. No accounts, no servers. Export a backup now and then.',
  },

  games: {
    title: 'Your games',
    lead: 'Pulled from Chess.com. Stockfish reads every move so you have to face what really happened.',
    noUser: 'Set your Chess.com username in Settings first. We need to know whose crimes to investigate.',
    import: 'Import last 3 months',
    importing: 'Fetching your games... bravely.',
    imported: (n: number, requeued: number) =>
      n === 0
        ? 'Nothing new. Go play a game.'
        : `${n} new game${n === 1 ? '' : 's'}.${requeued ? ` ${requeued} repertoire line${requeued === 1 ? '' : 's'} you fumbled are back in your drill queue.` : ''}`,
    importFailed: "Chess.com didn't answer. Try again in a bit.",
    empty: 'No games yet. Import some, or play one in Play mode.',
    analyze: 'Analyze',
    analyzeAll: (n: number) => `Analyze ${n} game${n === 1 ? '' : 's'}`,
    analyzing: (pct: number) => `Stockfish is judging you... ${pct}%`,
    madePuzzles: (n: number) =>
      n === 0 ? 'No serious mistakes. Who are you and what have you done with the 750?' : `${n} new puzzle${n === 1 ? '' : 's'} from your own mistakes. Personalised pain.`,
  },

  book: {
    'you-deviated': (move: number, played: string, expected: string) =>
      `You left your prep on move ${move}: ${played} instead of ${expected}.`,
    'they-deviated': (move: number, played: string) =>
      `Your opponent went off-book on move ${move} with ${played}. Not your fault. This time.`,
    'end-of-prep': (move: number) =>
      move <= 1 ? 'No repertoire for this one.' : `You stayed in book until move ${move}. Chef's kiss.`,
    short: {
      'you-deviated': (move: number) => `You left book · move ${move}`,
      'they-deviated': (move: number) => `They left book · move ${move}`,
      'end-of-prep': (move: number) => (move <= 1 ? 'No prep' : `Full prep · move ${move}`),
    },
  },

  kinds: {
    'hung-piece': { label: 'Hung a piece', roast: 'That piece had a family.' },
    'allowed-mate': { label: 'Allowed mate', roast: 'You walked your king straight into it.' },
    'missed-mate': { label: 'Missed mate', roast: 'Checkmate was RIGHT THERE.' },
    fork: { label: 'Walked into a fork', roast: 'Two pieces attacked at once. Classic.' },
    'missed-tactic': { label: 'Missed a tactic', roast: 'There was something better. Much better.' },
    'walked-into-tactic': { label: 'Walked into a tactic', roast: 'Your opponent had a trick and you let it happen.' },
  } as Record<string, { label: string; roast: string }>,

  puzzles: {
    title: 'Puzzles',
    lead: "Your own blunders come first. They're the ones that actually cost you games.",
    mine: 'My blunders',
    themes: 'Themes',
    mineDue: (n: number) => `${n} of your own blunders to fix`,
    mineNone: 'No blunder puzzles due. Analyze some games, or enjoy the peace.',
    findMove: (color: string) => `${color} to move. Find the best move.`,
    yourBlunder: 'In your game, you played something worse here. Find what Stockfish wanted.',
    solved: ['Solved!', 'Nailed it.', "That's the one.", 'Tactical genius (at least this once).'],
    failed: ['Nope. Here is the answer.', 'Not quite. Watch this.'],
    next: 'Next puzzle',
    retry: 'Next',
    themeNames: {
      hangingPiece: 'Free pieces',
      fork: 'Forks',
      pin: 'Pins',
      skewer: 'Skewers',
      discoveredAttack: 'Discovered attacks',
      mateIn1: 'Mate in 1',
      mateIn2: 'Mate in 2',
      backRankMate: 'Back-rank mates',
      trappedPiece: 'Trapped pieces',
      defensiveMove: 'Defensive moves',
    } as Record<string, string>,
    rating: (r: number) => `Puzzle rating ${r}`,
  },

  play: {
    title: 'Play',
    lead: 'Play Stockfish with training wheels. Guard rails warn you before you hang something.',
    level: 'Opponent',
    levels: ['Potato', 'Coffee-house', 'Club player', 'Grumpy uncle', 'Sweaty'],
    color: 'You play',
    guard: 'Guard rails',
    guardHint: 'Warns you before you hang a piece or allow mate in one.',
    cct: 'Checks / Captures / Threats',
    cctHint: 'Tick all three before each move. Annoying, and it works.',
    cctChips: ['Checks?', 'Captures?', 'Threats?'],
    start: 'Start game',
    thinking: ['Hmm...', 'Calculating your doom...', 'Thinking (barely)...'],
    yourTurn: 'Your move.',
    warnTitle: 'Hold on.',
    warn: {
      mate: 'That allows mate in one. Your king would like a word.',
      hanging: (piece: string) => `Your ${piece} would be hanging. That ${piece} has a family.`,
      'cheap-capture': (piece: string, by: string) => `A ${by} can take your ${piece}. That's a bad trade.`,
    },
    takeBack: 'Take it back',
    playAnyway: 'Play it anyway',
    saves: (n: number) => `${n} blunder${n === 1 ? '' : 's'} caught`,
    resign: 'Resign',
    newGame: 'New game',
    review: 'Review this game',
    over: {
      win: ['You won! Stockfish demands a rematch.', 'Victory. Screenshot it.'],
      loss: ['Lost. Review it, learn, return.', 'The machine wins this round.'],
      draw: ['Draw. Peace was an option after all.'],
    },
    fromLine: "Starting from the end of your repertoire line. Let's see if you know what to do next.",
  },

  stats: {
    title: 'Stats',
    lead: 'The honest mirror. No filters.',
    linesKnown: 'Lines known',
    streak: 'Drill streak',
    days: (n: number) => `${n} day${n === 1 ? '' : 's'}`,
    puzzleRate: 'Puzzle accuracy',
    blundersPerGame: 'Blunders per game',
    accuracy: 'Avg accuracy',
    blunderChart: 'Blunders per analyzed game',
    kindsChart: 'What you keep doing wrong',
    mastery: 'Opening mastery',
    none: 'Not enough data yet. Analyze a few games and this page gets brutally honest.',
    verdict: (top: string) => `Your #1 problem: ${top}. Go do some puzzles about it.`,
  },

  notFound: 'This square is empty. Like your opening prep used to be.',
} as const;
