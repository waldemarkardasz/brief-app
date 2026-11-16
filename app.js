'use strict';
/* Poranny brief — powłoka aplikacji.
 *
 * Ten plik jest publiczny i nie zawiera żadnych danych. Raport leży
 * w prywatnym repozytorium; aplikacja pobiera go stamtąd tokenem, który
 * użytkownik wkleja raz i który nie opuszcza telefonu.
 *
 * Raport przychodzi jako gotowy HTML (karta.html) i jest pokazywany
 * w ramce z wyłączonymi skryptami — aplikacja niczego z niego nie wykonuje.
 */

const API = 'https://api.github.com';
const REPO = 'waldemarkardasz/garmin-brief';
const PLIK = 'karta.html';
const WERSJA = '1.0';
const STREFA = 'Europe/Warsaw';
const K = { token: 'brief.token', karta: 'brief.karta' };

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

/* Z karty czytamy tylko znacznik czasu — resztę pokazuje ramka. */
function opisSwiezosci(html) {
  const m = /name="brief-wygenerowano" content="([^"]+)"/.exec(html || '');
  if (!m) return { tekst: 'raport bez daty', stary: true };
  const dzien = m[1].slice(0, 10);
  const godz = m[1].slice(11, 16);
  if (dzien === dzisIso()) return { tekst: `dzisiejszy · ${godz}`, stary: false };
  const [, mies, d] = dzien.split('-');
  return { tekst: `z ${d}.${mies} · dzisiejszy jeszcze nie gotowy`, stary: true };
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
  };
  ramka.srcdoc = html;
}

function pokazPusto(tekst) {
  $('ramka').hidden = true;
  const el = $('pusto');
  el.hidden = false;
  el.textContent = tekst;
}

/* ---------- pobieranie ---------- */

let trwa = false;
let ostatniePobranie = 0;

async function pobierz(tokenProbny) {
  if (trwa) return false;
  const token = tokenProbny || pamiec(K.token);
  if (!token) { pokazEkranTokenu(); return false; }

  trwa = true;
  $('odswiez').classList.add('kreci');
  try {
    const odp = await fetch(`${API}/repos/${REPO}/contents/${PLIK}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      cache: 'no-store',
    });

    if (odp.status === 401) {
      pamiec(K.token, null);
      pokazEkranTokenu('Token jest błędny albo wygasł. Wygeneruj nowy i wklej go tutaj.');
      return false;
    }
    if (odp.status === 403 || odp.status === 404) {
      const tekst = 'GitHub odmówił dostępu do raportu. Sprawdź, czy token ma prawo odczytu zawartości repozytorium garmin-brief.';
      if (tokenProbny) { pokazEkranTokenu(tekst); return false; }
      ustawStan('brak dostępu do raportu', true);
      if (!pamiec(K.karta)) pokazPusto(tekst);
      return false;
    }
    if (!odp.ok) throw new Error('HTTP ' + odp.status);

    const html = await odp.text();
    if (tokenProbny) pamiec(K.token, tokenProbny);
    pamiec(K.karta, html);
    ostatniePobranie = Date.now();
    pokazBrief();
    pokazKarte(html);
    const s = opisSwiezosci(html);
    ustawStan(s.tekst, s.stary);
    return true;
  } catch (e) {
    if (tokenProbny) {
      pokazEkranTokenu('Nie udało się połączyć z GitHubem. Sprawdź internet i spróbuj ponownie.');
      return false;
    }
    const zapis = pamiec(K.karta);
    if (zapis) {
      const s = opisSwiezosci(zapis);
      ustawStan(`bez połączenia · ${s.tekst.split(' · ')[0]}`, true);
    } else {
      ustawStan('bez połączenia', true);
      pokazPusto('Brak połączenia i brak zapisanego raportu. Spróbuj ponownie, gdy wróci internet.');
    }
    return false;
  } finally {
    trwa = false;
    $('odswiez').classList.remove('kreci');
  }
}

/* ---------- zdarzenia ---------- */

$('token-zapisz').addEventListener('click', async () => {
  const wartosc = $('token').value.trim();
  if (!wartosc) return;
  const przycisk = $('token-zapisz');
  przycisk.disabled = true;
  przycisk.textContent = 'Sprawdzam…';
  await pobierz(wartosc);
  przycisk.disabled = false;
  przycisk.textContent = 'Zapisz i pokaż brief';
});

$('token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('token-zapisz').click();
});

$('odswiez').addEventListener('click', () => pobierz());

$('ustawienia').addEventListener('click', () => {
  $('okno-opis').textContent =
    `Raport pobierany z prywatnego repozytorium ${REPO}. Token zapisany tylko na tym telefonie. Wersja aplikacji ${WERSJA}.`;
  $('okno').showModal();
});
$('zamknij').addEventListener('click', () => $('okno').close());
$('zmien-token').addEventListener('click', () => {
  $('okno').close();
  pokazEkranTokenu();
});
$('wyloguj').addEventListener('click', () => {
  pamiec(K.token, null);
  pamiec(K.karta, null);
  $('okno').close();
  $('ramka').srcdoc = '';
  pokazEkranTokenu();
});

/* Powrót do aplikacji rano ma od razu pokazać świeży raport. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !pamiec(K.token)) return;
  if (Date.now() - ostatniePobranie > 5 * 60 * 1000) pobierz();
});
window.addEventListener('online', () => { if (pamiec(K.token)) pobierz(); });

/* ---------- start ---------- */

(function start() {
  if (!pamiec(K.token)) { pokazEkranTokenu(); return; }
  pokazBrief();
  // Najpierw to, co już jest w telefonie — ekran nie jest pusty ani przez chwilę.
  const zapis = pamiec(K.karta);
  if (zapis) {
    pokazKarte(zapis);
    const s = opisSwiezosci(zapis);
    ustawStan(s.tekst, s.stary);
  } else {
    ustawStan('pobieram…');
  }
  pobierz();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
