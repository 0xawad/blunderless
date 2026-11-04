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
    gamesSoon: 'Game import is coming soon. Then we find every blunder you hid from yourself.',
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
    importOk: (n: number) => `Imported ${n} lines. Welcome back, past you.`,
    importBad: "That file isn't a blunderless backup. Nice try.",
    reset: 'Reset all progress',
    resetConfirm: 'This deletes every card and review on this device. Type RESET to confirm.',
    resetDone: 'Fresh start. Like your first game, minus the scholar\'s mate.',
    storageNote: 'Everything lives in this browser only. No accounts, no servers. Export a backup now and then.',
  },

  notFound: 'This square is empty. Like your opening prep used to be.',
} as const;
