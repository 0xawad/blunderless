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
    drillSub: (n: number) => `${n} line${n === 1 ? '' : 's'} due`,
    drillClear: 'All caught up. Suspicious.',
    drillNone: 'Learn a line first, then drill it here.',
    puzzlesCta: 'Fix my blunders',
    puzzlesSub: (n: number) => `${n} of your own to revisit`,
    puzzlesNone: 'Themed tactics, or your own mistakes after a review.',
    learnSub: (n: number) => (n ? `${n} lines started` : 'Four openings, plans included.'),
    playCta: 'Play Stockfish',
    playSub: 'With guard rails, if you want them.',
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
    keys: '← → to step',
    think: 'Think first',
    thinkHint: 'Guess each of your moves before it is shown. Learning sticks better that way.',
    yourMove: 'Your move. What does the plan say?',
    showMe: 'Show me',
    right: ['Yes.', 'That is the move.', 'Exactly.', 'Book.'],
    wrong: ['Not that one. Think about what the last comment told you.', 'Nope. One more try.'],
    reveal: (san: string) => `It was ${san}. Play it on the board and keep going.`,
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
    themeHint: 'System follows your OS. The header button flips it too.',
    board: 'Board colours',
    boardHint: 'Pick the one your eyes like. The pieces stay the same.',
    animation: 'Piece animation',
    animationHint: 'How pieces glide between squares.',
    animations: { off: 'Off', normal: 'Normal', slow: 'Slow' } as Record<string, string>,
    sound: 'Sounds',
    soundHint: 'Clicks, captures, checks and little fanfares. Synthesized, so nothing to download.',
    about:
      'blunderless is open source (GPL-3). Engine: Stockfish 19. Board: chessground. Puzzles: the Lichess puzzle database (CC0). Spaced repetition: FSRS.',
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
    badPgn: "Chess.com sent a PGN we can't read. The game is here, but there's nothing to replay.",
    filters: { all: 'All', win: 'Wins', loss: 'Losses', draw: 'Draws', pending: 'Not analyzed' } as Record<string, string>,
    record: (w: number, l: number, d: number) => `${w}W · ${l}L · ${d}D`,
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

  rep: {
    startLearning: 'Start learning',
    continueLearning: 'Learn next line',
    yourGames: 'Your games in this opening',
    noGames: 'No imported games reached this opening yet. Play some, import them, and this fills in.',
    leftFirst: (n: number, total: number) =>
      n === 0 ? 'You never left book first. Your opponents did. Nice.' : `You were the one who left book first in ${n} of ${total}. Drill, drill, drill.`,
    weakSpots: 'Moves you keep forgetting',
    noSpots: "Nothing yet. Drill a few lines and your personal blind spots show up here.",
  },

  today: {
    title: "Today's plan",
    lead: 'Fifteen minutes. Every day beats every so often.',
    drill: (n: number) => (n ? `Drill ${n} due line${n === 1 ? '' : 's'}` : 'Drill: nothing due'),
    puzzles: (n: number) => (n ? `Fix ${n} of your own blunders` : 'Solve 10 themed puzzles'),
    review: 'Review your last unreviewed game',
    reviewDone: 'Latest game reviewed',
    reviewNone: 'Import games to review',
    endgame: 'One endgame drill',
    streak: (n: number) => (n ? `${n}-day streak` : 'Start a streak'),
    allDone: 'All done. Go play a game and bring back fresh material.',
  },

  review: {
    tabs: { summary: 'Summary', moves: 'Moves', engine: 'Engine' },
    accuracy: 'Accuracy',
    you: 'You',
    opp: 'Opponent',
    phases: { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' },
    keyMoments: 'Key moments',
    decided: (move: number) => `The game was decided around move ${move}.`,
    noMoments: 'No big swings. A quiet, well-behaved game.',
    lessons: 'What to work on',
    lessonNone: 'Nothing glaring. Keep doing whatever that was.',
    retry: 'Find the better move',
    retrying: 'Your move. Think checks, captures, threats.',
    retryBest: ['Yes! That was the move.', "That's it. Engine-approved."],
    retryGood: 'Not the engine move, but it holds. Fine by us.',
    retryBad: (best: string) => `Still a mistake. The move was ${best}.`,
    retryCancel: 'Back to the game',
    explore: 'Explore',
    exploreHint: 'Move pieces to try your own ideas. The engine keeps up.',
    backToGame: 'Back to game',
    variation: 'Variation',
    engineWaiting: 'Thinking...',
    reanalyze: 'Re-analyze with the new review',
    oldAnalysis: 'This review is from an older version. Re-analyze to get phases, key moments and explanations.',
    classes: {
      book: 'Book',
      best: 'Best',
      good: 'Good',
      inaccuracy: 'Inaccuracy',
      mistake: 'Mistake',
      blunder: 'Blunder',
      'missed-win': 'Missed win',
    } as Record<string, string>,
    opening: 'Opening',
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
    coach: 'Coach',
    coachHint: 'Grades each of your moves right after you play it. Learn while it still stings.',
    coachOn: 'coach on',
    guardOn: 'guard rails on',
    guardOff: 'no guard rails',
    youPlay: (c: string) => `You play ${c === 'white' ? 'White ♔' : 'Black ♚'}`,
    hint: 'Hint',
    hintShown: (level: number) => (level === 1 ? 'The piece to move is marked. Where does it go?' : 'There is the move. Play it.'),
    hintsUsed: (n: number) => `${n} hint${n === 1 ? '' : 's'}`,
    undo: 'Undo',
    verdicts: { best: 'Best move', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' } as Record<string, string>,
    betterWas: (san: string) => `better was ${san}`,
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

  crash: {
    title: 'Well. That was a blunder.',
    body: "Something in this page broke. Your data is fine; it's all still in this browser.",
    retry: 'Try again',
  },

  engine: {
    failed: "Stockfish didn't answer. Reload the page and try again.",
  },

  notFound: 'This square is empty. Like your opening prep used to be.',
} as const;
