# joshanderson051.github.io

The GitHub user site for joshanderson051, served at https://joshanderson051.github.io/.
Its only job is helping Port Solace (formerly Waystation) players move to https://portsolace.com/.

- `index.html` and `404.html` redirect every visitor to https://portsolace.com/.
- `move/` is the old-address bridge. Saves made before the move live in this origin's
  localStorage under `waystation*` keys. The game at portsolace.com sends players to
  `/move/?to=<portsolace.com/play/import.html>`; this page reads those keys and hands them to the
  import page in the URL fragment (never sent to a server), or offers a file download when the
  station is too large for a link.
- `test/bridge.test.mjs` checks the bridge's validation and encoding: `node --test`.

Do not add a `/waystation/` folder here. The project site at that path belongs to the
joshanderson051/waystation repo, and GitHub redirects it to the custom domain portsolace.com.
The old `waystation` names in keys and paths stay on purpose: they are what existing saves use.
