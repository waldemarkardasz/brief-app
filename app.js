'use strict';
/* Poranny brief — powłoka aplikacji.
 *
 * Ten plik jest publiczny i nie zawiera żadnych danych. Raporty leżą
 * w prywatnym repozytorium (katalog karty/, jeden plik na dzień); aplikacja
 * pobiera je tokenem, który użytkownik wkleja raz i który nie opuszcza telefonu.
 *
 * Raport przychodzi jako gotowy HTML i jest pokazywany w ramce z wyłączonymi
 * skryptami — aplikacja niczego z niego nie wykonuje.
 */

const API = 'https://api.github.com';
const REPO = 'waldemarkardasz/garmin-brief';
const KATALOG = 'karty';
const WERSJA = '1.1';
const STREFA = 'Europe/Warsaw';
const ILE_W_PAMIECI = 45;
const K = { token: 'brief.token', dni: 'brief.dni', karta: 'brief.karta.' };

const $ = (id) => document.getElementById(id);
const ulotne = {};   // zapas, gdyby pamięć przeglądarki była niedostępna

function pamiec(klucz, wartosc) {
  try {
    if (wartosc === undefined) return localStorage.getItem(klucz);
    if (wartosc === null) localStorage.removeItem(klucz);
    else localStorage.setItem(klucz, wartosc);
  } catch (e) {
    if (wartosc === undefined) return ulotne[klucz] ?? null;
    if (wartosc === null) delete ulotne[klucz]; else ulotne[klucz] = wartosc;
  }
  return null;
}

let dni = [];        // daty z raportem, rosnąco: ["2026-11-16", ...]
let biezacy = null;  // data pokazywanego raportu
try { dni = JSON.parse(pamiec(K.dni) || '[]'); } catch (e) { dni = []; }

/* ---------- widoki ---------- */

function pokazEkranTokenu(komunikat) {
  $('ekran-brief').hidden = true;
  $('ekran-token').hidden = false;
  const blad = $('token-blad');
  blad.hidden = !komunikat;
  blad.textContent = komunikat || '';
  $('token').value = '';
}

function pokazBrief() {
  $('ekran-token').hidden = true;
  $('ekran-brief').hidden = false;
}

function ustawStan(tekst, uwaga) {
  const el = $('stan');
  el.textContent = tekst;
  el.classList.toggle('uwaga', !!uwaga);
}

function dzisIso() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: STREFA });
}

