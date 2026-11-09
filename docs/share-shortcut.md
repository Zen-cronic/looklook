# Look twice from the share sheet

Saw something on Instagram, TikTok, Safari or in your photos? Share it to LookLook and the verdict opens in your browser: skip, wait, buy, or "Which one is it?" when the match needs your pick.

**Status: tested on desktop; phone test after deploy.** The web side (the links, the upload, the redirect and the manifest) was run against a local build. The Shortcut and the Android share sheet have not been tried on a phone yet.

In the steps below, `<base>` is the address of the running app, for example `https://looklook.example.com`, with no slash at the end.

## What the "Look twice" Shortcut does

- **You share a link** (a store page from Safari, or a post link): it opens `<base>/check?url=<the link>`. The Check page starts the check by itself and lands on the verdict.
- **You share a screenshot or photo**: it sends the image to `<base>/api/share`, which keeps it for ten minutes and answers with a link to open. Opening that link checks the image in your browser, the same as adding a screenshot on the Check page.

A link to an Instagram or TikTok post is not a store page, so the catalogue usually can't find it and LookLook says so. For a creator post, take a screenshot and share the screenshot instead.

## How it works

- `GET /check?url=<link>` checks a store link straight away. `GET /check?text=<text>` uses the first web link in the text. Only `http` and `https` links up to 2048 characters are accepted, with the same messages as the store-link box.
- `POST /api/share` takes a multipart form with a PNG, JPEG, GIF or WebP image up to 5 MB in the field `image` (or `file`), and answers `{ "verdictUrl": "<base>/check?shared=<token>", "expiresAt": "…" }`. A browser form post (Android) gets a redirect to the same page instead.
- A shared screenshot waits ten minutes for its link to be opened, and the link works once.
- The check runs in your browser's own session, under the same hourly limits as the Check page. `/api/share` only stores the image; it never calls the model or the catalogue, and it has its own hourly upload limits.

## Build the Shortcut on an iPhone

1. Open the **Shortcuts** app and tap **+** to make a new shortcut. Name it **Look twice**.
2. Tap the **ⓘ** (Details) button and turn on **Show in Share Sheet**. Back in the editor, the first line now reads "Receive … input from Share Sheet": tap the input types and keep only **Images**, **URLs**, **Safari web pages** and **Text**. If it offers "If there's no input", choose **Stop and Respond**.
3. Add **Get URLs from Input**. Its input should read **Shortcut Input**.
4. Add **If**. Set it to **If URLs has any value**.
5. Inside the If, add:
   1. **Get Item from List**: **First Item** from **URLs**.
   2. **URL Encode**: Encode **Item from List**.
   3. **Text**: type `<base>/check?url=`, then insert the **URL Encoded Text** variable right after the `=` with no space.
   4. **Open URLs**: **Text**.
6. In the **Otherwise** branch, add:
   1. **Convert Image**: Convert **Shortcut Input** to **JPEG** (this also turns iPhone HEIC photos into something LookLook reads).
   2. **Resize Image**: **Converted Image** to width **1600** (keeps the file under the 5 MB limit; leave height on Auto).
   3. **Get Contents of URL**: URL `<base>/api/share`. Tap **Show More**: Method **POST**, Request Body **Form**. Tap **Add new field**, choose **File**, key `image`, value **Resized Image**.
   4. **Get Dictionary Value**: Get **Value** for key `verdictUrl` in **Contents of URL**.
   5. **Open URLs**: **Dictionary Value**.
7. Tap **Done**.

To use it: in Safari, Instagram, TikTok or Photos, tap **Share**, then **Look twice** (scroll the row of actions, or tap **Edit Actions** to add it to your favourites). The first run asks to allow the Shortcut to connect to `<base>`; tap **Allow**.

If the image is refused (too big, not an image, or too many uploads this hour), the answer has an `error` message instead of `verdictUrl`, for example "That image is over 5 MB. Crop it or take a smaller screenshot.", and the Shortcut stops at Open URLs. Add the screenshot on the Check page instead.

## Android

Open `<base>` in Chrome, open the menu and tap **Add to Home screen** (or **Install app**). LookLook then appears in the share sheet: share a link, text with a link, or a screenshot to it and the verdict opens. The manifest sends every share to `/api/share`, which passes links on to `/check` and keeps screenshots as above.
