/* ============================================================
   The pet — the banner mark, which occasionally says things.

   Offline and one-way: no server, no model, no network. Every
   line is written below. What the code decides is WHICH line and
   WHEN. It deals the greetings for the current time window from a
   shuffled deck, so each one appears before any repeats.

   The mark IS the site logo, so it is never hidden. Bubbles hang
   below it and travel downward, in and out.
   ============================================================ */

/* ---- what it says ---------------------------------------------------- */

const GREETINGS = [
  [5, ["Past midnight. The good ideas have gone home, only the stubborn ones left.",
       "It's late. Whatever is broken will still be broken tomorrow.",
       "Small hours. This is when I used to learn things.",
       "Nothing compiles well after 2am. Nothing.",
       "Reading this at this hour. I won't tell anyone.",
       "Late. The semicolons start disappearing around now.",
       "Past 2am, every typo becomes a design decision.",
       "The night shift has no meetings. It does have consequences.",
       "If this is research, I respect the commitment.",
       "Tomorrow has technically started. Your inbox disagrees.",
       "Quiet hours. Good for thinking, unreliable for naming things.",
       "One more page, then sleep. That is how it starts."]],
  [8, ["Up before the pipeline. Impressive.",
       "Morning. Coffee first, then whatever this is.",
       "Early. The quiet part of the day, before anyone needs anything.",
       "Sunrise. Bold hour to be reading a CV.",
       "Morning. Nothing has gone wrong yet.",
       "Early start. I approve, quietly.",
       "Good morning. The tabs are still under control.",
       "Early enough to make a plan before the plan changes.",
       "The day is loading. No errors yet.",
       "First coffee, then sensible decisions.",
       "Morning. A clean desk is still theoretically possible.",
       "You found the page before the notifications did."]],
  [12, ["Morning. Nothing on fire, as far as I know.",
        "Hello. Take your time, it's all written down.",
        "Morning. The build is green. Probably.",
        "Fresh branch, fresh start.",
        "Morning. The good hours, before the meetings arrive.",
        "Hello. Scroll on, it gets more specific.",
        "Good morning. The first useful decision is usually the smallest one.",
        "Hello. The short version is above; the evidence is below.",
        "Morning. There is still time to avoid an unnecessary meeting.",
        "New day, same reliable defaults.",
        "Hello. No slide deck required.",
        "The morning build has opinions."]],
  [14, ["Lunch. Even the servers pause about now.",
        "Midday. Half the day gone, all of it still here.",
        "Reading CVs over lunch is a choice. A good one.",
        "Go eat something that isn't a snack.",
        "Around noon. Twice the optimism, half the tickets.",
        "Midday. This counts as a break, I suppose.",
        "Lunch hour. A respectable time for quiet research.",
        "Midday. The calendar is full; this page is not.",
        "Take the break. The problem benefits from distance.",
        "Noon. A good moment to question the first estimate.",
        "Halfway through the day, approximately.",
        "Lunch first. Production will wait a few minutes."]],
  [18, ["Afternoon. The productive stretch, in theory.",
        "Good afternoon. It gets more specific further down.",
        "The 3pm bug is on its way. Read fast.",
        "Afternoon. Ship it before someone books a meeting.",
        "Good afternoon. Five years, four languages, one page.",
        "Afternoon. Still awake, still here.",
        "Afternoon. Enough time left to finish one important thing.",
        "Good afternoon. The useful details are rarely in the headline.",
        "Afternoon. This is where the second coffee negotiates.",
        "The day has context now. Use it carefully.",
        "Good afternoon. Small changes still count as shipping.",
        "Afternoon. The inbox is winning on points."]],
  [22, ["Evening. The page is open, and so am I.",
        "Good evening. Nobody should deploy on a Friday.",
        "Evening. Hiring reads better after dinner.",
        "The build went green. Eventually.",
        "Close the laptop soon. This will keep.",
        "Good evening. No standups at this hour.",
        "Evening. A quieter time to make a careful decision.",
        "Good evening. The deploy window is looking suspicious.",
        "The meetings are over. The actual thinking may begin.",
        "Evening. One last useful tab.",
        "Good evening. Tomorrow's first task is hiding somewhere.",
        "The day is winding down. The logs are not."]],
  [24, ["Late one. I'll be brief.",
        "Nearly tomorrow. Still here.",
        "Still up? We would get on.",
        "Almost midnight. Save your work.",
        "The tests have gone to sleep. I haven't.",
        "Late. Push, then rest.",
        "Late evening. Nothing urgent improves after midnight.",
        "Almost tomorrow. Leave yourself a useful note.",
        "Last call for sensible variable names.",
        "Late. The clean stopping point was twenty minutes ago.",
        "Night mode was the correct design decision.",
        "Save, close, and let the background process finish."]]
];

