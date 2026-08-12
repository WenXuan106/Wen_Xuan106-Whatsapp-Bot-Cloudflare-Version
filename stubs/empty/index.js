// Empty stand-in for optional native/Node-only packages Baileys tries to
// lazy-load (qrcode-terminal, link-preview-js, jimp, sharp). Baileys
// already wraps these requires in try/catch or .catch() at the call
// site and treats the feature as unavailable if the module is missing
// or empty — this project doesn't use terminal QR printing, link
// previews, or image/sticker processing, so an empty module is exactly
// the right no-op here. If you later want those features for real,
// replace the corresponding entry in package.json's dependencies with
// the actual package instead of this stub.
module.exports = {};
