# Digitale Küchen-Bons (Zettle → Tablet)

Server `v1.2.0` · Display `v1.4.0`

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

- **Bon kurz antippen** = ganzer Bon erledigt. Wer länger hält, ohne ein Produkt abzuhaken, löst nichts aus. Unten erscheint 8 Sekunden lang „Rückgängig“.
- **Produkt lange drücken** (¾ Sekunde) = dieses Produkt ist raus (durchgestrichen). Nochmal lange drücken hebt es auf. Sind alle Produkte raus, wird die Kachel grün („✓ Alles raus“) und kann weggetippt werden.
- **Farben:** Ab 8 Minuten wird der Rand orange, ab 15 Minuten rot.
- **Schrift:** Produktnamen sind groß; bei vollen Bons wird die Schrift auf der Kachel automatisch kleiner. Passt es trotzdem nicht, erscheint „+N weitere Positionen“. Tablet am besten quer aufstellen.
- **Backoffice** (PIN `111222`): Startnummer für den Tag setzen, Testbon erzeugen, alle Bons leeren. Die PIN prüft der Server. Ändern kannst du sie in `.env` über `BACKOFFICE_PIN`.
- **🔔** schaltet den Ton an oder aus.
- Nach 99 springt die Nummer wieder auf 1.
- Getränke usw. blendest du über `AUSBLENDEN` in `.env` aus. Es reicht ein Teil des Namens, mehrere Einträge kommagetrennt.
- Offene Bons und die Nummer bleiben bei einem Neustart des Servers erhalten (`state.json`).
- Das Tablet braucht Internet, z. B. über den Handy-Hotspot.
