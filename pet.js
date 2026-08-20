/* ============================================================
   The pet — the banner mark, which occasionally says things.

   Offline and one-way: no server, no model, no network. Every
   line is written below. What the code decides is WHICH line and
   WHEN, and it does two things to keep that from feeling random:

     - it watches which section is on screen, and prefers a line
       about whatever is being read
     - it deals from a shuffled deck, so a session shows every
       line once before any of them comes round again

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
       "Late. The semicolons start disappearing around now."]],
  [8, ["Up before the pipeline. Impressive.",
       "Morning. Coffee first, then whatever this is.",
       "Early. The quiet part of the day, before anyone needs anything.",
       "Sunrise. Bold hour to be reading a CV.",
       "Morning. Nothing has gone wrong yet.",
       "Early start. I approve, quietly."]],
  [12, ["Morning. Nothing on fire, as far as I know.",
        "Hello. Take your time, it's all written down.",
        "Morning. The build is green. Probably.",
        "Fresh branch, fresh start.",
        "Morning. The good hours, before the meetings arrive.",
        "Hello. Scroll on, it gets more specific."]],
  [14, ["Lunch. Even the servers pause about now.",
        "Midday. Half the day gone, all of it still here.",
        "Reading CVs over lunch is a choice. A good one.",
        "Go eat something that isn't a snack.",
        "Around noon. Twice the optimism, half the tickets.",
        "Midday. This counts as a break, I suppose."]],
  [18, ["Afternoon. The productive stretch, in theory.",
        "Good afternoon. It gets more specific further down.",
        "The 3pm bug is on its way. Read fast.",
        "Afternoon. Ship it before someone books a meeting.",
        "Good afternoon. Five years, four languages, one page.",
        "Afternoon. Still awake, still here."]],
  [22, ["Evening. The page is open, and so am I.",
        "Good evening. Nobody should deploy on a Friday.",
        "Evening. Hiring reads better after dinner.",
        "The build went green. Eventually.",
        "Close the laptop soon. This will keep.",
        "Good evening. No standups at this hour."]],
  [24, ["Late one. I'll be brief.",
        "Nearly tomorrow. Still here.",
        "Still up? We would get on.",
        "Almost midnight. Save your work.",
        "The tests have gone to sleep. I haven't.",
        "Late. Push, then rest."]]
];

/* Tagged with the section each belongs to, so the pet can say something about
   whatever is on screen. Drawn from the CV and PERSONA.md. Statements, not
   claims: where there's a number, the line admits how it happened rather than
   taking credit for it. */
const ABOUT = [
  { t: 'hero', a: "Backend and frontend. The split never made much sense to me." },
  { t: 'hero', a: "Five years as a job. A good deal longer as a habit." },
  { t: 'hero', a: "Dhaka, working with people in the Netherlands and Canada. Timezones are the hard part." },
  { t: 'hero', a: "My degrees are in accounting. Nobody is more surprised about that than me." },
  { t: 'hero', a: "I started with Visual Basic in sixth grade. Everything since is a variation." },

  { t: 'work', a: "I took 75% off a cloud bill once. Most of that was deleting things nobody used." },
  { t: 'work', a: "A widget I built cut client setup from weeks to a script tag, mostly by removing steps." },
  { t: 'work', a: "Six languages of translation, automated. The team stopped moving text between spreadsheets." },
  { t: 'work', a: "A WordPress site became a Next.js site and got 150% faster. WordPress wasn't trying hard." },
  { t: 'work', a: "Every number on this page is from something that shipped. I did check." },

  { t: 'services', a: "People usually call me when something works but costs too much." },
  { t: 'services', a: "gRPC, Kafka, Kubernetes. Three words meaning the hard part is coordination." },
  { t: 'services', a: "I like the jobs where nobody is sure where the problem lives yet." },
  { t: 'services', a: "Schema through to interface. Fewer handovers, fewer surprises." },

  { t: 'work', a: "I built an ERP in Go that keeps Shopify, Magento and WooCommerce agreeing with each other." },
  { t: 'work', a: "WebSocket broadcasting across instances. Getting them to agree took longer than building it." },
  { t: 'work', a: "A WordPress plugin that encrypts email end to end. GDPR made it interesting." },
  { t: 'work', a: "My first real project was an order tracker for a garment inspection office, in 2010." },
  { t: 'work', a: "I once wrote a scraper and a bot to build a dataset nobody had asked for." },
  { t: 'work', a: "A booking platform in six languages. Most of the work was the parts nobody sees." },

  { t: 'experience', a: "Anlytic since January. Dutch company, Dhaka desk." },
  { t: 'experience', a: "I have been at Strativ twice. It was a good place to grow up in." },
  { t: 'experience', a: "Texada ran alongside everything else for four years. Contracts keep you honest." },
  { t: 'experience', a: "I learned React the month before I started at Strativ. It went fine." },
  { t: 'experience', a: "There was a startup before all this. Long on ambition, short on everything else." },

  { t: 'stack', a: "Postgres unless there's a reason. There usually isn't a reason." },
  { t: 'stack', a: "Kubernetes, Docker, AWS, GCP. The unglamorous half of the job." },
  { t: 'stack', a: "Stripe, Trustly, Klarna, Altapay. Payments punish optimism." },
  { t: 'stack', a: "I write tests. Not for the badge." },
  { t: 'stack', a: "Go on the server, React in front of it. Boring on purpose." },
  { t: 'stack', a: "I taught myself PHP by reverse engineering the examples that happened to run." },

  { t: 'principles', a: "I write the pipeline as well as the code. Someone has to." },
  { t: 'principles', a: "I write things down. Memory is not a deployment target." },
  { t: 'principles', a: "Async by default. Most meetings are a document that lost its nerve." },
  { t: 'principles', a: "I measure before I rewrite. The profiler is less confident than I am." },
  { t: 'principles', a: "Done is when nobody is nervous about it, not when it merges." },

  { t: 'contact', a: "There's a Book a call button up there, if this is going well." },
  { t: 'contact', a: "Email is fine too. ih.tonmoy@gmail.com." },
  { t: 'contact', a: "Contract and B2B, remote, international." },
  { t: 'contact', a: "I shift my hours for Europe or North America. Dhaka is ahead of most of you." }
];

