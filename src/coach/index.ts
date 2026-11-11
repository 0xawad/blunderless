// The coach: a small rules engine that turns analysed games, puzzle attempts
// and drill reviews into a weakness profile, trends, a puzzle recommendation
// and today's plan. Pages import from here.
//
//   useCoach()      everything, for a page that shows several parts
//   usePlan()       Today: the plan, streak and counts
//   useProfile()    Progress: the profile, trends and counts
//   useMotifs()     Puzzles: performance per theme and the recommended theme
//
// Every action and plan step carries an in-app link. The ones with a query
// string need the target page to read it:
//
//   /puzzles?theme=<id>    a PUZZLE_THEMES id or 'mixed': open the themed trainer on that theme
//   /puzzles               the review queue of your own mistakes
//   /games/<id>?ply=<n>    open the review on position n, the one before 0-based move n (see exampleUrl)
//   /endgames?eg=<id>      open that endgame straight away
//   /drill?line=<lineId>   drill one line (already supported by the drill page)
//
// The rest are existing routes: /drill, /learn/<repId>/<index>, /openings,
// /openings/<repId>, /openings/<repId>/map?mode=spar, /games, /endgames, /play.
export * from './slim';
export * from './profile';
export * from './trends';
export * from './motifs';
export * from './plan';
export * from './data';
export * from './useCoach';
