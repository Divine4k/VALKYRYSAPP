update-signing.pem: the Ed25519 private key (PKCS8 PEM) that signs latest.json of in-app updates (tools/build_update.mjs).
It is kept in this PRIVATE source repo on purpose. NEVER put it in the public updates repo (Divine4k/valkyrys-updates) or anywhere public:
whoever has it can push code to every installed app. The matching public key is PUBLIC_KEY in electron-app/updater.js.
If it ever leaks: make a new key pair, put the new public key in updater.js and ship that with the full installer (old apps keep trusting the old key).
