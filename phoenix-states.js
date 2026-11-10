// Shared catalogue for Settings, the renderer and validated preview requests.
((root) => {
  const states = [
    ['idle','phoenixIdle','Idle','A quiet moment beside the island'],
    ['idle-blink','phoenixBlink','Blink','Occasional idle blinks'],
    ['idle-look-left','phoenixLookLeft','Look left','Looks toward the pointer on the left'],
    ['idle-look-right','phoenixLookRight','Look right','Looks toward the pointer on the right'],
    ['welcome','phoenixWelcome','Welcome','Welcome back and the morning brief'],
    ['prayer','phoenixPrayer','Prayer','At the adhan'],
    ['focus','phoenixFocus','Focus','When a focus session starts'],
    ['focus-complete','phoenixFocusComplete','Focus complete','When a focus session finishes'],
    ['break','phoenixBreak','Break','Focus breaks and movement reminders'],
    ['water-reminder','phoenixWaterReminder','Water reminder','When it is time for a glass of water'],
    ['drinking','phoenixDrinking','Drinking','After you log a glass of water'],
    ['celebration','phoenixCelebration','Celebration','Completed sessions, water goals and other milestones'],
    ['resting','phoenixResting','Resting','While you are away and during eye-rest reminders'],
  ].map(([id,key,label,hint]) => ({id,key,label,hint,src:`assets/phoenix-v1/ui/${id}.png`}));
  states.isZaher = style => style === 'zaher-seated' || style === 'zaher-standing';
  states.usesArtwork = style => style === 'phoenix' || states.isZaher(style);
  states.sourceFor = (pose, style) => {
    if (!states.isZaher(style)) return pose.src;
    const file = pose.id === 'idle' && style === 'zaher-standing' ? 'idle-standing' : pose.id;
    return `assets/zaher-v1/ui/${file}.png`;
  };
  if (typeof module === 'object' && module.exports) module.exports = states;
  else root.PhoenixStates = states;
})(globalThis);
