const { initDb, db } = require("./db");
const { generateSpace } = require("./generator");

initDb();
const spaces = db.prepare("SELECT id, name FROM spaces").all();
for (const space of spaces) {
  try {
    const result = generateSpace(space.id);
    console.log(`Generated ${space.name}: ${result.dataToken}`);
  } catch (error) {
    console.warn(`Skipped ${space.name}: ${error.message}`);
  }
}
