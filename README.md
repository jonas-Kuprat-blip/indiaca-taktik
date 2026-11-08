# Indiaca Taktikboard (PWA)

Taktikboard für Indiaca, gemacht für iPad + Apple Pencil in Safari. Läuft komplett offline, speichert lokal (IndexedDB), kein Server, kein Build-Schritt.

## Bedienung

| Was | Wie |
|---|---|
| Spieler setzen | Token aus der linken Leiste aufs Feld ziehen, oder antippen (setzt ihn auf eine Grundposition) |
| Spieler/Zone/Marker bearbeiten | Mit dem Pfeil-Cursor-Werkzeug (oder mit dem Finger, sobald ein Stift erkannt wurde) antippen. Oben erscheint dann eine Leiste mit Nummer, Name, Farbe, Duplizieren und Löschen |
| Zeichnen | Stift-Werkzeug; der Apple Pencil nutzt die Druckstärke |
| Palm Rejection | Sobald der Pencil einmal benutzt wurde, zeichnet nur noch der Stift; Finger verschieben Tokens und Zonen. Umschalten über das durchgestrichene Stift-Symbol oben rechts |
| Ziel / Position | „Punkt“ oder „Kreuz“ antippen, dann aufs Feld tippen (= Ziel) oder ziehen (= Ziel mit Pfeil vom Startpunkt) |
| Zonen | Rechteck, Kreis oder Freiform aufziehen; Größe über den Griff, Deckkraft in der Leiste |
| Seiten | Unten antippen = wechseln, aktive Seite antippen = Menü (umbenennen, duplizieren, als Vorlage speichern, verschieben, löschen), lange halten + ziehen = sortieren, mit zwei Fingern über das Feld wischen = blättern |
| Angabe-Seite | „+“ → „Angabe-Seite“. Angabeart links wählen; die Legende mit Zählern steht unter dem Feld |
| Undo/Redo | Pfeile oben rechts (am Mac ⌘Z / ⇧⌘Z) |
| Backup | Boards-Menü (oben links) → Exportieren / Importieren (JSON) |

## Lokal testen

```bash
cd ~/indiaca-taktik
python3 -m http.server 5180
```

Dann http://localhost:5180 öffnen. Für den Offline-Modus und die Installation braucht das iPad HTTPS, deshalb GitHub Pages.

## Hosting über GitHub Pages

1. Auf github.com ein neues **öffentliches** Repository anlegen, z. B. `indiaca-taktik` (ohne README).
2. Im Terminal:
   ```bash
   cd ~/indiaca-taktik
   git init -b main
   git add .
   git commit -m "Indiaca Taktikboard"
   git remote add origin https://github.com/DEIN-NAME/indiaca-taktik.git
   git push -u origin main
   ```
3. Auf GitHub: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**, Branch `main`, Ordner `/ (root)`, **Save**.
4. Nach ca. 1 Minute ist die App unter `https://DEIN-NAME.github.io/indiaca-taktik/` erreichbar.
5. Auf dem iPad in **Safari** öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**. Danach startet die App im Vollbild und funktioniert offline.

### Updates ausrollen

1. Dateien ändern.
2. In `sw.js` die Zeile `const VERSION = 'taktik-v1'` hochzählen (`v2`, `v3`, …).
3. Committen und pushen.

Die App holt sich die neue Version beim nächsten Start (eventuell erst beim zweiten Öffnen).

### Wichtig zu den Daten auf dem iPad

- Die installierte Home-Bildschirm-App hat **ihren eigenen Speicher**, getrennt vom Safari-Tab. Boards, die du im Safari-Tab angelegt hast, tauchen in der installierten App nicht auf. Wechsel sie bei Bedarf per Export/Import.
- Die Daten liegen nur auf dem Gerät. Exportiere deshalb ab und zu als Backup (z. B. in die Dateien-App oder nach iCloud Drive).

## Struktur

```
index.html              App-Hülle
manifest.webmanifest    PWA-Manifest
sw.js                   Service Worker (Offline-Cache)
css/app.css             Layout + helles/dunkles Theme
js/model.js             Feldmaße, Datenmodell, Standardwerte
js/store.js             State, Undo/Redo, Speichern, Boards/Seiten/Vorlagen, Export/Import
js/db.js                IndexedDB
js/render.js            SVG-Rendering (Feld, Elemente, Legende, Thumbnails)
js/stroke.js            Druckabhängige Stiftkontur
js/stage.js             Pointer-Eingabe: Stift vs. Finger, Werkzeuge, Gesten
js/ui/*.js              Toolbar, Palette, Seitenleiste, Notizen, Boards, Auswahl-Leiste, Dialoge
tools/make_icons.py     erzeugt die App-Icons
```

Datenmodell: Board → Seiten → Elemente (`player`, `zone`, `stroke`, `arrow`, `marker`), plus Notizen pro Seite. Koordinaten sind in Metern ab Feldmitte angegeben.
