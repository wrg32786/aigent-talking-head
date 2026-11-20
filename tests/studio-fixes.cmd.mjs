// What counts as a terminal command in Studio's page text (tests/studio-fixes.test.mjs and .e2e.mjs)
export const CMD = /npm (run|install|i|ci)\b|npx |pip3? install|python3? -m pip|node kit\/|\.\/kit\/|effects:setup|setup:all|studio:build|brew install|winget install|apt(-get)? install|git checkout/;
