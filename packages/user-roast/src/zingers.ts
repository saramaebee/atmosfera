const ZINGERS: ReadonlyArray<(offenderId: string, targetId: string) => string> = [
  (o, _t) => `<@${o}>, that roast wasn't about you. Stop trying to collect strangers' damage as a personality trait.`,
  (o, t) => `Imagine reading <@${t}>'s roast and going "yes, this is mine now." Bold move, <@${o}>. Bold and embarrassing.`,
  (o, _t) => `<@${o}> trying to pin a roast that isn't theirs is the single most relatable thing they've ever done — pure want, zero claim.`,
  (o, t) => `<@${o}>, this roast was a gift to <@${t}>. You don't get to RT someone else's character assassination.`,
  (o, _t) => `Hands off, <@${o}>. We don't yet have a roast tailored for you, but keep pressing that button and we'll fix that.`,
  (o, t) => `<@${o}>, you're not <@${t}>. I checked. Twice. Sit down.`,
  (o, _t) => `<@${o}> out here trying to steal valor on a roast. The lengths people will go to feel seen.`,
  (o, t) => `Pinning <@${t}>'s roast won't make it about you, <@${o}>. Though that you tried says plenty.`,
  (o, _t) => `<@${o}>, every roast you can't pin is a roast you weren't important enough to receive. Just sit with that.`,
  (o, _t) => `Wrong user, <@${o}>. Right energy, though — bookmark this feeling for your own roast someday.`,
];

export function pickZinger(offenderId: string, targetId: string): string {
  const idx = Math.floor(Math.random() * ZINGERS.length);
  const fn = ZINGERS[idx] ?? ZINGERS[0]!;
  return fn(offenderId, targetId);
}
