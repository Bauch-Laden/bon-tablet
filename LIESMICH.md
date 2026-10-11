# Digitale Küchen-Bons (Zettle → Tablet)

Server `v1.6.0` · Display `v1.9.0`

## 1. Test auf dem MacBook

```bash
brew install node            # falls Node noch fehlt (ab Version 18)
cd bon-tablet
npm install
cp .env.example .env
```

**Schritt A – ohne Zettle:**
```bash
npm run test-modus
```
Im Browser `http://localhost:3000` öffnen. Alle ~40 Sekunden kommt ein Testbon. Weitere Testbons erzeugst du über Backoffice → „Testbon erzeugen“.

Auf dem Tablet testen (gleiches WLAN): `http://<IP-des-Mac>:3000`. Die IP findest du mit `ipconfig getifaddr en0`.

**Schritt B – mit Zettle:** In `.env` `ZETTLE_CLIENT_ID` und `ZETTLE_API_KEY` eintragen und `ZETTLE_MOCK=0` setzen. Dann:
```bash
npm start
```
Jetzt einen echten Verkauf in Zettle buchen. Der Bon sollte nach ein paar Sekunden erscheinen.

## 2. Umzug aufs Android-Tablet (Termux)

1. **Termux aus F-Droid** installieren. Die Version aus dem Play Store ist veraltet.
2. In Termux:
   ```bash
   pkg update && pkg install nodejs
   termux-setup-storage
   ```
3. Den Ordner `bon-tablet` (ohne `node_modules`) auf das Tablet kopieren, z. B. nach `Download/`. Danach:
   ```bash
   cp -r ~/storage/downloads/bon-tablet ~/
   cd ~/bon-tablet && npm install
   ```
4. Starten:
   ```bash
   termux-wake-lock
   cd ~/bon-tablet && npm start
   ```
5. In Chrome `http://localhost:3000` öffnen. Über das Chrome-Menü „Zum Startbildschirm hinzufügen“ wählen, damit die Seite wie eine App startet.
6. **Android-Einstellungen:** Akku-Optimierung für Termux ausschalten (Einstellungen → Apps → Termux → Akku → „Nicht eingeschränkt“). Bildschirm-Timeout auf das Maximum stellen.

Nach einem Neustart des Tablets öffnest du Termux und führst Schritt 4 erneut aus.

## Bedienung

- **Bon kurz antippen** = ganzer Bon erledigt (grüner Haken, dann verschwindet die Kachel). Wer länger hält, ohne ein Produkt abzuhaken, löst nichts aus. Unten erscheint „Rückgängig“: Jeder Druck holt den nächsten zuletzt erledigten Bon zurück, bis zu 10 Bons. Der Balken verschwindet 8 Sekunden nach dem letzten Druck.
- **Bon lange drücken** (¾ Sekunde) = **Bearbeiten-Modus**: Der Bon öffnet sich groß.
  - **Produkt antippen** = 1 Stück raus. Bei „2× …“ teilt sich die Zeile in „1×“ aktiv und „1×“ durchgestrichen. Den durchgestrichenen Teil antippen holt ein Stück zurück.
  - **Notiz zum Bon** eintippen oder aus Bausteinen zusammenklicken: mit, ohne, ajvar, oliven, salat, zaziki, hummus, take-away. Nach „mit“/„ohne“ folgt ein Leerzeichen, sonst ein Komma (z. B. „ohne zaziki, mit hummus, take-away“). ⌫ entfernt den letzten Baustein. Darunter stehen die zuletzt verwendeten Notizen (bis zu 8). Die Notiz erscheint als oranger Balken unter der Nummer.
  - Die Bausteine stehen oben in `kueche.html` unter `NOTIZ_BAUSTEINE` und lassen sich dort ändern.
  - **Fertig** oder ein Tipp neben das Fenster speichert und schließt.
  - Sind alle Produkte raus, wird die Kachel grün („✓ Alles raus“) und kann weggetippt werden.
- **Farben:** Ab 5 Minuten wird der Rand orange, ab 8 Minuten rot.
- **Schrift:** Produktnamen sind groß; bei vollen Bons wird die Schrift auf der Kachel automatisch kleiner. Passt es trotzdem nicht, erscheint „+N weitere Positionen“. Tablet am besten quer aufstellen.
- **Test** (oben): erzeugt einen Testbon mit Nummer T1, T2 … Funktioniert auch ohne Internet bzw. Zettle, solange der Server in Termux läuft. Die echte Bestellnummer wird dadurch nicht verändert.
- **Backoffice** (PIN `111222`): Startnummer für den Tag setzen, Testbon erzeugen, alle Bons leeren. Die PIN prüft der Server. Ändern kannst du sie in `.env` über `BACKOFFICE_PIN`.
- **🔔** schaltet den Ton an oder aus.
- Nach 99 springt die Nummer wieder auf 1.
- Getränke usw. blendest du über `AUSBLENDEN` in `.env` aus. Es reicht ein Teil des Namens, mehrere Einträge kommagetrennt.
- Offene Bons und die Nummer bleiben bei einem Neustart des Servers erhalten (`state.json`).
- Das Tablet braucht Internet, z. B. über den Handy-Hotspot. Kurze Aussetzer überbrückt der Server; rot wird die Anzeige erst nach 30 Sekunden ohne Zettle-Verbindung.
