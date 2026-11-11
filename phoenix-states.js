// Shared catalogue for Settings, the renderer and validated preview requests.
((root) => {
  const states = [
    ['idle','phoenixIdle','Idle','A quiet moment beside the island'],
    ['idle-blink','phoenixBlink','Blink','Occasional idle blinks'],
    ['idle-look-left','phoenixLookLeft','Look left','Looks toward the pointer on the left'],
    ['idle-look-right','phoenixLookRight','Look right','Looks toward the pointer on the right'],
    // the pointer anywhere around her: one switch for all of these (Settings shows one row)
    ['idle-look-half-left','phoenixLookAround','Follow the pointer','Looks up, down and to the sides as the pointer moves around the island',true],
    ['idle-look-half-right','phoenixLookAround','Follow the pointer','',true],
    ['idle-look-up','phoenixLookAround','Follow the pointer','',true],
    ['idle-look-down','phoenixLookAround','Follow the pointer','',true],
    ['idle-look-down-left','phoenixLookAround','Follow the pointer','',true],
    ['idle-look-down-right','phoenixLookAround','Follow the pointer','',true],
    ['welcome','phoenixWelcome','Welcome','Welcome back and the morning brief'],
    ['prayer','phoenixPrayer','Prayer','At the adhan'],
    ['focus','phoenixFocus','Focus','When a focus session starts'],
    ['focus-complete','phoenixFocusComplete','Focus complete','When a focus session finishes'],
    ['break','phoenixBreak','Break','Focus breaks and movement reminders'],
    ['water-reminder','phoenixWaterReminder','Water reminder','When it is time for a glass of water'],
    ['drinking','phoenixDrinking','Drinking','After you log a glass of water'],
    ['celebration','phoenixCelebration','Celebration','Completed sessions, water goals and other milestones'],
    ['resting','phoenixResting','Resting','While you are away and during eye-rest reminders'],
  ].map(([id,key,label,hint,gaze]) => ({id,key,label,hint,gaze:!!gaze,src:`assets/phoenix-v1/ui/${id}.png`}));
  // Zaher is one companion; seated or standing is only how he waits beside the island (his idle pose)
  // (older settings named the style zaher-seated / zaher-standing)
  states.effective = (f) => {
    const s = (f && f.companionStyle) || 'phoenix';
    if (s === 'zaher') return f.zaherIdle === 'standing' ? 'zaher-standing' : 'zaher-seated';
    return s;
  };
  states.isZaher = style => style === 'zaher-seated' || style === 'zaher-standing';
  states.usesArtwork = style => style === 'phoenix' || style === 'gazelle' || states.isZaher(style);
  // Zaher has no artwork for the extra gazes
  states.has = (id, style) => !(states.isZaher(style) && states.find((p) => p.id === id)?.gaze);
  states.sourceFor = (pose, style) => {
    if (style === 'gazelle') return `assets/gazelle-v1/ui/${pose.id}.png`;
    if (!states.isZaher(style)) return pose.src;
    const file = pose.id === 'idle' && style === 'zaher-standing' ? 'idle-standing' : pose.id;
    return `assets/zaher-v1/ui/${file}.png`;
  };
  if (typeof module === 'object' && module.exports) module.exports = states;
  else root.PhoenixStates = states;
})(globalThis);