const HOLD = 6200;           // time on screen before it puffs out
const SMOKE = 900;           // must match the pet-smoke animation
const AUTO_DELAY = 7000;     // the one automatic greeting after page load

const currentGreetings = () => {
  const hour = new Date().getHours();
  return (GREETINGS.find(([until]) => hour < until) || GREETINGS[0])[1];
};

/* ---- boot ------------------------------------------------------------ */

const pet = document.querySelector('.pet');

// clear a flag an earlier build used to persist; nothing is stored now
try { localStorage.removeItem('pet-dismissed'); } catch { /* private mode */ }

/* The data flag protects against accidental duplicate module injection. */
if (pet && pet.dataset.petInitialised !== 'true') {
  pet.dataset.petInitialised = 'true';
  start();
}

function start() {
  const body   = pet.querySelector('.pet__body');
  const bubble = pet.querySelector('.pet__bubble');
  const textEl = pet.querySelector('.pet__text');

  const setState = (next) => { pet.dataset.state = next; };
  let autoTimer = 0;
  let autoConsumed = false;

  const cancelAutomatic = () => {
    autoConsumed = true;
    clearTimeout(autoTimer);
    autoTimer = 0;
  };

  /* A shuffled deck, not a random pick: every line is shown once before any
     comes round again, so a session can't repeat itself. In memory only —
     a refresh deals a fresh deck, deliberately. */
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  let activeGreetings = currentGreetings();
  let deck = shuffle(activeGreetings);

  /* Stay appropriate to the current hour. Crossing into another time window
     deals a fresh deck; otherwise every greeting appears before a repeat. */
  const nextLine = () => {
    const latestGreetings = currentGreetings();
    if (latestGreetings !== activeGreetings) {
      activeGreetings = latestGreetings;
      deck = shuffle(activeGreetings);
    }

    if (!deck.length) deck = shuffle(activeGreetings);

    return deck.pop();
  };

  /* ---- bubble ----
     Dismissing the bubble and its own countdown are separate: a click closes
     it, hovering pauses the timer so a long line can be read. */
  let holdTimer = 0, smokeTimer = 0, pulseTimer = 0;
  let closing = false;

  const keepOpen = () => {
    if (closing) return;
    clearTimeout(holdTimer);
    clearTimeout(smokeTimer);
    bubble.classList.remove('is-out');
  };

  const hideBubble = () => {
    /* Closing any bubble permanently consumes automatic speech for this load. */
    cancelAutomatic();
    clearTimeout(holdTimer);
    clearTimeout(smokeTimer);
    if (bubble.hidden || closing) return;
    closing = true;
    bubble.classList.add('is-out');
    smokeTimer = setTimeout(() => {
      bubble.hidden = true;
      bubble.classList.remove('is-out');
      closing = false;
    }, SMOKE);
  };

  const scheduleHide = () => {
    if (closing) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(hideBubble, HOLD);
  };

  const say = (text) => {
    keepOpen();
    textEl.textContent = text;
    bubble.hidden = false;
    scheduleHide();

    // a brief pulse on the mark, so the logo acknowledges it spoke
    clearTimeout(pulseTimer);
    setState('speaking');
    pulseTimer = setTimeout(() => setState('ready'), 900);
  };

  // read at your own pace; click when you're done with it
  bubble.addEventListener('mouseenter', keepOpen);
  bubble.addEventListener('mouseleave', scheduleHide);
  bubble.addEventListener('click', hideBubble);

  /* ---- when it speaks ----
     There is one automatic attempt per page load. A manual click before it
     fires cancels that attempt, so the pet never reopens after being closed. */
  autoTimer = setTimeout(() => {
    autoTimer = 0;
    if (autoConsumed || !bubble.hidden) return;
    autoConsumed = true;
    say(nextLine());
  }, AUTO_DELAY);

  body.addEventListener('click', () => {
    if (!bubble.hidden) return;                   // wait until it fully closes
    cancelAutomatic();
    say(nextLine());
  });

  // The timer above owns the only automatic greeting.
  setState('ready');
}
