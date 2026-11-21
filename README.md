# Bebetrack

A small, private baby log for two phones. Log breastfeeds (with a timer per side), bottles, sleep and diapers in a couple of taps, and both phones see the same timeline. Everything is encrypted on the phone with a passphrase only the two of you know.

## Using it

1. Open **https://mossoz.github.io/bebetrack/** on your phone.
2. Add it to your home screen. On iPhone, tap Share → Add to Home Screen. On Android, open the menu → Install app.
3. On the first phone, tap **Start new**. Write the passphrase down somewhere safe.
4. On the second phone, tap **Join** and type the same passphrase.

The big buttons at the bottom log a new entry. Tap any entry in the timeline to change or delete it. After every save, an **Undo** button shows for a few seconds. Swipe or use the arrows to see earlier days.

When you stop a breastfeed, the app offers a next-feed reminder, counted from when the feed started (start-to-start, the way feeding intervals are usually counted). It starts at 2 hours the first time and at the last duration you used after that. − and + change it in 30-minute steps, from 2 to 6 hours. Both phones show it at the top, and it turns orange when it's due. Tap it to change or clear it. The next feed clears it, but a bottle within 30 minutes of the breastfeed counts as a top-up and keeps it. **The app only chimes if it's open on screen when the reminder comes due. A locked phone stays silent.**

## Privacy

- Each phone turns the passphrase into an encryption key and encrypts every entry before it leaves the phone. Firebase (Google), where the entries are stored, only ever sees scrambled data, how many entries there are and when they were written.
- The passphrase never leaves the phone. Each phone remembers it, so you don't have to retype it, and Settings can show it when you set up a new phone.
- **If both phones lose the passphrase, the history can't be recovered.** Nobody can reset it for you.
- **Trust limit:** the encryption protects the stored data from whoever stores it. It can't protect against altered app code. Anyone who could change what this repo publishes could ship code that reads the passphrase, so keep the GitHub account safe.

## One-time setup (Firebase)

This only has to be done once, by one person with a Google account. The free Spark plan needs no credit card.

```bash
npm ci
npx firebase login
npx firebase projects:create bebetrack-<something-unique> --display-name Bebetrack
npx firebase firestore:databases:create "(default)" --location nam5 --project <project-id>
npx firebase apps:create WEB bebetrack --project <project-id>
npx firebase apps:sdkconfig WEB <app-id> --project <project-id>
```

1. Copy the config that the last command prints into `app/js/config.js`, as `firebaseConfig`. It isn't a secret.
2. Put the project ID in `.firebaserc`: `{ "projects": { "default": "<project-id>" } }`.
3. Deploy the security rules with `npx firebase deploy --only firestore:rules`. Do this again only if `firestore.rules` changes.
4. In GitHub, go to **Settings → Pages** and set **Source: GitHub Actions**.

Every push to `main` runs the tests and then publishes the app to GitHub Pages.

## Starting over

The first **Start new** claims the Firebase project for your passphrase. To start over, for example because the passphrase is lost:

1. Open the Firebase console and go to **Firestore**.
2. Delete the `meta/claim` document. You can also delete the `spaces` collection to remove the old, unreadable entries.
3. On each phone, open Settings → **Leave on this phone**.
4. Tap **Start new** again.

## Local development

You need Node 22 or newer, and Java 21 for the Firestore emulator.

```bash
npm ci
npm run emulator   # local Firestore at 127.0.0.1:8080 (leave it running)
npm run serve      # the app at http://localhost:5173, talking to the emulator
npm test           # logic tests
npm run test:emulator   # security rules and sync, against the emulator
```

On `localhost`, the app always uses the emulator. The offline service worker is only registered on the published site.

## Credits

Passphrase words come from the [EFF Short Wordlist 1](https://www.eff.org/dice) (CC BY 3.0 US).