function ladnaData(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function odswiezNawigacje() {
  const i = dni.indexOf(biezacy);
  $('wstecz').disabled = i <= 0;
  $('naprzod').disabled = i < 0 || i >= dni.length - 1;
  $('ktory-dzien').textContent = biezacy ? ladnaData(biezacy) : '—';
  if (!biezacy) return;
  if (biezacy === dzisIso()) ustawStan('dzisiejszy');
  else if (i === dni.length - 1) ustawStan('dzisiejszy jeszcze nie gotowy', true);
  else ustawStan('z historii');
}

function dopasujRamke() {
  const ramka = $('ramka');
  const dok = ramka.contentDocument;
  if (!dok || !dok.body) return;
  ramka.style.height = Math.ceil(dok.body.getBoundingClientRect().height) + 'px';
}

let obserwator = null;

function pokazKarte(html) {
  const ramka = $('ramka');
  $('pusto').hidden = true;
  ramka.hidden = false;
  ramka.onload = () => {
    dopasujRamke();
    const dok = ramka.contentDocument;
    if (!dok) return;
    if (obserwator) obserwator.disconnect();
    if ('ResizeObserver' in window) {
      obserwator = new ResizeObserver(dopasujRamke);
      obserwator.observe(dok.body);
    }
    if (dok.fonts && dok.fonts.ready) dok.fonts.ready.then(dopasujRamke);
    // Przesunięcia palcem łapiemy także wewnątrz raportu.
    podepnijGesty(dok);
  };
  ramka.srcdoc = html;
}

function pokazPusto(tekst) {
  $('ramka').hidden = true;
  const el = $('pusto');
  el.hidden = false;
  el.textContent = tekst;
}

/* ---------- GitHub ---------- */

class BladDostepu extends Error {}

async function zGithuba(sciezka, surowy, token) {
  const odp = await fetch(`${API}/repos/${REPO}/contents/${sciezka}`, {
    headers: {
      Authorization: `Bearer ${token || pamiec(K.token)}`,
      Accept: surowy ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  if (odp.status === 401) throw new BladDostepu('401');
  if (odp.status === 403) throw new BladDostepu('403');
  if (odp.status === 404) return null;
  if (!odp.ok) throw new Error('HTTP ' + odp.status);
  return surowy ? odp.text() : odp.json();
}

function zapamietajKarte(data, html) {
  pamiec(K.karta + data, html);
  // W telefonie trzymamy tylko najnowsze dni; starsze zawsze da się dociągnąć.
  const stare = dni.slice(0, Math.max(0, dni.length - ILE_W_PAMIECI));
  stare.forEach((d) => pamiec(K.karta + d, null));
}

/* ---------- pobieranie i nawigacja ---------- */

let trwa = false;
let ostatniePobranie = 0;

async function pokazDzien(data, wymus) {
  biezacy = data;
  odswiezNawigacje();
  window.scrollTo(0, 0);
  const zapis = pamiec(K.karta + data);
  if (zapis) pokazKarte(zapis);
  if (zapis && !wymus) return;
  try {
    const html = await zGithuba(`${KATALOG}/${data}.html`, true);
    if (html && biezacy === data) {
      zapamietajKarte(data, html);
      if (html !== zapis) pokazKarte(html);
    } else if (!html && !zapis) {
      pokazPusto('Nie ma raportu z tego dnia.');
    }
  } catch (e) {
    if (e instanceof BladDostepu) throw e;
    if (!zapis) pokazPusto('Brak połączenia, a tego dnia nie ma jeszcze w telefonie.');
  }
}

async function odswiez(tokenProbny) {
  if (trwa) return false;
  if (!tokenProbny && !pamiec(K.token)) { pokazEkranTokenu(); return false; }
  trwa = true;
  $('odswiez').classList.add('kreci');
  try {
    const lista = await zGithuba(KATALOG, false, tokenProbny);
    if (lista === null) {
      if (tokenProbny) {
        pokazEkranTokenu('GitHub nie pokazał raportów. Sprawdź, czy token ma prawo odczytu zawartości repozytorium garmin-brief.');
        return false;
      }
      ustawStan('brak raportów w repozytorium', true);
      return false;
    }
    if (tokenProbny) pamiec(K.token, tokenProbny);
    dni = lista.map((p) => p.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.html$/.test(n))
      .map((n) => n.slice(0, 10)).sort();
    pamiec(K.dni, JSON.stringify(dni));
    ostatniePobranie = Date.now();
    pokazBrief();
    if (!dni.length) { pokazPusto('Pierwszy raport pojawi się tu jutro rano.'); return true; }
    // Po odświeżeniu zawsze lądujemy na najnowszym dniu i dociągamy go na świeżo.
    await pokazDzien(dni[dni.length - 1], true);
    return true;
  } catch (e) {
    if (e instanceof BladDostepu) {
      if (e.message === '401') {
        pamiec(K.token, null);
        pokazEkranTokenu('Token jest błędny albo wygasł. Wygeneruj nowy i wklej go tutaj.');
      } else if (tokenProbny) {
        pokazEkranTokenu('GitHub odmówił dostępu. Sprawdź uprawnienia tokenu (Contents: Read-only dla garmin-brief).');
      } else {
        ustawStan('brak dostępu do raportów', true);
      }
      return false;
    }
    if (tokenProbny) {
      pokazEkranTokenu('Nie udało się połączyć z GitHubem. Sprawdź internet i spróbuj ponownie.');
      return false;
    }
    ustawStan('bez połączenia — pokazuję zapisane', true);
    return false;
  } finally {
    trwa = false;
    $('odswiez').classList.remove('kreci');
  }
}

function przesun(o) {
  const i = dni.indexOf(biezacy) + o;
  if (i < 0 || i >= dni.length) return;
  pokazDzien(dni[i], false).catch(() => {});
}

/* Przesunięcie palcem: w prawo = dzień wcześniej, w lewo = dzień później. */
function podepnijGesty(cel) {
  let x0 = null, y0 = null;
  cel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  cel.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < 2.5 * Math.abs(dy)) return;
    przesun(dx > 0 ? -1 : 1);
  }, { passive: true });
}

/* ---------- zdarzenia ---------- */

$('token-zapisz').addEventListener('click', async () => {
  const wartosc = $('token').value.trim();
  if (!wartosc) return;
  const przycisk = $('token-zapisz');
  przycisk.disabled = true;
  przycisk.textContent = 'Sprawdzam…';
  await odswiez(wartosc);
  przycisk.disabled = false;
  przycisk.textContent = 'Zapisz i pokaż brief';
});

$('token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('token-zapisz').click();
});

$('odswiez').addEventListener('click', () => odswiez());
$('wstecz').addEventListener('click', () => przesun(-1));
$('naprzod').addEventListener('click', () => przesun(1));
podepnijGesty(document);

$('ustawienia').addEventListener('click', () => {
  $('okno-opis').textContent =
    `Raporty pobierane z prywatnego repozytorium ${REPO}. Token zapisany tylko na tym telefonie. ` +
    `Dni w historii: ${dni.length}. Wersja aplikacji ${WERSJA}.`;
  $('okno').showModal();
});
$('zamknij').addEventListener('click', () => $('okno').close());
$('zmien-token').addEventListener('click', () => {
  $('okno').close();
  pokazEkranTokenu();
});
$('wyloguj').addEventListener('click', () => {
  dni.forEach((d) => pamiec(K.karta + d, null));
  pamiec(K.token, null);
  pamiec(K.dni, null);
  pamiec('brief.karta', null);   // zapis z wersji 1.0
  dni = []; biezacy = null;
  $('okno').close();
  $('ramka').srcdoc = '';
  pokazEkranTokenu();
});

/* Powrót do aplikacji rano ma od razu pokazać świeży raport. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !pamiec(K.token)) return;
  if (Date.now() - ostatniePobranie > 5 * 60 * 1000) odswiez();
});
window.addEventListener('online', () => { if (pamiec(K.token)) odswiez(); });

/* ---------- start ---------- */

(function start() {
  if (!pamiec(K.token)) { pokazEkranTokenu(); return; }
  pokazBrief();
  // Najpierw to, co już jest w telefonie — ekran nie jest pusty ani przez chwilę.
  if (dni.length) {
    biezacy = dni[dni.length - 1];
    odswiezNawigacje();
    const zapis = pamiec(K.karta + biezacy);
    if (zapis) pokazKarte(zapis);
  } else {
    ustawStan('pobieram…');
  }
  odswiez();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
