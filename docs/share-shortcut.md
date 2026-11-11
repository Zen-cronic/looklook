# Look twice from the share sheet

Saw something on Instagram, TikTok, Safari or in your photos? Share it to LookLook and the verdict opens in your browser: skip, wait, buy, or "Which one is it?" when the match needs your pick.

**Status: tested on desktop; phone test after deploy.** The web side (the Shortcut's two requests, the Android share form, the upload, the redirects and the pages at 390 px) was run against a local build in a desktop browser with an iPhone-sized window and an iPhone user agent. The Shortcut file and the Android share sheet have not been tried on a phone yet.

The setup page in the app is `/share` (on the hosted app: https://looklook-7cpf.onrender.com/share). It says the same as this page, in fewer words.

## iPhone: the "Look twice" Shortcut

### Add it

1. On the iPhone, open https://looklook-7cpf.onrender.com/share in **Safari**.
2. Tap **Get the Shortcut**. If Safari asks to download "Look twice.shortcut", tap **Download**, then open the file from Safari's Downloads list (or the Files app, in Downloads).
3. The Shortcuts app shows "Look twice" with its actions: tap **Add Shortcut**.

The file is signed with the Shortcuts app on a Mac (`npx tsx scripts/shortcut/build.ts`) and opens https://looklook-7cpf.onrender.com. To point it at another address, build it again with that address (`npx tsx scripts/shortcut/build.ts https://your-copy.example`), or build it by hand.

### Or build it by hand (four steps)

`<base>` is the app's address with no slash at the end, for example `https://looklook-7cpf.onrender.com`.

1. In **Shortcuts**, tap **+**, name it **Look twice**, tap **ⓘ** (Details) and turn on **Show in Share Sheet**. On the first line ("Receive … from Share Sheet"), keep **Images**, **URLs**, **Safari web pages** and **Text**.
2. Add **Get URLs from Input** (input: **Shortcut Input**), then **If**: **URLs** **has any value**.
3. Inside the If, add **Text**: type `<base>/s?u=` and insert the **URLs** variable right after the `=` (no space). Then add **Open URLs** (it takes the Text).
4. Under **Otherwise**, add **Convert Image**: **Shortcut Input** to **JPEG**. Then **Get Contents of URL**: URL `<base>/api/share?reply=url`; tap **Show More**, Method **POST**, Request Body **File**, File **Converted Image**. Then **Open URLs** (it takes Contents of URL). Tap **Done**.

No encoding step is needed: `/s` takes the link as it is pasted in. Converting to JPEG also turns an iPhone camera photo (HEIC) into something LookLook reads.

### Use it

In Safari, Instagram, TikTok or Photos, tap **Share**, then **Look twice** (scroll the row of actions to the end, or tap **Edit Actions** to add it to your favourites). The first time you share an image, it asks to send it to the app's address: tap **Allow**. Safari opens the Check page, which shows "Reading the post…" and then the verdict, in about 30 to 45 seconds.

If a share is refused (too big, not an image, too many this hour, or a screenshot link opened twice), the page that opens says why.

## Android

Open https://looklook-7cpf.onrender.com in Chrome, open the **⋮** menu and tap **Add to Home screen** (or **Install app**). LookLook then appears in the share sheet: share a link, text with a link, or a screenshot to it and the verdict opens. The manifest sends every share to `/api/share`, which passes links on to `/check` and keeps screenshots as above.

## What a share turns into

- **A link** opens `/s?u=<link>` (the Shortcut) or `/check?url=<link>` / `/check?text=<text with a link>` (Android, or any page). Only `http` and `https` links up to 2048 characters are accepted, with the same messages as the store-link box. The Check page starts the check by itself and clears the link from the address bar, so reloading doesn't check it again.
- **A store page** the product catalogue knows is checked as a listing. **Any other page** (a post, an article, a link to an image) is read from its picture: the image itself, or the page's preview picture (the one a chat app shows when the link is pasted). The verdict page then says "From the picture on the page". Only public web addresses are fetched, with an 8-second timeout and a size cap. Some sites (Instagram often) show a sign-in page to anyone not signed in, and then there is no picture to read: share a screenshot of the post instead.
- **A screenshot or photo** is posted to `/api/share` as a multipart form (field `image`, or `file` from Android) or as the whole request body (the Shortcut). It takes a PNG, JPEG, GIF or WebP image up to 15 MB. A bigger image is scaled to 1568 pixels on its long edge and kept as a JPEG; the reader works at that size anyway. A HEIC photo sent without converting gets "That photo is in HEIC format, which LookLook can't read. Take a screenshot of it and share the screenshot."
- The answer is the page to open: `{ "verdictUrl": "<base>/check?shared=<token>", "expiresAt": "…" }` as JSON, a 303 redirect for a browser form post (Android), or the address alone as plain text for `?reply=url` (the Shortcut), also when the share is refused (`<base>/check?share_error=<reason>`).
- A shared screenshot waits ten minutes for its link to be opened, and the link works once.
- The check runs in your browser's own session, under the same hourly limits as the Check page. `/api/share` only stores the image; it never calls the model or the catalogue, and it has its own hourly upload limits.

## Try it on an iPhone, step by step

1. In Safari, open https://looklook-7cpf.onrender.com/share and add the Shortcut as above.
2. In Safari, open https://looklook-7cpf.onrender.com/filming/posts/sunscreen.png (an unbranded sample post). Tap **Share** (the square with the arrow), then **Look twice**. You should see: Safari opens the Check page with "Reading the post…", then a pink **Check this** card headed "From the picture on the page", with "Which one is it?" choices below. Tap **This one** on the first choice: the verdict follows (in a local run it was **Skip**, because the sample shelf already has a face sunscreen).
3. Take a screenshot of a product post (side button + volume up). In Photos, open it, tap **Share**, then **Look twice**, and **Allow** the first time. You should see the same Check page, then a verdict headed "From your screenshot".
4. In Safari, open a store's product page, tap **Share**, then **Look twice**. You should see a verdict headed "From the store link".