const HOLD = 6200;           // time on screen before it puffs out
const SMOKE = 900;           // must match the pet-smoke animation
const IDLE = [45000, 90000]; // gap between unprompted lines

const hourGreeting = () => {
  const hour = new Date().getHours();
  const lines = (GREETINGS.find(([until]) => hour < until) || GREETINGS[0])[1];
  return lines[Math.floor(Math.random() * lines.length)];
};

/* ---- which section is on screen -------------------------------------
   Section ids match the tags on ABOUT. Anything above the first section
   counts as the hero. */

const SECTIONS = ['experience', 'services', 'stack', 'principles', 'contact'];
let inView = 'hero';

function watchSections() {
  if (!('IntersectionObserver' in window)) return;

  const seen = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) seen.set(entry.target.id, entry.intersectionRatio);

    // the most-visible section wins; nothing visible means we're up in the hero
    let best = 'hero', ratio = 0.15;
    for (const [id, value] of seen) {
      if (value > ratio) { ratio = value; best = id; }
    }
    inView = best;
  }, { threshold: [0, .15, .35, .6] });

  for (const id of SECTIONS) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

/* ---- boot ------------------------------------------------------------ */

const pet = document.querySelector('.pet');

// clear a flag an earlier build used to persist; nothing is stored now
try { localStorage.removeItem('pet-dismissed'); } catch { /* private mode */ }

if (pet) {
  watchSections();
  start();
}

function start() {
  const body   = pet.querySelector('.pet__body');
  const bubble = pet.querySelector('.pet__bubble');
  const textEl = pet.querySelector('.pet__text');

  let idleTimer = 0;

  const setState = (next) => { pet.dataset.state = next; };

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

  let deck = shuffle(ABOUT);

  /* Prefer a line about the section on screen, but take it from the same
     deck, so "no repeats in a session" still holds. */
  const nextLine = () => {
    if (!deck.length) deck = shuffle(ABOUT);

    let index = deck.findIndex((entry) => entry.t === inView);
    if (index === -1) index = deck.length - 1;      // nothing left on topic

    return deck.splice(index, 1)[0].a;
  };

  /* ---- bubble ----
     Dismissing the bubble and its own countdown are separate: a click closes
     it, hovering pauses the timer so a long line can be read. */
  let holdTimer = 0, smokeTimer = 0, pulseTimer = 0;

  const keepOpen = () => {
    clearTimeout(holdTimer);
    clearTimeout(smokeTimer);
    bubble.classList.remove('is-out');
  };

  const hideBubble = () => {
    clearTimeout(holdTimer);
    clearTimeout(smokeTimer);
    if (bubble.hidden) return;
    bubble.classList.add('is-out');
    smokeTimer = setTimeout(() => {
      bubble.hidden = true;
      bubble.classList.remove('is-out');
    }, SMOKE);
  };

  const scheduleHide = () => {
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

  /* ---- when it speaks ---- */
  const scheduleIdle = () => {
    clearTimeout(idleTimer);
    const [min, max] = IDLE;
    idleTimer = setTimeout(() => {
      if (!document.hidden) say(nextLine());
      scheduleIdle();
    }, min + Math.random() * (max - min));
  };

  body.addEventListener('click', () => {
    say(nextLine());
    scheduleIdle();                              // reset the unprompted clock
  });

  // greet, then settle into the occasional remark
  setState('ready');
  say(hourGreeting());
  scheduleIdle();
}
